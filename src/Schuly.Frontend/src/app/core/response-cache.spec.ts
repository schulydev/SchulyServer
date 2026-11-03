import 'fake-indexeddb/auto';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { patchState } from '@ngrx/signals';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../stores/auth.store';
import { MailStore } from '../stores/capability-data.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { MAX_AGE_MS, MAX_ENTRIES, clearBrowserCaches, readSaved, removeSavedAccount, userIdFromToken, writeSaved } from './browser-cache';
import { ResponseCache, keepFresh } from './response-cache';

const token = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;
const URL_A = '/api/plugins/microsoft/accounts/acc1/cached/mail';
const LIVE = '/api/plugins/microsoft/accounts/acc1/mail';

const names = async () => (await indexedDB.databases()).map((d) => d.name);
const settle = async () => {
  for (let n = 0; n < 20; n++) await new Promise((resolve) => setTimeout(resolve));
};

describe('browser cache', () => {
  beforeEach(() => clearBrowserCaches());

  it('names a database by the user in the token, and refuses anything else', () => {
    expect(userIdFromToken(token('0197-abc'))).toBe('0197-abc');
    expect(userIdFromToken('not a token')).toBeNull();
    expect(userIdFromToken(token('../x'))).toBeNull();
    expect(userIdFromToken(null)).toBeNull();
  });

  it('keeps users apart', async () => {
    await writeSaved('alice', 'k', { data: 'hers', etag: null, at: Date.now() });
    expect(await readSaved('bob', 'k')).toBeNull();
    expect((await readSaved('alice', 'k'))?.data).toBe('hers');
  });

  it('deletes every user database on clear, also one still open', async () => {
    await writeSaved('alice', 'k', { data: 'hers', etag: null, at: Date.now() });
    await writeSaved('bob', 'k', { data: 'his', etag: null, at: Date.now() });
    expect((await names()).filter((n) => n?.startsWith('schuly-cache-')).length).toBe(2);
    await clearBrowserCaches();
    expect((await names()).filter((n) => n?.startsWith('schuly-cache-'))).toEqual([]);
    expect(await readSaved('bob', 'k')).toBeNull();
  });

  it('is not held up by another tab that has the database open', async () => {
    await writeSaved('alice', 'k', { data: 'hers', etag: null, at: Date.now() });
    await clearBrowserCaches();
    expect(await names()).not.toContain('schuly-cache-alice');
  });

  it('forgets one account and leaves the others', async () => {
    await writeSaved('alice', '/x/accounts/acc1/cached/mail', { data: 1, etag: null, at: Date.now() });
    await writeSaved('alice', '/x/accounts/acc2/cached/mail', { data: 2, etag: null, at: Date.now() });
    await removeSavedAccount('alice', 'acc1');
    await settle();
    expect(await readSaved('alice', '/x/accounts/acc1/cached/mail')).toBeNull();
    expect((await readSaved('alice', '/x/accounts/acc2/cached/mail'))?.data).toBe(2);
  });

  it('drops old entries and those past the cap when it opens', async () => {
    await writeSaved('alice', 'old', { data: 1, etag: null, at: Date.now() - MAX_AGE_MS - 1000 });
    for (let n = 0; n < MAX_ENTRIES + 5; n++) await writeSaved('alice', `k${n}`, { data: n, etag: null, at: Date.now() + n });
    await writeSaved('bob', 'x', { data: 0, etag: null, at: Date.now() }); // closes alice's
    await writeSaved('alice', 'new', { data: 0, etag: null, at: Date.now() + 1000000 }); // opens it again, which prunes
    await settle();
    expect(await readSaved('alice', 'old')).toBeNull();
    expect(await readSaved('alice', 'k0')).toBeNull();
    expect((await readSaved('alice', `k${MAX_ENTRIES + 4}`))?.data).toBe(MAX_ENTRIES + 4);
  });
});

