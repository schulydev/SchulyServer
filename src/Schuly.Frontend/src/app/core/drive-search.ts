import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { DriveEntry, DriveItem, toDriveEntry } from '../stores/capability-data.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';

interface SearchHit {
  type: string;
  id: string;
  driveId?: string | null;
  title?: string | null;
  date?: string | null;
  webUrl?: string | null;
  size?: number | null;
  isFolder?: boolean | null;
  mimeType?: string | null;
  location?: { label?: string | null } | null;
}

interface SearchResponse {
  hits?: SearchHit[];
  moreAvailable?: boolean;
  nextFrom?: number | null;
}

export interface SearchResult {
  entry: DriveEntry;
  /** Where the file lives, as one line. */
  where: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 350;
const PAGE = 25;

const resultOf = (hit: SearchHit): SearchResult => {
  const item: DriveItem = {
    id: hit.id,
    name: hit.title,
    size: hit.size,
    lastModifiedDateTime: hit.date,
    webUrl: hit.webUrl,
    folder: hit.isFolder ? {} : undefined,
    file: hit.isFolder ? undefined : { mimeType: hit.mimeType },
    parentReference: { driveId: hit.driveId },
  };
  return { entry: toDriveEntry(item, false), where: hit.location?.label || '' };
};

/**
 * Search across every file the account can reach. The text only ever travels in a POST body (never a URL, never logged).
 * Typing waits a moment, a newer query cancels the request still running, and results page with `nextFrom`.
 */
@Injectable()
export class DriveSearch {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);
  private request: Subscription | null = null;

  /** What the search field holds; it also filters the open folder instantly. */
  readonly query = signal('');
  readonly term = computed(() => this.query().trim());
  /** Long enough to ask the service. */
  readonly active = computed(() => this.term().length >= MIN_CHARS);

  readonly results = signal<SearchResult[]>([]);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly failed = signal(false);
  readonly nextFrom = signal<number | null>(null);

  constructor() {
    effect((onCleanup) => {
      const term = this.term();
      this.accounts.selectedId('drive');
      const base = this.accounts.endpoint('drive');
      untracked(() => {
        this.results.set([]);
        this.nextFrom.set(null);
        this.failed.set(false);
        this.loadingMore.set(false);
        this.loading.set(term.length >= MIN_CHARS && !!base);
      });
      if (term.length < MIN_CHARS || !base) return;
      const timer = setTimeout(() => untracked(() => this.fetch(base, term, 0)), DEBOUNCE_MS);
      onCleanup(() => {
        clearTimeout(timer);
        this.request?.unsubscribe();
        this.request = null;
      });
    });
  }

  loadMore(): void {
    const base = this.accounts.endpoint('drive');
    const from = this.nextFrom();
    if (!base || from === null || this.loading() || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.fetch(base, this.term(), from);
  }

  private fetch(base: string, q: string, from: number): void {
    this.request?.unsubscribe();
    this.failed.set(false);
    this.request = this.http.post<SearchResponse>(`${base}/files/search`, { q, from, size: PAGE }).subscribe({
      next: (body) => {
        const found = (body?.hits ?? []).filter((h) => h.type === 'file').map(resultOf);
        const known = new Set(from ? this.results().map((r) => `${r.entry.driveId}|${r.entry.id}`) : []);
        const fresh = found.filter((r) => !known.has(`${r.entry.driveId}|${r.entry.id}`));
        this.results.update((now) => (from ? [...now, ...fresh] : fresh));
        this.nextFrom.set(body?.moreAvailable && typeof body.nextFrom === 'number' ? body.nextFrom : null);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }
}
