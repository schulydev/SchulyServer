import { t } from '../core/i18n';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStoreFeature, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { Observable, pipe, switchMap, tap } from 'rxjs';

export interface CollectionState<T> {
  items: T[];
  loading: boolean;
  error: string | null;
}

export function withCollection<T>(fetcher: () => () => Observable<T[]>) {
  return signalStoreFeature(
    withState<CollectionState<T>>({ items: [], loading: false, error: null }),
    withMethods((store) => {
      const fetch = fetcher();
      return {
        /** Empties the list at once, e.g. when the account behind it was unlinked. */
        clear: () => patchState(store, { items: [] }),
        load: rxMethod<void>(
          pipe(
            tap(() => patchState(store, { loading: true, error: null })),
            switchMap(() =>
              fetch().pipe(
                tapResponse({
                  next: (items) => patchState(store, { items, loading: false }),
                  error: () => patchState(store, { loading: false, error: t('account.failed.title') + '.' }),
                }),
              ),
            ),
          ),
        ),
      };
    }),
    withHooks({ onInit: (store) => store.load() }),
  );
}