describe('ResponseCache', () => {
  let cache: ResponseCache;
  let http: HttpTestingController;
  let auth: InstanceType<typeof AuthStore>;
  const USER = 'user-1';

  beforeEach(async () => {
    await clearBrowserCaches();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }])] });
    cache = TestBed.inject(ResponseCache);
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthStore);
    patchState(auth as never, { accessToken: token(USER), status: 'signedIn' } as never);
  });

  afterEach(() => vi.restoreAllMocks());

  const answer = async (url: string, body: unknown, headers: Record<string, string> = {}, status = 200) => {
    await settle();
    const request = http.expectOne((r) => r.url === url);
    request.flush(body as never, { status, statusText: 'x', headers });
    await settle();
    return request.request;
  };

  it('has nothing to draw the first time, then saves the answer and its etag', async () => {
    const emitted = lastValueFrom(cache.swr(URL_A, { top: 25 }).pipe(toArray()));
    await answer(URL_A, ['fresh'], { ETag: '"a"' });
    expect(await emitted).toEqual([['fresh']]);
    expect(await readSaved(USER, `${URL_A}?top=25`)).toMatchObject({ data: ['fresh'], etag: '"a"' });
  });

  it('draws what is saved first, then asks with If-None-Match, and a 304 redraws nothing', async () => {
    await writeSaved(USER, URL_A, { data: ['saved'], etag: '"a"', at: Date.now() });
    const emitted: unknown[] = [];
    const done = new Promise<void>((resolve) => cache.swr(URL_A).subscribe({ next: (d) => emitted.push(d), complete: resolve }));
    await settle();
    expect(emitted).toEqual([['saved']]);
    const request = await answer(URL_A, null, { ETag: '"a"' }, 304);
    await done;
    expect(request.headers.get('If-None-Match')).toBe('"a"');
    expect(emitted).toEqual([['saved']]);
  });

  it('replaces what is saved when the answer changed', async () => {
    await writeSaved(USER, URL_A, { data: ['old'], etag: '"a"', at: Date.now() });
    const emitted = lastValueFrom(cache.swr(URL_A).pipe(toArray()));
    await answer(URL_A, ['new'], { ETag: '"b"' });
    expect(await emitted).toEqual([['old'], ['new']]);
    expect((await readSaved(USER, URL_A))?.etag).toBe('"b"');
  });

  it('falls back to the live route when the cached one does not exist', async () => {
    const emitted = lastValueFrom(cache.swr(URL_A, {}, LIVE).pipe(toArray()));
    await answer(URL_A, null, {}, 404);
    await answer(LIVE, ['live']);
    expect(await emitted).toEqual([['live']]);
  });

  it('waits out Retry-After, drawing what it has and asking nothing', async () => {
    await writeSaved(USER, URL_A, { data: ['saved'], etag: '"a"', at: Date.now() });
    const failed = firstValueFrom(cache.swr('/x')).catch((error: unknown) => error);
    await answer('/x', null, { 'Retry-After': '120' }, 429);
    expect(await failed).toMatchObject({ status: 429 });
    expect(await lastValueFrom(cache.swr(URL_A).pipe(toArray()))).toEqual([['saved']]);
    http.expectNone(URL_A);
    await expect(firstValueFrom(cache.swr('/y'))).rejects.toMatchObject({ status: 429 });
  });

  it('does not save an answer into the next user after a sign-out', async () => {
    const emitted = lastValueFrom(cache.swr(URL_A).pipe(toArray()));
    await settle();
    patchState(auth as never, { accessToken: token('user-2') } as never);
    await answer(URL_A, ['theirs'], { ETag: '"a"' });
    await emitted;
    expect(await readSaved('user-2', URL_A)).toBeNull();
    expect(await readSaved(USER, URL_A)).toBeNull();
  });

  it('applies a change to what is saved, without an etag, and can undo it', async () => {
    await writeSaved(USER, URL_A, { data: [1], etag: '"a"', at: 5 });
    const undo = await cache.patch<number[]>(URL_A, {}, (d) => [...d, 2]);
    expect(await readSaved(USER, URL_A)).toMatchObject({ data: [1, 2], etag: null });
    await undo();
    expect(await readSaved(USER, URL_A)).toMatchObject({ data: [1], etag: '"a"' });
  });

  it('prefetches one at a time, skips what is saved, and stops at a failure', async () => {
    await writeSaved(USER, '/d/1', { data: 1, etag: null, at: Date.now() });
    const run = cache.prefetch(['/d/1', '/d/2', '/d/3', '/d/4'], 0);
    await answer('/d/2', 2);
    await answer('/d/3', null, { 'Retry-After': '5' }, 429);
    await run;
    http.expectNone('/d/1');
    http.expectNone('/d/4');
    expect((await readSaved(USER, '/d/2'))?.data).toBe(2);
  });

  it('does not prefetch when the user asked to save data', async () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
    await cache.prefetch(['/d/2'], 0);
    http.expectNone('/d/2');
    vi.unstubAllGlobals();
  });

  it('saves the first screen under the routes it stands for', async () => {
    cache.bootstrap('/b');
    await answer('/b/cached/bootstrap', { mail: ['m'], folders: ['f'], chats: ['c'] });
    expect((await readSaved(USER, '/b/cached/mail?folder=inbox&top=25&unread=false'))?.data).toEqual(['m']);
    expect((await readSaved(USER, '/b/cached/mail/folders'))?.data).toEqual(['f']);
    expect((await readSaved(USER, '/b/cached/chats?top=25'))?.data).toEqual(['c']);
  });

  it('every way of being signed out deletes the saved mail', async () => {
    for (const leave of [() => auth.signedOutElsewhere(), () => auth.signInAgain()]) {
      patchState(auth as never, { accessToken: token(USER), status: 'signedIn' } as never);
      await writeSaved(USER, URL_A, { data: ['mail'], etag: null, at: Date.now() });
      expect(await names()).toContain(`schuly-cache-${USER}`);
      leave();
      await settle();
      expect(await names()).not.toContain(`schuly-cache-${USER}`);
    }
  });

  it('signing out clears the server memory first, then the browser', async () => {
    await writeSaved(USER, URL_A, { data: ['mail'], etag: null, at: Date.now() });
    const out = auth.signOut();
    await answer('/api/plugins/microsoft/cached', null, {}, 204);
    await settle();
    http.match(() => true).forEach((r) => r.flush({}));
    await out;
    expect(await names()).not.toContain(`schuly-cache-${USER}`);
  });

  it('signing out still clears the browser when the server can not be reached', async () => {
    await writeSaved(USER, URL_A, { data: ['mail'], etag: null, at: Date.now() });
    const out = auth.signOut();
    await settle();
    http.match(() => true).forEach((r) => r.flush(null, { status: 500, statusText: 'x' }));
    await settle();
    http.match(() => true).forEach((r) => r.flush(null, { status: 500, statusText: 'x' }));
    await out;
    expect(await names()).not.toContain(`schuly-cache-${USER}`);
  });
});

