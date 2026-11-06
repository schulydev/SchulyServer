import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { toDataURL } from 'qrcode';
import { AuthApi, LinkedSignIn, SessionSummary, SignInProof, SignInProvider, TrustedDevice, TwoFactorStatus } from '../core/auth-api';
import { externalError, newLinkState, returnUrl, takePending } from '../core/external-sign-in';
import { t } from '../core/i18n';
import { AuthStore } from './auth.store';
import { authErrorMessage } from './auth.store';

interface SecurityState {
  twoFactor: TwoFactorStatus | null;
  devices: TrustedDevice[];
  sessions: SessionSummary[];
  providers: SignInProvider[];
  linked: LinkedSignIn[];
  setup: { secret: string; qr: string } | null;
  recoveryCodes: string[] | null;
  busy: boolean;
  /** The last action's failure, shown in the dialog that started it. */
  error: string | null;
  notice: string | null;
  signInAgain: string | null;
}

export interface ProviderRow {
  key: string;
  name: string;
  iconUrl: string | null;
}

/** Password, second factor, sign-in providers and sessions. Every action reports success, so the dialog that started it knows whether to close. */
export const SecurityStore = signalStore(
  withState<SecurityState>({
    twoFactor: null,
    devices: [],
    sessions: [],
    providers: [],
    linked: [],
    setup: null,
    recoveryCodes: null,
    busy: false,
    error: null,
    notice: null,
    signInAgain: null,
  }),
  withComputed(({ providers, linked }) => ({
    /** Linked providers, including one no longer configured, which can still be unlinked. */
    linkedRows: computed<ProviderRow[]>(() =>
      linked().map((login) => {
        const configured = providers().find((p) => p.key === login.provider);
        return { key: login.provider, name: configured?.display_name ?? login.display_name ?? login.provider, iconUrl: configured?.icon_url ?? null };
      }),
    ),
    unlinkedRows: computed<ProviderRow[]>(() =>
      providers()
        .filter((p) => !linked().some((login) => login.provider === p.key))
        .map((p) => ({ key: p.key, name: p.display_name, iconUrl: p.icon_url ?? null })),
    ),
  })),
  withMethods((store, api = inject(AuthApi), auth = inject(AuthStore)) => {
    const run = async (action: () => Promise<void>, fallback: string): Promise<boolean> => {
      patchState(store, { busy: true, error: null, notice: null });
      try {
        await action();
        return true;
      } catch (error) {
        patchState(store, { error: authErrorMessage(error, fallback) });
        return false;
      } finally {
        patchState(store, { busy: false });
      }
    };
    const load = async () => {
      const [twoFactor, devices, sessions, providers] = await Promise.all([
        firstValueFrom(api.twoFactorStatus()),
        firstValueFrom(api.trustedDevices()).catch(() => []),
        firstValueFrom(api.sessions()).catch(() => []),
        firstValueFrom(api.providers()).catch(() => []),
      ]);
      // Without configured providers the server doesn't map the external endpoints at all.
      const linked = providers.length ? await firstValueFrom(api.linkedSignIns()).catch(() => []) : [];
      patchState(store, { twoFactor, devices, sessions, providers, linked });
    };

    return {
      load: () => run(load, t('settings.security.messages.loadFailed')),
      clearError: () => patchState(store, { error: null }),
      /** `currentPassword` null sets a first password. */
      setPassword: (currentPassword: string | null, newPassword: string) =>
        run(async () => {
          await firstValueFrom(api.changePassword(currentPassword, newPassword));
          patchState(store, { signInAgain: currentPassword === null ? t('settings.security.messages.passwordAdded') : t('settings.security.messages.passwordChanged') });
        }, t('settings.security.messages.checkCurrentPassword')),
      requestEmailChange: (email: string, currentPassword: string) =>
        run(async () => {
          await firstValueFrom(api.requestEmailVerification(email, currentPassword));
          patchState(store, { notice: t('settings.security.messages.emailSent', { email }) });
        }, t('settings.security.messages.checkPassword')),
      beginTwoFactor: (currentPassword: string | null) =>
        run(async () => {
          const { secret, uri } = await firstValueFrom(api.beginTwoFactor(currentPassword));
          patchState(store, { setup: { secret, qr: await toDataURL(uri, { margin: 1, width: 200 }) } });
        }, t('settings.security.messages.checkPassword')),
      confirmTwoFactor: (code: string) =>
        run(async () => {
          const { recoveryCodes } = await firstValueFrom(api.confirmTwoFactor(code));
          patchState(store, { setup: null, recoveryCodes });
        }, t('settings.security.messages.codeMismatch')),
      /** After the recovery codes are saved: turning the second factor on ended every session. */
      finishTwoFactor: () => patchState(store, { recoveryCodes: null, signInAgain: t('settings.security.messages.twoFactorOn') }),
      disableTwoFactor: (proof: string, currentPassword: string | null) =>
        run(async () => {
          await firstValueFrom(api.disableTwoFactor(proof, currentPassword));
          patchState(store, { signInAgain: t('settings.security.messages.twoFactorOff') });
        }, t('settings.security.messages.codeOrPassword')),
      linkProvider: (provider: string, proof: SignInProof) =>
        run(async () => {
          const { authorization_url } = await firstValueFrom(api.linkProvider(provider, returnUrl('/settings'), newLinkState(), proof));
          location.assign(authorization_url);
        }, t('settings.security.messages.codeOrPassword')),
      unlinkProvider: (provider: string, proof: SignInProof) =>
        run(async () => {
          await firstValueFrom(api.unlinkProvider(provider, proof));
          patchState(store, { signInAgain: t('settings.security.messages.unlinked') });
        }, t('settings.security.messages.unlinkFailed')),
      linkFinished: (linked: string | null, failure: string | null, state: string | null) => {
        const pending = takePending(state);
        if (failure) patchState(store, { error: externalError(failure) });
        else if (linked && pending) patchState(store, { notice: t('settings.security.messages.linked') });
      },
      signOutSession: (id: string) =>
        run(async () => {
          await firstValueFrom(api.revokeSession(id));
          patchState(store, { sessions: store.sessions().filter((s) => s.id !== id) });
        }, t('settings.security.messages.signOutFailed')),
      forgetDevices: () =>
        run(async () => {
          await firstValueFrom(api.forgetAllDevices());
          await load();
        }, t('settings.security.messages.forgetFailed')),
      cancelSetup: () => patchState(store, { setup: null, error: null }),
      continueToSignIn: () => {
        patchState(store, { recoveryCodes: null, signInAgain: null, setup: null, twoFactor: null, devices: [], sessions: [] });
        auth.signInAgain();
      },
    };
  }),
  withHooks({ onInit: (store) => void store.load() }),
);
