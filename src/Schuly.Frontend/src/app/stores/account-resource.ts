import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStoreFeature, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { Observable, Subject, map, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { swrCache } from '../core/swr-cache';
import { ResponseCache } from '../core/response-cache';
import { CapabilityKind, LinkedAccountsStore } from './linked-accounts.store';
import { DataRefresh } from './data-refresh';

export type AccountProblem = 'expired' | 'missing' | 'failed';

export const accountProblemText: Record<AccountProblem, { title: string; description: string }> = {
  expired: {
    title: 'Sign-in expired',
    description: 'Your sign-in for this account expired. Re-authenticate it in Settings > Schools & accounts.',
  },
  missing: {
    title: 'Account not available',
    description: 'This account was removed or is not available any more.',
  },
  failed: { title: 'Could not load data', description: 'The service did not respond. Try again later.' },
};

type ResourceParams = Record<string, string | number | boolean>;

/** Lets a resource choose its route and read its list from the params, for lists that live under more than one route. */
export interface ResourceRouting<T> {
  route: (params: ResourceParams) => { path: string; query: ResourceParams };
  /** The route that draws from the browser first and revalidates (see ResponseCache), for the params it can answer. */
  cached?: (params: ResourceParams) => { path: string; query: ResourceParams } | null;
  /** Reads the list out of a response body that is not the list itself. */
  unwrap?: (body: unknown) => T[];
}

/** Paging by growing the page: the endpoints take `top` but no cursor, so "more" asks again for a longer list. */
export interface ResourcePaging {
  /** First page size and the step each "load more" adds. */
  pageSize: number;
  /** Largest `top` the endpoint accepts. */
  max: number;
}

interface ResourceState<T> {
  items: T[];
  loading: boolean;
  problem: AccountProblem | null;
  params: ResourceParams;
  /** The `top` currently requested; only meaningful for paged resources. */
  top: number;
  loadingMore: boolean;
  moreFailed: boolean;
  /** Whether the last response was full and `top` can still grow. */
  more: boolean;
  /** Result of the last successful "load more"; a new object each time so it can be announced again. */
  loadedMore: { count: number } | null;
}

interface ResourceRequest {
  id: string | null;
  base: string | null;
  params: ResourceParams;
  top: number;
  more: boolean;
  silent?: boolean;
}

// The plugin answers an expired sign-in with 409; a 401 is the Schuly session and the auth interceptor handles it.
const PREFETCH_FRESH_MS = 30_000;

const cacheKey = (id: string, resource: string, params: ResourceParams, top: number) =>
  `${id}|${resource}|${JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}|${top}`;

const problemOf = (error: unknown): AccountProblem =>
  error instanceof HttpErrorResponse && error.status === 409
    ? 'expired'
    : error instanceof HttpErrorResponse && error.status === 404
      ? 'missing'
      : 'failed';

/**
 * Loads a list from `<capability basePath>/{id}/{resource}` for the selected account of a capability kind, reloading when the account or a query parameter changes.
 * With `paging`, `loadMore()` requests a longer list while the current items stay on screen; any reload starts again at one page.
 */
export function withAccountResource<T>(kind: CapabilityKind, resource: string, params: ResourceParams = {}, paging?: ResourcePaging, routing?: ResourceRouting<T>) {
  const route = (p: ResourceParams) => (routing ? routing.route(p) : { path: resource, query: p });
  const read = (body: unknown): T[] => (routing?.unwrap ? routing.unwrap(body) : Array.isArray(body) ? (body as T[]) : []);
  const pageSize = paging?.pageSize ?? 0;
  return signalStoreFeature(
    withState<ResourceState<T>>({
      items: [],
      loading: false,
      problem: null,
      params,
      top: pageSize,
      loadingMore: false,
      moreFailed: false,
      more: false,
      loadedMore: null,
    }),
    withComputed((store) => {
      const accounts = inject(LinkedAccountsStore);
      return { waiting: computed(() => !accounts.loaded()), hasMore: computed(() => store.more()) };
    }),
    withMethods((store) => {
      const http = inject(HttpClient);
      const accounts = inject(LinkedAccountsStore);
      const responses = inject(ResponseCache);
      const requests = new Subject<ResourceRequest>();
      /** The answer for these params: saved first, then changes, where a cached route exists. */
      const load = (base: string, params: ResourceParams, top: number): Observable<unknown> => {
        const live = route(params);
        const liveQuery = paging ? { ...live.query, top } : live.query;
        const cached = routing?.cached?.(params);
        return cached ? responses.swr<unknown>(`${base}/${cached.path}`, paging ? { ...cached.query, top } : cached.query, `${base}/${live.path}`) : http.get<unknown>(`${base}/${live.path}`, { params: liveQuery });
      };

      requests
        .pipe(
          tap((r) => {
            if (r.silent) return;
            if (r.more) return patchState(store, { loadingMore: true, moreFailed: false });
            // Stale-while-revalidate: a cached list shows at once and is refreshed below.
            const hit = r.id ? swrCache.get<T[]>(cacheKey(r.id, resource, r.params, paging ? r.top : 0)) : null;
            patchState(store, {
              items: hit?.data ?? [],
              problem: null,
              loading: !!r.id && !hit,
              top: r.top,
              loadingMore: false,
              moreFailed: false,
              more: !!hit && !!paging && hit.data.length >= r.top && r.top < paging.max,
              loadedMore: null,
            });
          }),
          switchMap((r) => {
            if (!r.id || !r.base) return of(null);
            return load(r.base, r.params, r.top).pipe(
              map(read),
              tapResponse({
                next: (items) => {
                  swrCache.set(cacheKey(r.id!, resource, r.params, paging ? r.top : 0), items);
                  patchState(store, {
                    items,
                    loading: false,
                    loadingMore: false,
                    more: !!paging && items.length >= r.top && r.top < paging.max,
                    loadedMore: r.more ? { count: Math.max(0, items.length - store.items().length) } : null,
                  });
                },
                error: (error) =>
                  r.more
                    ? patchState(store, { loadingMore: false, moreFailed: true, top: Math.max(pageSize, r.top - pageSize) })
                    : // A failed refresh keeps the cached list on screen.
                      patchState(store, store.items().length ? { loading: false } : { loading: false, problem: problemOf(error) }),
              }),
            );
          }),
          takeUntilDestroyed(inject(DestroyRef)),
        )
        .subscribe();

      return {
        /** Changes one query parameter and reloads the list from the first page. */
        setParam: (key: string, value: string | number | boolean) =>
          patchState(store, { params: { ...store.params(), [key]: value } }),
        /** Warms the cache for another parameter set (hover or focus) without touching what is on screen. */
        prefetch: (extra: ResourceParams) => {
          const id = accounts.selectedId(kind);
          const base = accounts.endpoint(kind);
          if (!id || !base) return;
          const params = { ...store.params(), ...extra };
          const key = cacheKey(id, resource, params, paging ? pageSize : 0);
          const hit = swrCache.get(key);
          if (hit && hit.age < PREFETCH_FRESH_MS) return;
          load(base, params, pageSize).subscribe({ next: (body) => swrCache.set(key, read(body)), error: () => undefined });
        },
        /** Reloads from the first page for the selected account. */
        reload: () => requests.next({ id: accounts.selectedId(kind), base: accounts.endpoint(kind), params: store.params(), top: pageSize, more: false }),
        /** Checks for changes behind what is on screen, which stays until a different list arrives. */
        refresh: () => requests.next({ id: accounts.selectedId(kind), base: accounts.endpoint(kind), params: store.params(), top: store.top(), more: false, silent: true }),
        /** Asks for one more page; the current items stay until the longer list arrives. */
        loadMore: () => {
          if (!paging || !store.more() || store.loading() || store.loadingMore()) return;
          const top = Math.min(store.top() + pageSize, paging.max);
          patchState(store, { top });
          requests.next({ id: accounts.selectedId(kind), base: accounts.endpoint(kind), params: store.params(), top, more: true });
        },
      };
    }),
    withHooks({
      onInit: (store) => {
        const accounts = inject(LinkedAccountsStore);
        const refresh = inject(DataRefresh, { optional: true });
        effect(() => {
          accounts.selectedId(kind);
          accounts.endpoint(kind);
          refresh?.revision();
          store.params();
          untracked(() => store.reload());
        });
      },
    }),
  );
}