describe('MailStore optimistic updates', () => {
  const USER = 'user-3';
  const BASE = '/api/plugins/microsoft/accounts/acc1';
  const KEY = `${BASE}/cached/mail?folder=inbox&top=25&unread=false`;

  const start = async () => {
    await clearBrowserCaches();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), MailStore, { provide: LinkedAccountsStore, useValue: { loaded: () => true, selectedId: () => 'acc1', endpoint: () => BASE } }],
    });
    patchState(TestBed.inject(AuthStore) as never, { accessToken: token(USER), status: 'signedIn' } as never);
    const store = TestBed.inject(MailStore);
    TestBed.tick();
    await settle();
    TestBed.inject(HttpTestingController).expectOne((r) => r.url === `${BASE}/cached/mail`).flush([{ id: 'a', isRead: false }, { id: 'b', isRead: false }], { headers: { ETag: '"1"' } });
    await settle();
    return store;
  };

  it('shows the change at once, here and in the saved list, and keeps it when the server agrees', async () => {
    const store = await start();
    let finish!: (ok: boolean) => void;
    const running = store.optimistic((items) => items.filter((m) => m.id !== 'a'), () => new Promise<boolean>((resolve) => (finish = resolve)));
    await settle();
    expect(store.items().map((m) => m.id)).toEqual(['b']);
    expect(await readSaved(USER, KEY)).toMatchObject({ data: [{ id: 'b', isRead: false }], etag: null });
    finish(true);
    expect(await running).toBe(true);
    expect(store.items().map((m) => m.id)).toEqual(['b']);
  });

  it('undoes both when the server refuses', async () => {
    const store = await start();
    expect(await store.optimistic((items) => items.map((m) => ({ ...m, isRead: true })), async () => false)).toBe(false);
    expect(store.items().every((m) => m.isRead === false)).toBe(true);
    expect(await readSaved(USER, KEY)).toMatchObject({ data: [{ id: 'a', isRead: false }, { id: 'b', isRead: false }], etag: '"1"' });
  });
});

describe('keepFresh', () => {
  afterEach(() => vi.useRealTimers());

  it('runs on a timer while visible, not while hidden, and when the tab comes back', () => {
    vi.useFakeTimers();
    let hidden = false;
    const spy = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const refresh = vi.fn();
    const stop = keepFresh(refresh, 30_000);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    hidden = true;
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
