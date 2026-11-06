import { t } from '../core/i18n';
import { swrCache } from '../core/swr-cache';
import { clearBrowserCaches } from '../core/browser-cache';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Observable, catchError, finalize, firstValueFrom, from, map, of, shareReplay } from 'rxjs';
import { clearSignedIn, markSignedIn } from '../core/signed-in-at';
import { beginExternalSignIn } from '../core/external-sign-in';
import { rememberReturnUrl } from '../core/return-url';
import { AuthApi, SignInResponse, TokenResponse, isChallenge, isEmailVerification } from '../core/auth-api';

export type AuthStatus = 'unknown' | 'signedIn' | 'signedOut';

interface AuthState {
  accessToken: string | null;
  status: AuthStatus;
  challenge: string | null;
  emailChallenge: EmailChallenge | null;
}

export interface EmailChallenge {
  challenge: string;
  email: string | null;
  method: string;
}

export type SignInResult = 'signedIn' | 'challenge' | 'email';

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>({ accessToken: null, status: 'unknown', challenge: null, emailChallenge: null }),
  withMethods((store, api = inject(AuthApi), router = inject(Router), http = inject(HttpClient)) => {
    let refreshing: Observable<string | null> | null = null;

    const accept = (tokens: TokenResponse, signedIn = true) => {
      if (signedIn) markSignedIn();
      saveSession(tokens);
      patchState(store, { accessToken: tokens.access_token, status: 'signedIn', challenge: null, emailChallenge: null });
    };
    const handle = (response: SignInResponse): SignInResult => {
      if (isEmailVerification(response)) {
        patchState(store, {
          emailChallenge: {
            challenge: response.challenge,
            email: response.email ?? null,
            method: response.method,
          },
        });
        return 'email';
      }
      if (isChallenge(response)) {
        patchState(store, { challenge: response.challenge, emailChallenge: null });
        return 'challenge';
      }
      accept(response);
      return 'signedIn';
    };
    // Every way of ending up signed out passes here, so saved mail and chats can't outlast a session on a shared computer.
    const clear = () => {
      swrCache.clear();
      void clearBrowserCaches();
      saveSession(null);
      clearSignedIn();
      patchState(store, { accessToken: null, status: 'signedOut', challenge: null, emailChallenge: null });
    };

    const refresh = (): Observable<string | null> => {
      refreshing ??= exclusive(() => firstValueFrom(api.refresh())).pipe(
        map((tokens) => {
          accept(tokens, false);
          return tokens.access_token;
        }),
        catchError(() => {
          clear();
          return of(null);
        }),
        finalize(() => (refreshing = null)),
        shareReplay(1),
      );
      return refreshing;
    };

    return {
      refresh,
      async restore(): Promise<void> {
        const saved = readSession();
        if (saved) patchState(store, { accessToken: saved, status: 'signedIn' });
        else await firstValueFrom(refresh());
      },
      async signIn(identifier: string, password: string): Promise<SignInResult> {
        return handle(await firstValueFrom(api.login(identifier, password)));
      },
      async verifyEmailCode(code: string): Promise<'signedIn' | 'challenge'> {
        const pending = store.emailChallenge();
        if (!pending) throw new Error('No email confirmation is waiting for a code.');
        const result = handle(await firstValueFrom(api.verifyEmailCode(pending.challenge, code)));
        return result === 'email' ? 'challenge' : result;
      },
      async resendEmailCode(): Promise<void> {
        const pending = store.emailChallenge();
        if (!pending) throw new Error('No email confirmation is waiting for a code.');
        await firstValueFrom(api.resendEmailCode(pending.challenge));
      },
      cancelEmailChallenge(): void {
        patchState(store, { emailChallenge: null });
      },
      async signInExternal(code: string, verifier: string): Promise<SignInResult> {
        return handle(await firstValueFrom(api.exchangeExternal(code, verifier)));
      },
      async verifyCode(code: string, rememberDevice: boolean): Promise<void> {
        const challenge = store.challenge();
        if (!challenge) throw new Error('No sign-in is waiting for a code.');
        accept(await firstValueFrom(api.verifyTwoFactor(challenge, code, rememberDevice)));
      },
      async register(userName: string, email: string, password: string): Promise<'signedIn' | 'email'> {
        const response = await firstValueFrom(api.register(userName, email, password));
        if (isEmailVerification(response)) {
          handle(response);
          return 'email';
        }
        accept(response);
        await firstValueFrom(api.requestEmailVerification(email, password)).catch(() => undefined);
        return 'signedIn';
      },
      cancelChallenge(): void {
        patchState(store, { challenge: null });
      },
      async signOut(): Promise<void> {
        // Plugins get no sign-out event, and this needs the session that logout ends. A server without the plugin answers 404.
        await firstValueFrom(http.delete('/api/plugins/microsoft/cached')).catch(() => undefined);
        await firstValueFrom(api.logout()).catch(() => undefined);
        clear();
        await clearBrowserCaches();
        await router.navigateByUrl('/login');
      },
      signedOutElsewhere(): void {
        clear();
        void router.navigateByUrl('/login');
      },
      signInAgain(): void {
        clear();
        void router.navigate(['/login'], { queryParams: { changed: 1 } });
      },
      /** Proves it's you for an account without a password: a fresh sign-in at a linked provider, which comes back to `returnPath`. */
      async reauthenticate(provider: string, returnPath: string): Promise<void> {
        await firstValueFrom(api.logout()).catch(() => undefined);
        clear();
        rememberReturnUrl(returnPath);
        await beginExternalSignIn(provider, '/login');
      },
    };
  }),
);

/** Reads the machine code (e.g. invalid_code) from an error body, tolerating several shapes. */
export function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body: unknown = error.error;
  if (typeof body !== 'object' || !body) return null;
  const record = body as Record<string, unknown>;
  for (const key of ['error', 'code']) {
    if (typeof record[key] === 'string') return record[key];
  }
  if (Array.isArray(record['errors'])) {
    const hit = record['errors'].find((item) => typeof item === 'string' && /^[a-z_]+$/.test(item));
    if (typeof hit === 'string') return hit;
  }
  return null;
}

export function authErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (typeof body === 'object' && body) {
      if (Array.isArray(body.errors) && body.errors.length) return body.errors.join(' ');
      if (typeof body.error_description === 'string') return body.error_description;
    }
    if (error.status === 429) return t('auth.tooMany');
    if (error.status === 0) return t('auth.unreachable');
  }
  return fallback;
}

const sessionKey = 'schuly-session';

function saveSession(tokens: TokenResponse | null): void {
  try {
    if (tokens) sessionStorage.setItem(sessionKey, JSON.stringify({ token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 }));
    else sessionStorage.removeItem(sessionKey);
  } catch {}
}

function readSession(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null') as { token: string; expiresAt: number } | null;
    return saved && saved.expiresAt - Date.now() > 60_000 ? saved.token : null;
  } catch {
    return null;
  }
}

function exclusive<T>(work: () => Promise<T>): Observable<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return from(locks ? locks.request('schuly-refresh', work) : work());
}
