import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swrCache } from '../core/swr-cache';
import { LinkedAccountsStore } from './linked-accounts.store';
import { OneNoteStore } from './onenote.store';

const BASE = '/api/plugins/microsoft/accounts/acc1/onenote';
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const summary = (id: string, title = id) => ({ id, title, level: 0, order: 1, createdDateTime: null, lastModifiedDateTime: null, webUrl: null, sectionId: 's1' });
const content = (id: string, title: string) => ({
  id,
  title,
  createdDateTime: null,
  lastModifiedDateTime: null,
  webUrl: null,
  section: { id: 's1', displayName: 'S' },
  notebook: { id: 'n1', displayName: 'N' },
  writable: true,
  html: '',
  width: 0,
  height: 0,
  resources: [],
  outlines: [],
  hasInk: false,
});

describe('OneNoteStore', () => {
  let store: OneNoteStore;
  let http: HttpTestingController;

  beforeEach(() => {
    swrCache.clear();
    TestBed.configureTestingModule({
      providers: [
        OneNoteStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LinkedAccountsStore, useValue: { selectedId: () => 'acc1', endpoint: () => '/api/plugins/microsoft/accounts/acc1', loaded: signal(true) } },
      ],
    });
    store = TestBed.inject(OneNoteStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne((r) => r.url === `${BASE}/notebooks`).flush([]);
  });

  afterEach(() => vi.useRealTimers());

  it('loads pages of a section, then more with nextSkip', async () => {
    store.selectSection('s1', 'n1');
    const first = http.expectOne((r) => r.url === `${BASE}/sections/s1/pages`);
    expect(first.request.params.get('top')).toBe('50');
    expect(first.request.params.get('skip')).toBe('0');
    first.flush({ items: [summary('p1'), summary('p2')], nextSkip: 50 });
    await flush();
    expect(store.pages().map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(store.hasMore()).toBe(true);

    void store.loadMorePages();
    http.expectOne((r) => r.url === `${BASE}/sections/s1/pages` && r.params.get('skip') === '50').flush({ items: [summary('p2'), summary('p3')], nextSkip: null });
    await flush();
    expect(store.pages().map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(store.hasMore()).toBe(false);
  });

  it('shows cached pages at once and refreshes them', async () => {
    swrCache.set('acc1|onenote|pages|s1', { items: [summary('old')], nextSkip: null });
    store.selectSection('s1', 'n1');
    expect(store.pages().map((p) => p.id)).toEqual(['old']);
    expect(store.pagesLoading()).toBe(false);
    http.expectOne((r) => r.url === `${BASE}/sections/s1/pages`).flush({ items: [summary('new')], nextSkip: null });
    await flush();
    expect(store.pages().map((p) => p.id)).toEqual(['new']);
  });

  it('marks a 422 on a section as unsupported', async () => {
    store.selectSection('s1', 'n1');
    http.expectOne((r) => r.url === `${BASE}/sections/s1/pages`).flush({}, { status: 422, statusText: 'x' });
    await flush();
    expect(store.pagesProblem()).toBe('unsupported');
  });

  it('debounces search, needs two characters and scopes to the notebook', async () => {
    vi.useFakeTimers();
    store.selectNotebook('n1');
    store.setQuery('a');
    vi.advanceTimersByTime(500);
    TestBed.tick();
    http.expectNone((r) => r.url === `${BASE}/search`);

    store.setQuery('ab');
    store.setQuery('abc');
    vi.advanceTimersByTime(299);
    TestBed.tick();
    http.expectNone((r) => r.url === `${BASE}/search`);
    vi.advanceTimersByTime(2);
    TestBed.tick();
    const req = http.expectOne((r) => r.url === `${BASE}/search`);
    expect(req.request.params.get('q')).toBe('abc');
    expect(req.request.params.get('notebook')).toBe('n1');
    req.flush({ items: [], partial: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(store.partial()).toBe(true);

    store.searchAll.set(true);
    TestBed.tick();
    expect(http.expectOne((r) => r.url === `${BASE}/search`).request.params.has('notebook')).toBe(false);
  });

  it('opens a page and saves only what is sent, replacing the page', async () => {
    void store.openPage('pg');
    http.expectOne(`${BASE}/pages/pg`).flush(content('pg', 'Old'));
    await flush();
    expect(store.page()?.title).toBe('Old');

    const done = store.savePage({ title: 'New' });
    const patch = http.expectOne(`${BASE}/pages/pg`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ title: 'New' });
    patch.flush(content('pg', 'New'));
    expect((await done).ok).toBe(true);
    expect(store.page()?.title).toBe('New');
  });

  it('reports a read-only notebook when saving gets 403', async () => {
    void store.openPage('pg');
    http.expectOne(`${BASE}/pages/pg`).flush(content('pg', 't'));
    await flush();
    const done = store.savePage({ title: 'x' });
    http.expectOne(`${BASE}/pages/pg`).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(await done).toEqual({ ok: false, reason: 'readonly' });
  });

  it('deletes a page, drops it from the lists and closes it', async () => {
    store.selectSection('s1', 'n1');
    http.expectOne((r) => r.url === `${BASE}/sections/s1/pages`).flush({ items: [summary('p1'), summary('p2')], nextSkip: null });
    await flush();
    void store.openPage('p1');
    http.expectOne(`${BASE}/pages/p1`).flush(content('p1', 't'));
    await flush();
    const done = store.deletePage();
    const del = http.expectOne(`${BASE}/pages/p1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    expect((await done).ok).toBe(true);
    expect(store.pages().map((p) => p.id)).toEqual(['p2']);
    expect(store.pageId()).toBeNull();
    expect(swrCache.get('acc1|onenote|pages|s1')).toBeNull();
  });

  it('turns an image into a data: URL and refuses non-images', async () => {
    const ok = store.imageDataUrl('r1');
    http.expectOne((r) => r.url === `${BASE}/resources/r1` && r.params.get('kind') === 'image').flush(new Blob(['x'], { type: 'image/png' }));
    expect(await ok).toMatch(/^data:image\/png;base64,/);
    const bad = store.imageDataUrl('r2');
    http.expectOne((r) => r.url === `${BASE}/resources/r2`).flush(new Blob(['x'], { type: 'text/html' }));
    expect(await bad).toBeNull();
  });
});
