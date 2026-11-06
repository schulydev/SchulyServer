import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { PRIVACY_NOTICE, PrivacyNoticeApi, PrivacyNoticeStatus, SWISS_SCHOOL_CONFIRMATION } from '../../core/privacy-notice';
import { takeReturnUrl } from '../../core/return-url';
import { AuthStore } from '../../stores/auth.store';
import { AuthLayout } from './auth-layout';

@Component({
  selector: 'app-privacy-notice',
  imports: [HlmButton, HlmCardImports, HlmCheckbox, HlmFieldImports, HlmSpinner, AuthLayout, TranslatePipe],
  template: `
    <app-auth-layout [title]="'auth.privacy.title' | translate" [subtitle]="'auth.privacy.subtitle' | translate">
      <section hlmCard>
        <div hlmCardContent class="flex flex-col gap-4">
          <p class="text-sm">{{ notice | translate }}</p>
          <a
            class="text-foreground text-sm underline underline-offset-4"
            [href]="status()?.policyUrl ?? 'https://schuly.dev/privacy'"
            target="_blank"
            rel="noopener"
            >{{ 'auth.privacy.read' | translate }}</a
          >
          @if (status()?.swissSchoolConfirmationRequired) {
            <label class="flex items-center gap-2 text-sm" for="swiss-school">
              <hlm-checkbox inputId="swiss-school" [checked]="swissConfirmed()" (checkedChange)="swissConfirmed.set($event)" />
              {{ confirmation | translate }}
            </label>
          }
          @if (error()) {
            <hlm-field-error>{{ error() }}</hlm-field-error>
          }
          <button hlmBtn size="lg" type="button" [disabled]="!canContinue()" (click)="accept()">
            @if (busy()) {
              <hlm-spinner />
            }
            {{ 'auth.continue' | translate }}
          </button>
          <button hlmBtn variant="ghost" type="button" (click)="auth.signOut()">{{ 'auth.signOut' | translate }}</button>
        </div>
      </section>
    </app-auth-layout>
  `,
})
export class PrivacyNotice implements OnInit {
  private readonly api = inject(PrivacyNoticeApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);

  protected readonly notice = PRIVACY_NOTICE;
  protected readonly confirmation = SWISS_SCHOOL_CONFIRMATION;
  protected readonly status = signal<PrivacyNoticeStatus | null>(null);
  protected readonly swissConfirmed = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canContinue = computed(() => {
    const status = this.status();
    return !!status && !this.busy() && (!status.swissSchoolConfirmationRequired || this.swissConfirmed());
  });

  async ngOnInit(): Promise<void> {
    try {
      this.status.set(await this.api.status());
    } catch {
      this.error.set(t('auth.privacy.loadFailed'));
    }
  }

  protected async accept(): Promise<void> {
    const status = this.status();
    if (!status || !this.canContinue()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.accept(status.policyVersion, this.swissConfirmed());
      await this.router.navigateByUrl(takeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
    } catch {
      this.error.set(t('auth.reloadFailed'));
      this.busy.set(false);
    }
  }
}
