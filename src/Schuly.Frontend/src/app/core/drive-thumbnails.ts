import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { createQueue } from './request-queue';

export type ThumbnailSize = 'small' | 'medium' | 'large';

/** At most this many thumbnail requests run at once; the rest wait their turn. */
const MAX_CONCURRENT = 4;
/** Object URLs kept for the tab; the least recently used are revoked beyond this. */
const MAX_KEPT = 400;

/**
 * OneDrive preview images as object URLs, fetched with the signed-in session and only when asked
 * (a tile or row that became visible). Provided by the Drive page. Cached per account, item, version and size; a request whose
 * tile left the page before its turn is skipped rather than sent.
 */
@Injectable()
export class DriveThumbnails {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);
  private readonly queue = createQueue(MAX_CONCURRENT);
  private readonly urls = new Map<string, Promise<string | null>>();
  private readonly resolved = new Map<string, string>();

  constructor() {
    // A different account must never see another account's previews.
    effect(() => {
      this.accounts.endpoint('drive');
      untracked(() => this.clear());
    });
  }

  /** The preview of an item, or null when it has none. `wanted` is asked again right before the request goes out. */
  url(itemId: string, version: string | null, size: ThumbnailSize, wanted: () => boolean = () => true, driveId: string | null = null): Promise<string | null> {
    const base = this.accounts.endpoint('drive');
    if (!base) return Promise.resolve(null);
    const key = `${base}|${driveId ?? ''}|${itemId}|${version ?? ''}|${size}`;
    const found = this.urls.get(key);
    if (found) {
      this.touch(key);
      return found;
    }
    let skipped = false;
    const promise = this.queue(async () => {
      if (!wanted()) {
        skipped = true;
        return null;
      }
      const path = driveId
        ? `${base}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/thumbnail`
        : `${base}/files/${encodeURIComponent(itemId)}/thumbnail`;
      const blob = await firstValueFrom(this.http.get(path, { params: { size }, responseType: 'blob' }));
      return blob.size > 0 ? URL.createObjectURL(blob) : null;
    })
      .catch(() => null)
      .then((url) => {
        // A skipped request is asked again next time; a cleared cache must not keep the URL.
        if (skipped) {
          if (this.urls.get(key) === promise) this.urls.delete(key);
          return null;
        }
        if (this.urls.get(key) !== promise) {
          if (url) URL.revokeObjectURL(url);
          return null;
        }
        if (url) {
          this.resolved.set(key, url);
          this.trim();
        }
        return url;
      });
    this.urls.set(key, promise);
    return promise;
  }

  private touch(key: string): void {
    const url = this.resolved.get(key);
    if (url === undefined) return;
    this.resolved.delete(key);
    this.resolved.set(key, url);
  }

  private trim(): void {
    while (this.resolved.size > MAX_KEPT) {
      const [key, url] = this.resolved.entries().next().value as [string, string];
      this.resolved.delete(key);
      this.urls.delete(key);
      URL.revokeObjectURL(url);
    }
  }

  private clear(): void {
    for (const url of this.resolved.values()) URL.revokeObjectURL(url);
    this.resolved.clear();
    this.urls.clear();
  }
}
