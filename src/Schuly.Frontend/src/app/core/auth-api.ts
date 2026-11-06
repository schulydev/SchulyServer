import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  recovery_codes_running_low?: boolean | null;
}

export interface ChallengeResponse {
  two_factor_required: true;
  challenge: string;
  expires_in: number;
}

export interface EmailVerificationResponse {
  email_verification_required: true;
  challenge: string;
  expires_in: number;
  method: string;
  email?: string | null;
}

export type SignInResponse = TokenResponse | ChallengeResponse | EmailVerificationResponse;
export type RegisterResponse = TokenResponse | EmailVerificationResponse;

export interface TwoFactorStatus {
  enabled: boolean;
  enrolmentPending?: boolean;
  recoveryCodesRemaining?: number;
}

export interface TwoFactorSetup {
  secret: string;
  uri: string;
}

export interface TrustedDevice {
  id: string;
  label?: string | null;
  createdAt?: string;
  lastUsedAt?: string | null;
  isCurrent?: boolean;
}

export interface SignInProvider {
  key: string;
  display_name: string;
  icon_url?: string | null;
}

export interface LinkedSignIn {
  provider: string;
  display_name?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
}

export interface SessionSummary {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent?: boolean;
}

export interface SignInProof {
  currentPassword?: string;
  code?: string;
}

export function isEmailVerification(
  response: SignInResponse,
): response is EmailVerificationResponse {
  return 'email_verification_required' in response && response.email_verification_required === true;
}

export function isChallenge(response: SignInResponse): response is ChallengeResponse {
  return 'two_factor_required' in response && response.two_factor_required === true;
}

const web = new HttpHeaders({ 'X-Schuly-Client': 'web' });

@Service()
export class AuthApi {
  private readonly http = inject(HttpClient);

  login(identifier: string, password: string): Observable<SignInResponse> {
    return this.http.post<SignInResponse>(
      '/auth/login',
      { identifier, password },
      { headers: web },
    );
  }

  verifyTwoFactor(
    challenge: string,
    code: string,
    rememberDevice: boolean,
  ): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(
      '/auth/2fa/verify',
      { challenge, code, rememberDevice, deviceLabel: deviceLabel() },
      { headers: web },
    );
  }

  register(userName: string, email: string, password: string): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(
      '/auth/register',
      { userName, email, password },
      { headers: web },
    );
  }

  verifyEmailCode(challenge: string, code: string): Observable<SignInResponse> {
    return this.http.post<SignInResponse>(
      '/auth/email/verify-code',
      { challenge, code },
      { headers: web },
    );
  }

  /** For a mistyped address: moves the pending confirmation to `newEmail` and answers with a new challenge. */
  changeEmailCodeAddress(challenge: string, newEmail: string): Observable<EmailVerificationResponse> {
    return this.http.post<EmailVerificationResponse>('/auth/email/change-address', { challenge, newEmail });
  }

  resendEmailCode(challenge: string): Observable<void> {
    return this.http.post<void>('/auth/email/resend-code', { challenge });
  }

  refresh(): Observable<TokenResponse> {
    return this.http.post<TokenResponse>('/auth/refresh', {}, { headers: web });
  }

  logout(): Observable<void> {
    return this.http.post<void>('/auth/logout', {}, { headers: web });
  }

  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>('/auth/password/forgot', { email });
  }

  resetPassword(token: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/auth/password/reset', { token, newPassword });
  }

  /** Leave out `currentPassword` to set a first password, which the server allows only right after a sign-in. */
  changePassword(currentPassword: string | null, newPassword: string): Observable<void> {
    return this.http.post<void>('/auth/password', currentPassword === null ? { newPassword } : { currentPassword, newPassword });
  }

  sessions(): Observable<SessionSummary[]> {
    return this.http.get<SessionSummary[]>('/auth/sessions');
  }

  revokeSession(id: string): Observable<void> {
    return this.http.delete<void>(`/auth/sessions/${encodeURIComponent(id)}`);
  }

  requestEmailVerification(newEmail: string, currentPassword: string): Observable<void> {
    return this.http.post<void>('/auth/email', { newEmail, currentPassword });
  }

  verifyEmail(token: string): Observable<void> {
    return this.http.post<void>('/auth/email/verify', { token });
  }

  twoFactorStatus(): Observable<TwoFactorStatus> {
    return this.http.get<TwoFactorStatus>('/auth/2fa');
  }

  beginTwoFactor(currentPassword: string | null): Observable<TwoFactorSetup> {
    return this.http.post<TwoFactorSetup>('/auth/2fa/begin', currentPassword ? { currentPassword } : {});
  }

  confirmTwoFactor(code: string): Observable<{ recoveryCodes: string[] }> {
    return this.http.post<{ recoveryCodes: string[] }>('/auth/2fa/confirm', { code });
  }

  disableTwoFactor(proof: string, currentPassword: string | null): Observable<void> {
    return this.http.post<void>('/auth/2fa/disable', currentPassword ? { proof, currentPassword } : { proof });
  }

  trustedDevices(): Observable<TrustedDevice[]> {
    return this.http.get<TrustedDevice[]>('/auth/devices');
  }

  forgetAllDevices(): Observable<void> {
    return this.http.delete<void>('/auth/devices');
  }

  providers(): Observable<SignInProvider[]> {
    return this.http.get<SignInProvider[]>('/auth/providers');
  }

  exchangeExternal(code: string, codeVerifier: string): Observable<SignInResponse> {
    return this.http.post<SignInResponse>('/auth/external/exchange', { code, codeVerifier }, { headers: web });
  }

  linkedSignIns(): Observable<LinkedSignIn[]> {
    return this.http.get<LinkedSignIn[]>('/auth/external/logins');
  }

  linkProvider(provider: string, returnUrl: string, state: string, proof: SignInProof): Observable<{ authorization_url: string }> {
    return this.http.post<{ authorization_url: string }>(`/auth/external/${encodeURIComponent(provider)}/link`, { returnUrl, state, ...proof });
  }

  unlinkProvider(provider: string, proof: SignInProof): Observable<void> {
    return this.http.delete<void>(`/auth/external/logins/${encodeURIComponent(provider)}`, { body: proof });
  }
}

function deviceLabel(): string {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser';
  const system = /Windows/.test(agent)
    ? 'Windows'
    : /Mac OS/.test(agent)
      ? 'macOS'
      : /Android/.test(agent)
        ? 'Android'
        : /iPhone|iPad/.test(agent)
          ? 'iOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : '';
  return system ? `${browser} on ${system}` : browser;
}
