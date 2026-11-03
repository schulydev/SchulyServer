import { HttpClient } from '@angular/common/http';
import { Service, effect, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../stores/auth.store';

/** The same words as the mobile app's sign-up screen (Schuly/lib/l10n/app_en.arb, privacySignUpNotice). Change them together. */
export const PRIVACY_NOTICE =
  'Your Schuly account stores the school data you sync on the Schuly server: grades, timetable, agenda, and absences including their reasons. Absence reasons can reveal health information. You can export or delete your data in Settings at any time.';

export const SWISS_SCHOOL_CONFIRMATION = 'I attend a school in Switzerland.';

export const PRIVACY_POLICY_URL = 'https://schuly.dev/privacy';

export interface PrivacyNoticeStatus {
  policyVersion: string;
  policyUrl: string;
  acceptanceRequired: boolean;
  swissSchoolConfirmationRequired: boolean;
}

const BASE = '/api/auth/me/privacy-notice';

@Service()
export class PrivacyNoticeApi {
  private readonly http = inject(HttpClient);

  /** Set once the server said nothing is open, so moving around the app doesn't ask again. */
  private settled = false;

  constructor() {
    const auth = inject(AuthStore);
    effect(() => {
      // Another account may sign in next in this tab.
      if (auth.status() !== 'signedIn') this.settled = false;
    });
  }

  status(): Promise<PrivacyNoticeStatus> {
    return firstValueFrom(this.http.get<PrivacyNoticeStatus>(BASE));
  }

  async accept(policyVersion: string, swissSchoolConfirmed: boolean): Promise<void> {
    await firstValueFrom(this.http.post<PrivacyNoticeStatus>(BASE, { policyVersion, swissSchoolConfirmed }));
    this.settled = true;
  }

  async isOpen(): Promise<boolean> {
    if (this.settled) return false;
    const { acceptanceRequired } = await this.status();
    this.settled = !acceptanceRequired;
    return acceptanceRequired;
  }
}

/** Sends a user who hasn't seen the current notice to it. A failed check lets them through: the notice must not lock anyone out of their data. */
export const privacyNoticeGuard: CanActivateFn = async (_route, state) => {
  const api = inject(PrivacyNoticeApi);
  const router = inject(Router);
  try {
    if (!(await api.isOpen())) return true;
  } catch {
    return true;
  }
  return router.createUrlTree(['/privacy-notice'], { queryParams: state.url === '/' ? {} : { returnUrl: state.url } });
};
