import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { Importance } from './chat-media';
import { openMediaStream } from './media-stream';
import { createQueue } from './request-queue';
import { ThrottledError, throttleWait } from './throttle';
import { AuthStore } from '../stores/auth.store';
import { readSaved, userIdFromToken, writeSaved } from './browser-cache';
import { Catalogue, addSearchTerms, parseCatalogue, searchLanguage, searchTerms } from './chat-emoji';

export interface Gif {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface ScheduledMessage {
  id: string;
  chatId: string;
  sendAt: string;
  content: string;
  contentType: string;
  importance?: Importance | null;
}

export interface MeetingResult {
  id?: string;
  subject?: string;
  start?: string;
  end?: string;
  webLink?: string | null;
  joinUrl?: string | null;
}

export type GifResult = { status: 'ok'; items: Gif[] } | { status: 'unavailable' } | { status: 'error' };

const MAX_CONCURRENT_MEDIA = 3;
/** How many times a thumbnail waits out a throttle before the card shows no preview; opening the chat again asks again. */
const MAX_IMAGE_WAITS = 4;

/**
 * Turns a path into an authenticated request URL under this account's API, or null when it is not safe to send the session to.
 * Relative paths are built by the helpers above; absolute ones must already be under `base`. Never accepted: protocol-relative
 * (`//host`), a scheme, backslashes, control characters, and `.` or `..` segments.
 */
export function safeApiPath(path: string, base: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (!path || /[\\\u0000-\u001f]/.test(path) || path.startsWith('//')) return null;
  const [pathname] = path.split(/[?#]/, 1);
  const segments = pathname.split('/');
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..') return null;
  }
  if (path.startsWith('/')) return path.startsWith(`${base}/`) ? path : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return `${base}/${path}`;
}

const CATALOGUE_KEY = 'emoji-catalogue';
const GIFS_UNAVAILABLE_KEY = 'schuly.chat.gifsUnavailableUntil';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TERMS_AGE_MS = 7 * DAY_MS;

const gifsKnownUnavailable = (): boolean => {
  try {
    return Number(localStorage.getItem(GIFS_UNAVAILABLE_KEY)) > Date.now();
  } catch {
    return false;
  }
};

/** Everything the chat composer and message bubbles ask of accounts/{id}/... besides the chat list and messages themselves. */
@Injectable()
export class ChatApi {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);
  private readonly auth = inject(AuthStore);

  /** null until the GIF endpoint answered: true when configured, false on 503, which is remembered for a day so it isn't asked again on every visit. */
  readonly gifsAvailable = signal<boolean | null>(null);

  private readonly queue = createQueue(MAX_CONCURRENT_MEDIA);
  private readonly urls = new Map<string, Promise<string | null>>();
  /** Until when Microsoft asked to wait: nothing is asked of it sooner, since that only extends the wait. */
  private blockedUntil = 0;
  private cataloguePromise: Promise<Catalogue | null> | null = null;
  private catalogueLoaded: Catalogue | null = null;

  constructor() {
    // A different account must not see another account's cached blobs.
    effect(() => {
      this.accounts.selectedId('chat');
      untracked(() => {
        this.revokeAll();
        this.gifsAvailable.set(gifsKnownUnavailable() ? false : null);
      });
    });
  }

  base(): string | null {
    return this.accounts.endpoint('chat');
  }

  private require(): string {
    const base = this.base();
    if (!base) throw new Error('No chat account selected.');
    return base;
  }

  chatPath(chatId: string): string {
    return `chats/${encodeURIComponent(chatId)}`;
  }

  mediaPath(chatId: string, messageId: string, hostedId: string): string {
    return `${this.chatPath(chatId)}/messages/${encodeURIComponent(messageId)}/media/${encodeURIComponent(hostedId)}`;
  }

  filePath(chatId: string, messageId: string, fileId: string): string {
    return `${this.chatPath(chatId)}/messages/${encodeURIComponent(messageId)}/files/${encodeURIComponent(fileId)}`;
  }

  /** The bytes behind an API path (or an absolute `/api/...` path), fetched with the signed-in session. */
  blob(path: string): Promise<Blob> {
    const url = safeApiPath(path, this.require());
    if (!url) return Promise.reject(new Error('Refusing to fetch an unsafe path.'));
    const left = this.blockedUntil - Date.now();
    if (left > 0) return Promise.reject(new ThrottledError(left));
    return firstValueFrom(this.http.get(url, { responseType: 'blob' })).catch((error: unknown) => {
      this.noteThrottle(error);
      throw error;
    });
  }

  /** A URL a `<video>` can play for a file behind an API path. */
  async streamUrl(path: string): Promise<string> {
    const url = safeApiPath(`${path}/stream`, this.require());
    if (!url) throw new Error('Refusing to fetch an unsafe path.');
    const left = this.blockedUntil - Date.now();
    if (left > 0) throw new ThrottledError(left);
    try {
      return await openMediaStream(this.http, url);
    } catch (error) {
      this.noteThrottle(error);
      throw error;
    }
  }

  private noteThrottle(error: unknown): void {
    const wait = throttleWait(error);
    if (wait !== null) this.blockedUntil = Math.max(this.blockedUntil, Date.now() + wait);
  }

  /** The image's bytes, waiting out a throttle in the meantime without holding a place in the queue. */
  private async imageBlob(path: string): Promise<Blob> {
    for (let waits = 0; ; waits++) {
      const left = this.blockedUntil - Date.now();
      if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
      try {
        return await this.queue(() => this.blob(path));
      } catch (error) {
        if (throttleWait(error) === null || waits >= MAX_IMAGE_WAITS) throw error;
      }
    }
  }

  /** An object URL for an image behind an API path, de-duplicated and fetched at most four at a time; null when it has none. */
  imageUrl(path: string): Promise<string | null> {
    const key = `${this.accounts.selectedId('chat')}|${path}`;
    let found = this.urls.get(key);
    if (!found) {
      found = this.imageBlob(path)
        .then((blob) => (blob.size > 0 ? URL.createObjectURL(blob) : null))
        .catch((error: unknown) => {
          // A picture that isn't there stays remembered; one that was only throttled is asked for again next time.
          if (throttleWait(error) !== null) this.urls.delete(key);
          return null;
        });
      this.urls.set(key, found);
    }
    return found;
  }

  private revokeAll(): void {
    for (const pending of this.urls.values()) void pending.then((url) => url && URL.revokeObjectURL(url));
    this.urls.clear();
  }

  async gifs(query: string | null, limit = 24): Promise<GifResult> {
    const base = this.base();
    if (!base) return { status: 'error' };
    try {
      const url = query ? `${base}/gifs/search` : `${base}/gifs/trending`;
      const params: Record<string, string | number> = query ? { q: query, limit } : { limit };
      const items = await firstValueFrom(this.http.get<Gif[]>(url, { params }));
      this.noteGifs(true);
      return { status: 'ok', items: Array.isArray(items) ? items : [] };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 503) {
        this.noteGifs(false);
        return { status: 'unavailable' };
      }
      return { status: 'error' };
    }
  }

