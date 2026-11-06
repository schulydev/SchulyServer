import { t } from '../core/i18n';
import { computed, inject } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { ApplicationUserDto, AuthService, MeService } from '../api';
import { AuthStore } from './auth.store';
import { apiMessage } from '../core/chat-api';
import { initials } from '../core/initials';

interface UserState {
  user: ApplicationUserDto | null;
  loading: boolean;
  busy: boolean;
  deleteError: string | null;
}

export const UserStore = signalStore(
  withState<UserState>({ user: null, loading: false, busy: false, deleteError: null }),
  withComputed(({ user }) => {
    const name = computed(() => {
      const schoolUser = user()?.schoolUsers?.find((s) => s.firstName);
      return (
        (schoolUser && `${schoolUser.firstName} ${schoolUser.lastName ?? ''}`.trim()) ||
        user()?.displayName ||
        user()?.email ||
        'Schuly'
      );
    });
    return {
      name,
      email: computed(() => user()?.email ?? ''),
      avatar: computed(() => user()?.profilePictureUrl ?? null),
      initials: computed(() => initials(name())),
      schoolCount: computed(() => user()?.schoolUsers?.length ?? 0),
    };
  }),
  withMethods(
    (store, api = inject(AuthService), me = inject(MeService), auth = inject(AuthStore)) => {
      const load = rxMethod<void>(
        pipe(
          tap(() => patchState(store, { loading: true })),
          switchMap(() =>
            api.apiAuthMeGet().pipe(
              tapResponse({
                next: (user) => patchState(store, { user, loading: false }),
                error: () => patchState(store, { loading: false }),
              }),
            ),
          ),
        ),
      );
      const afterChange = {
        next: () => {
          patchState(store, { busy: false });
          load();
        },
        error: () => patchState(store, { busy: false }),
      };
      return {
        load,
        logout(): void {
          void auth.signOut();
        },
        uploadAvatar(file: File): void {
          patchState(store, { busy: true });
          me.apiMeAvatarPut(file).subscribe(afterChange);
        },
        removeAvatar(): void {
          patchState(store, { busy: true });
          me.apiMeAvatarDelete().subscribe(afterChange);
        },
        exportData(): void {
          patchState(store, { busy: true });
          api.apiAuthMeExportGet().subscribe({
            next: (data) => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
              );
              const link = Object.assign(document.createElement('a'), {
                href: url,
                download: 'schuly-export.json',
              });
              link.click();
              // Revoking right after click() cancels the download in some browsers.
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
              patchState(store, { busy: false });
            },
            error: () => patchState(store, { busy: false }),
          });
        },
        deleteAccount(password: string): void {
          patchState(store, { busy: true, deleteError: null });
          api.apiAuthMeDelete({ password: password || null }).subscribe({
            next: () => void auth.signOut(),
            error: (error: unknown) => patchState(store, { busy: false, deleteError: apiMessage(error, t('account.deleteFailed')) }),
          });
        },
      };
    },
  ),
  withHooks({ onInit: (store) => store.load() }),
);
