import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError, concat, firstValueFrom, from, map, of, switchMap, throwError } from 'rxjs';
import { AuthStore } from '../stores/auth.store';
import { SavedResponse, readSaved, removeSaved, userIdFromToken, writeSaved } from './browser-cache';

type Params = Record<string, string | number | boolean>;

const keyOf = (url: string, params: Params = {}): string => {
  const query = new HttpParams({ fromObject: Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) }).toString();
  return query ? `${url}?${query}` : url;
};

/** Calls `refresh` when the tab comes back and on a timer while it's visible. Returns a stop function. */
export function keepFresh(refresh: () => void, everyMs = 30_000): () => void {
  const tick = () => {
    if (!document.hidden) refresh();
  };
  document.addEventListener('visibilitychange', tick);
  const timer = setInterval(tick, everyMs);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', tick);
  };
}

/** Draw first, then update, after OutNote's docs/frontend-and-api.md: saved answers show at once, and `If-None-Match` asks whether they changed. */
@Injectable({ providedIn: 'root' })
export class ResponseCache {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);

  /** Until when Microsoft asked to wait (Retry-After). */
  private blockedUntil = 0;
  private prefetching = false;

  private userId(): string | null {
    return userIdFromToken(this.auth.accessToken());
  }

  /** Whose database a write goes to is fixed when the read starts, so a read that outlives a sign-out can't land in the next user's. */
  private write(owner: string | null, key: string, value: SavedResponse): Promise<void> {
    return owner && owner === this.userId() ? writeSaved(owner, key, value) : Promise.resolve();
  }

  /**
   * Emits the saved answer if there is one, then the new one if it changed. A 304 emits nothing more, so nothing redraws. `liveUrl` answers when the cached route
   * doesn't exist, which is the case for an older plugin or another provider.
   */
  swr<T>(url: string, params: Params = {}, liveUrl?: string): Observable<T> {
    const owner = this.userId();
    const key = keyOf(url, params);
    return from(readSaved<T>(owner, key)).pipe(
      switchMap((saved) => {
        const drawn: Observable<T> = saved ? of(saved.data) : EMPTY;
        if (Date.now() < this.blockedUntil) return concat(drawn, saved ? EMPTY : throwError(() => new HttpErrorResponse({ status: 429, url })));
        const headers: Record<string, string> = saved?.etag ? { 'If-None-Match': saved.etag } : {};
        const network = this.http.get<T>(url, { params, headers, observe: 'response' }).pipe(
          switchMap((response) => from(this.write(owner, key, { data: response.body, etag: response.headers.get('ETag'), at: Date.now() })).pipe(map(() => response.body as T))),
          catchError((error: unknown) => {
            if (error instanceof HttpErrorResponse) {
              if (error.status === 304) return EMPTY;
              this.noteThrottle(error);
              if (error.status === 404) void removeSaved(owner, key);
              if (error.status === 404 && liveUrl) return this.http.get<T>(liveUrl, { params });
            }
            return throwError(() => error);
          }),
        );
        return concat(drawn, network);
      }),
    );
  }

  /** The first screen in one request: its parts are saved under the routes they stand for, so those pages draw at once. */
  bootstrap(base: string): void {
    const owner = this.userId();
    this.swr<{ mail?: unknown; folders?: unknown; chats?: unknown }>(`${base}/cached/bootstrap`).subscribe({
      next: (data) => {
        void this.seed(owner, keyOf(`${base}/cached/mail`, { folder: 'inbox', unread: false, top: 25 }), data.mail);
        void this.seed(owner, keyOf(`${base}/cached/mail/folders`), data.folders);
        void this.seed(owner, keyOf(`${base}/cached/chats`, { top: 25 }), data.chats);
      },
      error: () => undefined,
    });
  }

  /** Only where nothing is saved yet: a saved list checks for changes by itself, and may be newer than this bundle. */
  private async seed(owner: string | null, key: string, data: unknown): Promise<void> {
    if (data !== undefined && !(await readSaved(owner, key))) await this.write(owner, key, { data, etag: null, at: Date.now() });
  }

  /** Loads details ahead of time, one at a time like Outlook, and skips what is saved. Stops on any failure, and when the tab is hidden or the user asked to save data. */
  async prefetch(urls: string[], gapMs = 130): Promise<void> {
    if (this.prefetching) return;
    this.prefetching = true;
    try {
      await this.prefetchInTurn(urls, gapMs);
    } finally {
      this.prefetching = false;
    }
  }

  private async prefetchInTurn(urls: string[], gapMs: number): Promise<void> {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    const owner = this.userId();
    for (const url of urls) {
      if (document.hidden || Date.now() < this.blockedUntil) return;
      if (await readSaved(owner, url)) continue;
      try {
        const response = await firstValueFrom(this.http.get(url, { observe: 'response' }));
        await this.write(owner, url, { data: response.body, etag: response.headers.get('ETag'), at: Date.now() });
      } catch (error) {
        if (error instanceof HttpErrorResponse) this.noteThrottle(error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  /** Applies a change to a saved answer and returns how to undo it. No etag: the next check must fetch, because the server's copy has changed. */
  async patch<T>(url: string, params: Params, change: (data: T) => T): Promise<() => Promise<void>> {
    const owner = this.userId();
    const key = keyOf(url, params);
    const before = await readSaved<T>(owner, key);
    if (!before) return async () => undefined;
    await this.write(owner, key, { data: change(before.data), etag: null, at: Date.now() });
    return () => this.write(owner, key, before);
  }

  forget(url: string, params: Params = {}): Promise<void> {
    return removeSaved(this.userId(), keyOf(url, params));
  }

  private noteThrottle(error: HttpErrorResponse): void {
    if (error.status !== 429) return;
    const seconds = Number(error.headers?.get('Retry-After'));
    this.blockedUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
  }
}
