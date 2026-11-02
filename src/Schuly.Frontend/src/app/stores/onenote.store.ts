import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { swrCache } from '../core/swr-cache';
import { LinkedAccountsStore } from './linked-accounts.store';
import {
  OneNoteNode,
  OneNoteNotebook,
  OneNotePageContent,
  OneNotePageSummary,
  OneNotePageUpdate,
  OneNotePagesResult,
  OneNoteProblem,
  OneNoteSearchHit,
  OneNoteSearchResult,
  OneNoteTree,
  findNode,
  oneNoteProblemOf,
  orderNotebooks,
} from './onenote.model';

export const PAGE_SIZE = 50;
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN_CHARS = 2;
const IMAGE_CACHE_MAX = 40;

export interface TreeState {
  nodes: OneNoteNode[] | null;
  loading: boolean;
  problem: OneNoteProblem | null;
}

export type SaveResult = { ok: true } | { ok: false; reason: OneNoteProblem };

/** OneNote state for the page: notebooks, section trees, page lists, search and the open page, all cached stale-while-revalidate per account. */
@Injectable()
export class OneNoteStore {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);

  readonly notebooks = signal<OneNoteNotebook[]>([]);
  readonly notebooksLoading = signal(false);
  readonly notebooksProblem = signal<OneNoteProblem | null>(null);
  readonly trees = signal<Record<string, TreeState>>({});

  readonly selectedNotebookId = signal<string | null>(null);
  readonly selectedSectionId = signal<string | null>(null);

  readonly pages = signal<OneNotePageSummary[]>([]);
  readonly pagesLoading = signal(false);
  readonly pagesProblem = signal<OneNoteProblem | null>(null);
  readonly nextSkip = signal<number | null>(null);
  readonly loadingMore = signal(false);
  readonly moreFailed = signal(false);

  /** What the user typed; `searchTerm` is that text once it is long enough and has settled. */
  readonly query = signal('');
  readonly searchTerm = signal('');
  readonly searchAll = signal(false);
  readonly hits = signal<OneNoteSearchHit[]>([]);
  readonly searching = signal(false);
  readonly searchProblem = signal<OneNoteProblem | null>(null);
  readonly partial = signal(false);

  readonly pageId = signal<string | null>(null);
  readonly page = signal<OneNotePageContent | null>(null);
  readonly pageLoading = signal(false);
  readonly pageProblem = signal<OneNoteProblem | null>(null);
  /** Title shown while the page itself is still loading. */
  readonly pageHint = signal<{ title: string; notebook: string | null; section: string | null } | null>(null);

  readonly waiting = computed(() => !this.accounts.loaded());
  readonly searchActive = computed(() => this.searchTerm().length >= SEARCH_MIN_CHARS);
  readonly selectedNotebook = computed(() => this.notebooks().find((n) => n.id === this.selectedNotebookId()) ?? null);
  readonly selectedSection = computed(() => {
    const id = this.selectedSectionId();
    const notebook = this.selectedNotebookId();
    if (!id || !notebook) return null;
    const nodes = this.trees()[notebook]?.nodes;
    return nodes ? findNode(nodes, id) : null;
  });
  readonly canCreate = computed(() => !!this.selectedSectionId() && !!this.selectedNotebook()?.writable);
  readonly hasMore = computed(() => this.nextSkip() !== null);

  private pagesSeq = 0;
  private pageSeq = 0;
  private searchSeq = 0;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly images = new Map<string, string>();

  constructor() {
    effect(() => {
      const id = this.accounts.selectedId('notes');
      if (!this.accounts.loaded()) return;
      untracked(() => {
        this.reset();
        if (id) void this.loadNotebooks();
      });
    });
    effect(() => {
      const term = this.searchTerm();
      this.searchAll();
      this.selectedNotebookId();
      this.accounts.selectedId('notes');
      untracked(() => void this.runSearch(term));
    });
  }

  private base(): string | null {
    // The notes capability's own base path for the selected account; the OneNote routes hang off it.
    const base = this.accounts.endpoint('notes');
    return base ? `${base}/onenote` : null;
  }

  private key(...parts: string[]): string {
    return [this.accounts.selectedId('notes') ?? '', 'onenote', ...parts].join('|');
  }

  private reset(): void {
    this.pagesSeq++;
    this.pageSeq++;
    this.searchSeq++;
    clearTimeout(this.searchTimer);
    this.notebooks.set([]);
    this.trees.set({});
    this.selectedNotebookId.set(null);
    this.selectedSectionId.set(null);
    this.pages.set([]);
    this.nextSkip.set(null);
    this.pagesProblem.set(null);
    this.query.set('');
    this.searchTerm.set('');
    this.hits.set([]);
    this.pageId.set(null);
    this.page.set(null);
    this.pageProblem.set(null);
    this.images.clear();
  }

  /** Cached data shows at once; the network answer replaces it. A failed refresh keeps what is on screen. */
  private async swr<T>(key: string, path: string, params: Record<string, string | number | boolean>, current: () => boolean, apply: (data: T) => void, fail: (error: unknown, cached: boolean) => void): Promise<void> {
    const base = this.base();
    if (!base) return;
    const hit = swrCache.get<T>(key);
    if (hit) apply(hit.data);
    try {
      const data = await firstValueFrom(this.http.get<T>(`${base}/${path}`, { params }));
      swrCache.set(key, data);
      if (current()) apply(data);
    } catch (error) {
      if (current()) fail(error, !!hit);
    }
  }

  async loadNotebooks(): Promise<void> {
    const account = this.accounts.selectedId('notes');
    const current = () => this.accounts.selectedId('notes') === account;
    const key = this.key('notebooks');
    this.notebooksProblem.set(null);
    this.notebooksLoading.set(!swrCache.get(key));
    await this.swr<OneNoteNotebook[]>(
      key,
      'notebooks',
      { teams: true },
      current,
      (list) => {
        this.notebooks.set(orderNotebooks(Array.isArray(list) ? [...list] : []));
        this.notebooksLoading.set(false);
      },
      (error, cached) => {
        this.notebooksLoading.set(false);
        if (!cached) this.notebooksProblem.set(oneNoteProblemOf(error));
      },
    );
    this.notebooksLoading.set(false);
  }

  async loadTree(notebookId: string): Promise<void> {
    const account = this.accounts.selectedId('notes');
    const current = () => this.accounts.selectedId('notes') === account;
    const key = this.key('tree', notebookId);
    const put = (state: TreeState) => this.trees.update((t) => ({ ...t, [notebookId]: state }));
    const cachedHit = swrCache.get<OneNoteTree>(key);
    put({ nodes: cachedHit?.data.children ?? this.trees()[notebookId]?.nodes ?? null, loading: !cachedHit && !this.trees()[notebookId]?.nodes, problem: null });
    await this.swr<OneNoteTree>(
      key,
      `notebooks/${encodeURIComponent(notebookId)}/sections`,
      {},
      current,
      (tree) => put({ nodes: tree.children ?? [], loading: false, problem: null }),
      (error, cached) => put({ nodes: this.trees()[notebookId]?.nodes ?? null, loading: false, problem: cached ? null : oneNoteProblemOf(error) }),
    );
  }

  selectNotebook(notebookId: string): void {
    this.selectedNotebookId.set(notebookId);
  }

  selectSection(sectionId: string, notebookId: string): void {
    this.selectedNotebookId.set(notebookId);
    this.selectedSectionId.set(sectionId);
    void this.loadPages(sectionId);
  }

  async loadPages(sectionId: string): Promise<void> {
    const seq = ++this.pagesSeq;
    const current = () => seq === this.pagesSeq;
    const key = this.key('pages', sectionId);
    const hit = swrCache.get<OneNotePagesResult>(key);
    this.pagesProblem.set(null);
    this.moreFailed.set(false);
    this.loadingMore.set(false);
    this.pages.set(hit?.data.items ?? []);
    this.nextSkip.set(hit?.data.nextSkip ?? null);
    this.pagesLoading.set(!hit);
    await this.swr<OneNotePagesResult>(
      key,
      `sections/${encodeURIComponent(sectionId)}/pages`,
      { top: PAGE_SIZE, skip: 0 },
      current,
      (result) => {
        this.pages.set(result.items ?? []);
        this.nextSkip.set(result.nextSkip ?? null);
        this.pagesLoading.set(false);
      },
      (error, cached) => {
        this.pagesLoading.set(false);
        if (!cached) this.pagesProblem.set(oneNoteProblemOf(error));
      },
    );
  }

  async loadMorePages(): Promise<void> {
    const sectionId = this.selectedSectionId();
    const skip = this.nextSkip();
    const base = this.base();
    if (!sectionId || skip === null || !base || this.loadingMore()) return;
    const seq = this.pagesSeq;
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    try {
      const result = await firstValueFrom(this.http.get<OneNotePagesResult>(`${base}/sections/${encodeURIComponent(sectionId)}/pages`, { params: { top: PAGE_SIZE, skip } }));
      if (seq !== this.pagesSeq) return;
      const known = new Set(this.pages().map((p) => p.id));
      this.pages.update((list) => [...list, ...(result.items ?? []).filter((p) => !known.has(p.id))]);
      this.nextSkip.set(result.nextSkip ?? null);
    } catch {
      if (seq === this.pagesSeq) this.moreFailed.set(true);
    } finally {
      if (seq === this.pagesSeq) this.loadingMore.set(false);
    }
  }

  /** Typing is debounced: nothing is searched before the text has been still for a moment and is long enough. */
  setQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    const term = value.trim();
    if (term.length < SEARCH_MIN_CHARS) {
      this.searchTerm.set('');
      return;
    }
    this.searchTimer = setTimeout(() => this.searchTerm.set(term), SEARCH_DEBOUNCE_MS);
  }

  private async runSearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    if (term.length < SEARCH_MIN_CHARS) {
      this.hits.set([]);
      this.searching.set(false);
      this.searchProblem.set(null);
      this.partial.set(false);
      return;
    }
    const notebook = this.searchAll() ? null : this.selectedNotebookId();
    const params: Record<string, string | number> = { q: term, top: 25 };
    if (notebook) params['notebook'] = notebook;
    const key = this.key('search', notebook ?? '*', term);
    const hit = swrCache.get<OneNoteSearchResult>(key);
    this.searchProblem.set(null);
    this.hits.set(hit?.data.items ?? []);
    this.partial.set(hit?.data.partial ?? false);
    this.searching.set(!hit);
    await this.swr<OneNoteSearchResult>(
      key,
      'search',
      params,
      () => seq === this.searchSeq,
      (result) => {
        this.hits.set(result.items ?? []);
        this.partial.set(result.partial === true);
        this.searching.set(false);
      },
      (error, cached) => {
        this.searching.set(false);
        if (!cached) this.searchProblem.set(oneNoteProblemOf(error));
      },
    );
  }

  async openPage(id: string, hint: { title: string; notebook: string | null; section: string | null } | null = null): Promise<void> {
    const seq = ++this.pageSeq;
    const key = this.key('page', id);
    const hit = swrCache.get<OneNotePageContent>(key);
    this.pageId.set(id);
    this.pageProblem.set(null);
    this.page.set(hit?.data ?? null);
    this.pageHint.set(hint);
    this.pageLoading.set(!hit);
    await this.swr<OneNotePageContent>(
      key,
      `pages/${encodeURIComponent(id)}`,
      {},
      () => seq === this.pageSeq,
      (content) => {
        this.page.set(content);
        this.pageLoading.set(false);
      },
      (error, cached) => {
        this.pageLoading.set(false);
        if (!cached) this.pageProblem.set(oneNoteProblemOf(error));
      },
    );
  }

  /** Leaves the section (back on narrow screens): nothing selected, no page, search cleared. */
  clearSection(): void {
    this.pagesSeq++;
    this.selectedSectionId.set(null);
    this.pages.set([]);
    this.nextSkip.set(null);
    this.pagesProblem.set(null);
    this.pagesLoading.set(false);
    this.closePage();
    this.setQuery('');
  }

  closePage(): void {
    this.pageSeq++;
    this.pageId.set(null);
    this.page.set(null);
    this.pageLoading.set(false);
    this.pageProblem.set(null);
  }

  private forgetSection(sectionId: string | null | undefined): void {
    if (sectionId) swrCache.invalidate(this.key('pages', sectionId));
    swrCache.invalidate(this.key('search'));
  }

  /** Creates a page in the selected section and opens it. */
  async createPage(title: string): Promise<SaveResult> {
    const base = this.base();
    const sectionId = this.selectedSectionId();
    if (!base || !sectionId) return { ok: false, reason: 'failed' };
    try {
      const created = await firstValueFrom(this.http.post<OneNotePageSummary>(`${base}/sections/${encodeURIComponent(sectionId)}/pages`, { title }));
      this.forgetSection(sectionId);
      if (this.selectedSectionId() === sectionId) this.pages.update((list) => [...list.filter((p) => p.id !== created.id), created]);
      this.query.set('');
      this.searchTerm.set('');
      await this.openPage(created.id, { title: created.title, notebook: this.selectedNotebook()?.displayName ?? null, section: this.selectedSection()?.displayName ?? null });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: oneNoteProblemOf(error) };
    }
  }

  /** Sends only what changed; the answer is the fresh page (outline ids change after every save). */
  async savePage(update: OneNotePageUpdate): Promise<SaveResult> {
    const base = this.base();
    const id = this.pageId();
    if (!base || !id) return { ok: false, reason: 'failed' };
    try {
      const content = await firstValueFrom(this.http.patch<OneNotePageContent>(`${base}/pages/${encodeURIComponent(id)}`, update));
      swrCache.set(this.key('page', id), content);
      this.forgetSection(content.section?.id ?? this.selectedSectionId());
      if (this.pageId() === id) this.page.set(content);
      const patch = (title: string, modified: string | null) => ({ title, lastModifiedDateTime: modified });
      this.pages.update((list) => list.map((p) => (p.id === id ? { ...p, ...patch(content.title, content.lastModifiedDateTime) } : p)));
      this.hits.update((list) => list.map((p) => (p.id === id ? { ...p, ...patch(content.title, content.lastModifiedDateTime) } : p)));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: oneNoteProblemOf(error) };
    }
  }

  async deletePage(): Promise<SaveResult> {
    const base = this.base();
    const id = this.pageId();
    if (!base || !id) return { ok: false, reason: 'failed' };
    try {
      await firstValueFrom(this.http.delete(`${base}/pages/${encodeURIComponent(id)}`));
      this.forgetSection(this.page()?.section?.id ?? this.selectedSectionId());
      swrCache.invalidate(this.key('page', id));
      this.pages.update((list) => list.filter((p) => p.id !== id));
      this.hits.update((list) => list.filter((p) => p.id !== id));
      this.closePage();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: oneNoteProblemOf(error) };
    }
  }

  /** Fetches an image through the authenticated proxy and returns it as a data: URL; null when it cannot be shown. */
  async imageDataUrl(resourceId: string): Promise<string | null> {
    const base = this.base();
    if (!base) return null;
    const key = this.key('img', resourceId);
    const cached = this.images.get(key);
    if (cached) return cached;
    try {
      const blob = await firstValueFrom(this.http.get(`${base}/resources/${encodeURIComponent(resourceId)}`, { params: { kind: 'image' }, responseType: 'blob' }));
      if (!blob.type.startsWith('image/')) return null;
      const url = await blobToDataUrl(blob);
      if (!url.startsWith('data:image/')) return null;
      this.images.set(key, url);
      while (this.images.size > IMAGE_CACHE_MAX) this.images.delete(this.images.keys().next().value as string);
      return url;
    } catch {
      return null;
    }
  }

  /** Downloads an attachment as opaque bytes and saves it through a temporary link. */
  async downloadFile(resourceId: string, name: string): Promise<boolean> {
    const base = this.base();
    if (!base) return false;
    try {
      const blob = await firstValueFrom(this.http.get(`${base}/resources/${encodeURIComponent(resourceId)}`, { params: { kind: 'file', name }, responseType: 'blob' }));
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = safeFileName(name);
      link.rel = 'noopener';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    } catch {
      return false;
    }
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** File name that is safe for a download link: no path parts or control characters, bounded length. */
export function safeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return cleaned || 'attachment';
}
