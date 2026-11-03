import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { ChatApi } from './chat-api';
import { ThrottledError, throttleWait, waitFromHeader } from './throttle';

const BASE = '/api/plugins/microsoft/accounts/a1';

describe('throttleWait', () => {
  it('reads the wait of a 429 and nothing else', () => {
    expect(throttleWait(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '62' }) }))).toBe(62_000);
    expect(throttleWait(new HttpErrorResponse({ status: 404 }))).toBeNull();
    expect(throttleWait(new Error('x'))).toBeNull();
    expect(throttleWait(new ThrottledError(1234))).toBe(1234);
  });

  it('keeps the wait calm', () => {
    expect(waitFromHeader('1')).toBe(5_000);
    expect(waitFromHeader('86400')).toBe(300_000);
    expect(waitFromHeader(null)).toBe(30_000);
    expect(waitFromHeader('soon')).toBe(30_000);
  });
});

describe('ChatApi images under throttling', () => {
  let api: ChatApi;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    TestBed.configureTestingModule({
      providers: [ChatApi, provideHttpClient(), provideHttpClientTesting(), { provide: LinkedAccountsStore, useValue: { selectedId: () => 'a1', endpoint: () => BASE } }],
    });
    api = TestBed.inject(ChatApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const answer429 = (url: string, seconds: number) => http.expectOne(url).flush(new Blob(), { status: 429, statusText: 'Too Many', headers: { 'Retry-After': String(seconds) } });

  it('a throttled thumbnail waits, asks again once, and shows', async () => {
    const image = api.imageUrl('t1');
    await vi.advanceTimersByTimeAsync(0);
    answer429(`${BASE}/t1`, 20);
    await vi.advanceTimersByTimeAsync(19_000);
    http.expectNone(`${BASE}/t1`);
    await vi.advanceTimersByTimeAsync(1_000);
    http.expectOne(`${BASE}/t1`).flush(new Blob(['x']));
    await expect(image).resolves.toBe('blob:x');
  });

  it('one throttle holds back every other request until the wait is over', async () => {
    const first = api.imageUrl('t1');
    await vi.advanceTimersByTimeAsync(0);
    answer429(`${BASE}/t1`, 30);
    await vi.advanceTimersByTimeAsync(0);
    const second = api.imageUrl('t2');
    await expect(api.blob('f1')).rejects.toBeInstanceOf(ThrottledError);
    await expect(api.streamUrl('f1')).rejects.toBeInstanceOf(ThrottledError);
    await vi.advanceTimersByTimeAsync(1_000);
    http.expectNone(`${BASE}/t2`);
    http.expectNone(`${BASE}/f1`);
    await vi.advanceTimersByTimeAsync(29_000);
    http.expectOne(`${BASE}/t1`).flush(new Blob(['x']));
    http.expectOne(`${BASE}/t2`).flush(new Blob(['y']));
    await expect(first).resolves.toBe('blob:x');
    await expect(second).resolves.toBe('blob:x');
  });

  it('a missing picture is remembered, so it is asked for once', async () => {
    const first = api.imageUrl('gone');
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(`${BASE}/gone`).flush(new Blob(), { status: 404, statusText: 'Not Found' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBeNull();
    await expect(api.imageUrl('gone')).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    http.expectNone(`${BASE}/gone`);
  });

  it('never asks for more than three at once', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) void api.imageUrl(name);
    await vi.advanceTimersByTimeAsync(0);
    expect(http.match(() => true).length).toBe(3);
  });
});
