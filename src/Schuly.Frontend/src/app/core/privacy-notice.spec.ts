import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyNotice } from '../pages/auth/privacy-notice';
import { signal } from '@angular/core';
import { AuthStore } from '../stores/auth.store';
import { ThemeStore } from '../stores/theme.store';
import { PRIVACY_NOTICE, PrivacyNoticeApi, privacyNoticeGuard } from './privacy-notice';

const status = (over: Record<string, unknown> = {}) => ({
  policyVersion: 'v1',
  policyUrl: 'https://schuly.dev/privacy',
  acceptanceRequired: true,
  swissSchoolConfirmationRequired: false,
  ...over,
});

const run = (url: string) =>
  TestBed.runInInjectionContext(() =>
    privacyNoticeGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  ) as Promise<boolean | UrlTree>;

describe('privacy notice', () => {
  let http: HttpTestingController;
  const authStatus = signal('signedIn');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthStore, useValue: { status: authStatus, signOut: vi.fn() } },
        { provide: ThemeStore, useValue: { dark: () => false } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const answer = async (body: object) => {
    await vi.waitFor(() => http.expectOne('/api/auth/me/privacy-notice').flush(body));
  };

  it('says absence reasons can reveal health information', () => {
    expect(PRIVACY_NOTICE).toContain('Absence reasons can reveal health information');
  });

  it('sends a user with an open notice to it and keeps where they were going', async () => {
    const result = run('/grades');
    await answer(status());
    const tree = (await result) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/privacy-notice?returnUrl=%2Fgrades');
  });

  it('lets a user through once nothing is open, and stops asking', async () => {
    const first = run('/');
    await answer(status({ acceptanceRequired: false }));
    expect(await first).toBe(true);

    expect(await run('/grades')).toBe(true);
    http.expectNone('/api/auth/me/privacy-notice');
  });

  it('asks again after another account signs in', async () => {
    const first = run('/');
    await answer(status({ acceptanceRequired: false }));
    await first;

    TestBed.inject(PrivacyNoticeApi);
    authStatus.set('signedOut');
    TestBed.tick();
    authStatus.set('signedIn');

    const second = run('/');
    await answer(status());
    expect(await second).not.toBe(true);
  });

  it('does not lock anyone out when the check fails', async () => {
    const result = run('/');
    await vi.waitFor(() => http.expectOne('/api/auth/me/privacy-notice').flush('no', { status: 500, statusText: 'Error' }));
    expect(await result).toBe(true);
  });

  it('records the acceptance', async () => {
    const accepted = TestBed.inject(PrivacyNoticeApi).accept('v1', true);
    const request = http.expectOne('/api/auth/me/privacy-notice');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ policyVersion: 'v1', swissSchoolConfirmed: true });
    request.flush(status({ acceptanceRequired: false }));
    await accepted;
    expect(await TestBed.inject(PrivacyNoticeApi).isOpen()).toBe(false);
  });

  describe('page', () => {
    const open = async (body: object): Promise<ComponentFixture<PrivacyNotice>> => {
      const fixture = TestBed.createComponent(PrivacyNotice);
      fixture.detectChanges();
      http.expectOne('/api/auth/me/privacy-notice').flush(body);
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture;
    };
    const continueButton = (fixture: ComponentFixture<PrivacyNotice>) =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.includes('Continue'))!;

    it('asks nothing extra on a server without the Swiss limit', async () => {
      const fixture = await open(status());
      const text = (fixture.nativeElement as HTMLElement).textContent;
      expect(text).toContain('Absence reasons can reveal health information');
      expect(text).not.toContain('I attend a school in Switzerland.');
      expect(continueButton(fixture).disabled).toBe(false);
    });

    it('needs the confirmation with the Swiss limit on', async () => {
      const fixture = await open(status({ swissSchoolConfirmationRequired: true }));
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('I attend a school in Switzerland.');
      expect(continueButton(fixture).disabled).toBe(true);
    });
  });
});