  private noteGifs(available: boolean): void {
    this.gifsAvailable.set(available);
    try {
      if (available) localStorage.removeItem(GIFS_UNAVAILABLE_KEY);
      else localStorage.setItem(GIFS_UNAVAILABLE_KEY, String(Date.now() + DAY_MS));
    } catch {
      // Not remembered; the next visit asks again.
    }
  }

  /** The catalogue when it is already here, so the picker can draw it at once. */
  catalogueNow(): Catalogue | null {
    return this.catalogueLoaded;
  }

  /**
   * Teams' own emoji catalogue: public and the same for every account, kept in memory and saved in this browser, so only the first
   * visit waits for it. A saved copy older than a day is replaced in the background. Null when it can't be had; the next call tries again.
   */
  catalogue(): Promise<Catalogue | null> {
    const base = this.base();
    if (this.catalogueLoaded || !base) return Promise.resolve(this.catalogueLoaded);
    return (this.cataloguePromise ??= this.loadCatalogue(base).then((catalogue) => {
      this.catalogueLoaded = catalogue;
      this.cataloguePromise = null;
      if (catalogue) void this.loadSearchTerms(base, catalogue);
      return catalogue;
    }));
  }

  private fetchCatalogue(base: string, locale: string): Promise<unknown> {
    return firstValueFrom(this.http.get<unknown>(`${base}/emojis/catalogue`, { params: { locale } }));
  }

  // Saved as JSON text: cloning a string in and out of IndexedDB is far cheaper than the thousands of strings in the object.
  private async loadCatalogue(base: string): Promise<Catalogue | null> {
    const owner = userIdFromToken(this.auth.accessToken());
    const save = (data: unknown) => writeSaved(owner, CATALOGUE_KEY, { data: JSON.stringify(data), etag: null, at: Date.now() });
    const saved = await readSaved<string>(owner, CATALOGUE_KEY);
    const catalogue = saved && parseCatalogue(JSON.parse(saved.data));
    if (catalogue) {
      if (Date.now() - saved.at > DAY_MS) void this.fetchCatalogue(base, 'default').then(save, () => undefined);
      return catalogue;
    }
    try {
      const data = await this.fetchCatalogue(base, 'default');
      const parsed = parseCatalogue(data);
      if (parsed) void save(data);
      return parsed;
    } catch {
      return null;
    }
  }

  /** Search words in the browser's language; search works without them until they arrive. */
  private async loadSearchTerms(base: string, catalogue: Catalogue): Promise<void> {
    const language = searchLanguage(typeof navigator === 'undefined' ? undefined : navigator.language);
    if (!language) return;
    const owner = userIdFromToken(this.auth.accessToken());
    const key = `${CATALOGUE_KEY}/${language}`;
    const saved = await readSaved<string>(owner, key);
    if (saved && Date.now() - saved.at < MAX_TERMS_AGE_MS) return addSearchTerms(catalogue, JSON.parse(saved.data));
    try {
      const data = searchTerms(await this.fetchCatalogue(base, language));
      addSearchTerms(catalogue, data);
      void writeSaved(owner, key, { data: JSON.stringify(data), etag: null, at: Date.now() });
    } catch {
      if (saved) addSearchTerms(catalogue, JSON.parse(saved.data));
    }
  }

  async scheduled(chatId: string): Promise<ScheduledMessage[]> {
    const items = await firstValueFrom(this.http.get<ScheduledMessage[]>(`${this.require()}/scheduled`));
    return (Array.isArray(items) ? items : []).filter((m) => m.chatId === chatId);
  }

  schedule(chatId: string, body: { content: string; contentType: 'text' | 'html'; importance?: Importance; sendAt: string }): Promise<ScheduledMessage> {
    return firstValueFrom(this.http.post<ScheduledMessage>(`${this.require()}/${this.chatPath(chatId)}/scheduled`, body));
  }

  async cancelScheduled(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.require()}/scheduled/${encodeURIComponent(id)}`));
  }

  meeting(chatId: string, body: { subject: string; start: string; end: string; description?: string }): Promise<MeetingResult> {
    return firstValueFrom(this.http.post<MeetingResult>(`${this.require()}/${this.chatPath(chatId)}/meeting`, body));
  }
}

/** A readable reason for a failed request, from the plugin's `{message}` body when it has one. */
export function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: unknown } | null;
    if (body && typeof body.message === 'string' && body.message) return body.message;
  }
  return fallback;
}
