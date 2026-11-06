import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../stores/auth.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { SseParser } from './sse';

export type ChatLiveEvent = { kind: 'connected' } | { kind: 'message' | 'message_updated' | 'message_deleted'; chatId: string; fromMe: boolean };

const MESSAGE_KINDS = ['message', 'message_updated', 'message_deleted'];
const FIRST_WAIT_MS = 5_000;
const LONGEST_WAIT_MS = 60_000;
const REFRESH_DEBOUNCE_MS = 300;

/** One `data:` payload of the live stream, or null for anything unknown. */
export function parseLiveEvent(data: string): ChatLiveEvent | null {
  try {
    const event: unknown = JSON.parse(data);
    if (typeof event !== 'object' || event === null) return null;
    const { kind, chatId, fromMe } = event as Record<string, unknown>;
    if (kind === 'connected') return { kind };
    if (typeof kind === 'string' && MESSAGE_KINDS.includes(kind) && typeof chatId === 'string' && chatId) {
      return { kind: kind as 'message', chatId, fromMe: fromMe === true };
    }
    return null;
  } catch {
    return null;
  }
}

/** Calls `onEvent` for each event in the stream until it ends. A chunk may split an event anywhere. */
export async function readLiveEvents(body: ReadableStream<Uint8Array>, onEvent: (event: ChatLiveEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const deliver = (raw: { data: string }) => {
    const event = parseLiveEvent(raw.data);
    if (event) onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true })).forEach(deliver);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** While the stream is up a poll is only the safety net, so it runs at `liveMs`. Otherwise every tick polls, as it always did. */
export function pollDue(live: boolean, lastAt: number, now: number, liveMs: number): boolean {
  return !live || now - lastAt >= liveMs;
}

/** Turns a burst of events into one refresh: one change can arrive as several (a removed reaction gave two). */
export class LiveRefresher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private openChanged = false;
  private newMessage = false;

  constructor(
    private readonly openId: () => string | null,
    private readonly refreshOpen: (newMessage: boolean) => void,
    private readonly refreshList: () => void,
  ) {}

  push(event: ChatLiveEvent): void {
    if (event.kind === 'connected') {
      this.openChanged = true;
    } else if (event.chatId === this.openId()) {
      this.openChanged = true;
      // Only someone else's message can be missing after a refresh: our own is on screen from sending it.
      if (event.kind === 'message' && !event.fromMe) this.newMessage = true;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), REFRESH_DEBOUNCE_MS);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private flush(): void {
    if (this.openChanged) this.refreshOpen(this.newMessage);
    this.openChanged = false;
    this.newMessage = false;
    this.refreshList();
  }
}

/**
 * The live chat stream. It belongs to the chat page, so it exists only while that page is open, and it closes while the tab is hidden.
 * Any failure just means polling carries on: `connected` is true only while events really arrive.
 */
@Injectable()
export class ChatLive {
  private readonly auth = inject(AuthStore);
  private readonly accounts = inject(LinkedAccountsStore);

  readonly connected = signal(false);

  private onEvent: (event: ChatLiveEvent) => void = () => undefined;
  private running: AbortController | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private wait = FIRST_WAIT_MS;
  /** This account has no stream (an older plugin, or the sign-in expired): asking again would only log errors. */
  private gaveUp = false;

  private readonly onVisibility = () => this.restart();

  constructor() {
    effect(() => {
      this.accounts.endpoint('chat');
      untracked(() => {
        this.gaveUp = false;
        this.wait = FIRST_WAIT_MS;
        this.restart();
      });
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.stop();
    });
  }

  listen(onEvent: (event: ChatLiveEvent) => void): void {
    this.onEvent = onEvent;
  }

  private stop(): void {
    clearTimeout(this.retry);
    this.running?.abort();
    this.running = null;
    this.connected.set(false);
  }

  private restart(): void {
    this.stop();
    if (document.hidden || this.gaveUp) return;
    const base = this.accounts.endpoint('chat');
    if (base) void this.run(`${base}/chats/live`, new AbortController());
  }

  private async run(url: string, controller: AbortController): Promise<void> {
    this.running = controller;
    let retryAfter = 0;
    try {
      let response = await this.open(url, this.auth.accessToken(), controller.signal);
      if (response.status === 401) {
        const token = await firstValueFrom(this.auth.refresh());
        if (!token) {
          this.gaveUp = true;
          return;
        }
        response = await this.open(url, token, controller.signal);
      }
      if (response.status === 404 || response.status === 409 || response.status === 401) this.gaveUp = true;
      if (!response.ok || !response.body) {
        retryAfter = Number(response.headers.get('Retry-After')) * 1000 || 0;
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      await readLiveEvents(response.body, (event) => {
        if (event.kind === 'connected') {
          this.connected.set(true);
          this.wait = FIRST_WAIT_MS;
        }
        this.onEvent(event);
      });
    } catch {
      // Closed on purpose or the network dropped; which one is decided below.
    } finally {
      if (this.running === controller) {
        this.running = null;
        this.connected.set(false);
        if (!this.gaveUp) {
          this.retry = setTimeout(() => this.restart(), Math.max(this.wait, retryAfter));
          this.wait = Math.min(this.wait * 2, LONGEST_WAIT_MS);
        }
      }
    }
  }

  private open(url: string, token: string | null, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'X-Schuly-Client': 'web' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { headers, credentials: 'same-origin', signal });
  }
}
