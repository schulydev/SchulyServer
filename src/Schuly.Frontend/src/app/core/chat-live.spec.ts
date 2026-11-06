import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../stores/auth.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { ChatLive, ChatLiveEvent, LiveRefresher, parseLiveEvent, pollDue, readLiveEvents } from './chat-live';

const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe('parseLiveEvent', () => {
  it('reads what the stream sends', () => {
    expect(parseLiveEvent('{"kind":"connected"}')).toEqual({ kind: 'connected' });
    expect(parseLiveEvent('{"kind":"message","chatId":"sealed","fromMe":true}')).toEqual({ kind: 'message', chatId: 'sealed', fromMe: true });
    expect(parseLiveEvent('{"kind":"message_deleted","chatId":"sealed"}')).toEqual({ kind: 'message_deleted', chatId: 'sealed', fromMe: false });
  });

  it('drops anything else', () => {
    for (const data of ['not json', 'null', '7', '[]', '{"kind":"typing","chatId":"a"}', '{"kind":"message"}', '{"kind":"message","chatId":""}', '{"kind":"message","chatId":7}']) {
      expect(parseLiveEvent(data), data).toBeNull();
    }
  });
});

describe('readLiveEvents', () => {
  it('survives an event split across chunks, and skips pings', async () => {
    const events: ChatLiveEvent[] = [];
    await readLiveEvents(streamOf(': ping\n\ndata: {"kind":"conn', 'ected"}\n\n: ping\n\ndata: {"kind":"message","chatId":"a","fromMe":false}\n', '\n'), (e) => events.push(e));
    expect(events).toEqual([{ kind: 'connected' }, { kind: 'message', chatId: 'a', fromMe: false }]);
  });
});

describe('pollDue', () => {
  it('polls on every tick without the stream, and only as a safety net with it', () => {
    expect(pollDue(false, 1000, 1001, 60_000)).toBe(true);
    expect(pollDue(true, 1000, 1001, 60_000)).toBe(false);
    expect(pollDue(true, 1000, 61_000, 60_000)).toBe(true);
  });
});

describe('LiveRefresher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rig = (open: string | null) => {
    const refreshOpen = vi.fn();
    const refreshList = vi.fn();
    return { refreshOpen, refreshList, refresher: new LiveRefresher(() => open, refreshOpen, refreshList) };
  };

  it('turns a burst into one refresh', () => {
    const { refresher, refreshOpen, refreshList } = rig('a');
    refresher.push({ kind: 'message_updated', chatId: 'a', fromMe: false });
    vi.advanceTimersByTime(100);
    refresher.push({ kind: 'message_updated', chatId: 'a', fromMe: false });
    expect(refreshOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(refreshOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(refreshList).toHaveBeenCalledOnce();
  });

  it('refreshes only the list for another chat', () => {
    const { refresher, refreshOpen, refreshList } = rig('a');
    refresher.push({ kind: 'message', chatId: 'b', fromMe: false });
    vi.advanceTimersByTime(300);
    expect(refreshOpen).not.toHaveBeenCalled();
    expect(refreshList).toHaveBeenCalledOnce();
  });

  it('calls only someone else\'s message new, and catches up on connected', () => {
    const { refresher, refreshOpen } = rig('a');
    refresher.push({ kind: 'message', chatId: 'a', fromMe: true });
    vi.advanceTimersByTime(300);
    expect(refreshOpen).toHaveBeenLastCalledWith(false);
    refresher.push({ kind: 'message', chatId: 'a', fromMe: false });
    vi.advanceTimersByTime(300);
    expect(refreshOpen).toHaveBeenLastCalledWith(true);
    refresher.push({ kind: 'connected' });
    vi.advanceTimersByTime(300);
    expect(refreshOpen).toHaveBeenLastCalledWith(false);
  });

  it('does nothing after stopping', () => {
    const { refresher, refreshList } = rig('a');
    refresher.push({ kind: 'connected' });
    refresher.stop();
    vi.advanceTimersByTime(300);
    expect(refreshList).not.toHaveBeenCalled();
  });
});

describe('ChatLive', () => {
  let hidden = false;
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

  /** A stream that stays open, as a quiet feed does, until the request is aborted. */
  const openStream = (signal: AbortSignal, ...events: string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          events.forEach((data) => controller.enqueue(encoder.encode(`data: ${data}\n\n`)));
          signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      }),
    );

  const start = () => {
    TestBed.configureTestingModule({
      providers: [
        ChatLive,
        { provide: AuthStore, useValue: { accessToken: () => 'token-1', refresh: () => of('token-2') } },
        { provide: LinkedAccountsStore, useValue: { endpoint: () => '/api/plugins/microsoft/accounts/1' } },
      ],
    });
    const live = TestBed.inject(ChatLive);
    const events: ChatLiveEvent[] = [];
    live.listen((e) => events.push(e));
    TestBed.tick();
    return { live, events };
  };

  const settled = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve));
  };

  beforeEach(() => {
    hidden = false;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('connects with the bearer token, is live once connected, and closes with the page', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url, init) => {
      signal = init.signal!;
      return openStream(init.signal!, '{"kind":"connected"}', '{"kind":"message","chatId":"a","fromMe":false}');
    });
    const { live, events } = start();
    expect(live.connected()).toBe(false);
    await settled();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/plugins/microsoft/accounts/1/chats/live');
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)['Authorization']).toBe('Bearer token-1');
    expect(live.connected()).toBe(true);
    expect(events.length).toBe(2);
    TestBed.resetTestingModule();
    expect(signal!.aborted).toBe(true);
    await settled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('closes while the tab is hidden and reconnects when it shows', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      signals.push(init.signal!);
      return openStream(init.signal!, '{"kind":"connected"}');
    });
    const { live } = start();
    await settled();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(signals[0].aborted).toBe(true);
    expect(live.connected()).toBe(false);
    await settled();
    expect(fetchMock).toHaveBeenCalledOnce();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(live.connected()).toBe(true);
  });

  it('tries a refreshed token once after a 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    fetchMock.mockImplementation(async (_url, init) => openStream(init.signal!, '{"kind":"connected"}'));
    const { live } = start();
    await settled();
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>)['Authorization']).toBe('Bearer token-2');
    expect(live.connected()).toBe(true);
  });

  it('waits longer after each failure and stops growing at a minute', async () => {
    const realSetTimeout = globalThis.setTimeout;
    const waits: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms) waits.push(ms);
      return realSetTimeout(ms ? () => undefined : fn, 0);
    }) as typeof setTimeout);
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    start();
    await settled();
    const live = TestBed.inject(ChatLive) as unknown as { restart(): void };
    for (let i = 0; i < 5; i++) {
      live.restart();
      await settled();
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it.each([404, 409])('gives up on a %i rather than logging errors forever', async (status) => {
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    fetchMock.mockImplementation(async () => new Response(null, { status }));
    start();
    await settled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(timeouts.mock.calls.filter(([, ms]) => (ms ?? 0) >= 5_000)).toEqual([]);
  });

  it('honours Retry-After when it is longer', async () => {
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    fetchMock.mockImplementation(async () => new Response(null, { status: 429, headers: { 'Retry-After': '45' } }));
    start();
    await settled();
    expect(timeouts.mock.calls.some(([, ms]) => ms === 45_000)).toBe(true);
  });
});
