import { inject } from '@angular/core';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { toDataURL } from 'qrcode';
import { AuthApi, LinkedSignIn, SignInProof, SignInProvider, TrustedDevice, TwoFactorStatus } from '../core/auth-api';
import { externalError, newLinkState, returnUrl, takePending } from '../core/external-sign-in';
import { AuthStore } from './auth.store';
import { authErrorMessage } from './auth.store';

interface SecurityState {
  twoFactor: TwoFactorStatus | null;
  devices: TrustedDevice[];
  providers: SignInProvider[];
  linked: LinkedSignIn[];
  setup: { secret: string; qr: string } | null;
  recoveryCodes: string[] | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  signInAgain: string | null;
}

export const SecurityStore = signalStore(
  withState<SecurityState>({
    twoFactor: null,
    devices: [],
    providers: [],
    linked: [],
    setup: null,
    recoveryCodes: null,
    busy: false,
    error: null,
    notice: null,
    signInAgain: null,
  }),
  withMethods((store, api = inject(AuthApi), auth = inject(AuthStore)) => {
    const run = async (action: () => Promise<void>, fallback: string) => {
      patchState(store, { busy: true, error: null, notice: null });
      try {
        await action();
      } catch (error) {
        patchState(store, { error: authErrorMessage(error, fallback) });
      } finally {
        patchState(store, { busy: false });
      }
    };
    const load = async () => {
      const [twoFactor, devices, providers] = await Promise.all([
        firstValueFrom(api.twoFactorStatus()),
        firstValueFrom(api.trustedDevices()),
        firstValueFrom(api.providers()).catch(() => []),
      ]);
      const linked = providers.length ? await firstValueFrom(api.linkedSignIns()) : [];
      patchState(store, { twoFactor, devices, providers, linked });
    };

    return {
      load: () => run(load, 'Could not load your security settings.'),
      changePassword: (currentPassword: string, newPassword: string) =>
        run(async () => {
          await firstValueFrom(api.changePassword(currentPassword, newPassword));
          patchState(store, {
            signInAgain: 'Your password is changed. Sign in again with the new one.',
          });
        }, 'That did not work. Check your current password.'),
      resendVerification: (email: string, currentPassword: string) =>
        run(async () => {
          await firstValueFrom(api.requestEmailVerification(email, currentPassword));
          patchState(store, { notice: `We sent a confirmation link to ${email}.` });
        }, 'That did not work. Check your password.'),
      beginTwoFactor: (currentPassword: string) =>
        run(async () => {
          const { secret, uri } = await firstValueFrom(api.beginTwoFactor(currentPassword));
          patchState(store, {
            setup: { secret, qr: await toDataURL(uri, { margin: 1, width: 200 }) },
          });
        }, 'That did not work. Check your password.'),
      confirmTwoFactor: (code: string) =>
        run(async () => {
          const { recoveryCodes } = await firstValueFrom(api.confirmTwoFactor(code));
          patchState(store, {
            setup: null,
            recoveryCodes,
            signInAgain:
              'Two-factor authentication is on. Sign in again with a code from your app.',
          });
        }, "That code didn't match. Try the current one from your app."),
      disableTwoFactor: (proof: string, currentPassword: string) =>
        run(async () => {
          await firstValueFrom(api.disableTwoFactor(proof, currentPassword));
          patchState(store, { signInAgain: 'Two-factor authentication is off. Sign in again.' });
        }, "That code or password didn't match."),
      linkProvider: (provider: string, proof: SignInProof) =>
        run(async () => {
          const { authorization_url } = await firstValueFrom(api.linkProvider(provider, returnUrl('/settings'), newLinkState(), proof));
          location.assign(authorization_url);
        }, "That code or password didn't match."),
      unlinkProvider: (provider: string, proof: SignInProof) =>
        run(async () => {
          await firstValueFrom(api.unlinkProvider(provider, proof));
          patchState(store, { signInAgain: 'The provider is unlinked. Sign in again.' });
        }, "That did not work. Check your code or password, and keep at least one way to sign in."),
      linkFinished: (linked: string | null, failure: string | null, state: string | null) => {
        const pending = takePending(state);
        if (failure) patchState(store, { error: externalError(failure) });
        else if (linked && pending) patchState(store, { notice: 'The provider is linked. You can now sign in with it.' });
      },
      forgetDevices: () =>
        run(async () => {
          await firstValueFrom(api.forgetAllDevices());
          await load();
        }, 'Could not forget your devices.'),
      cancelSetup: () => patchState(store, { setup: null, error: null }),
      continueToSignIn: () => {
        patchState(store, {
          recoveryCodes: null,
          signInAgain: null,
          setup: null,
          twoFactor: null,
          devices: [],
        });
        auth.signInAgain();
      },
    };
  }),
  withHooks({ onInit: (store) => void store.load() }),
);
