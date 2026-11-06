import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, inject, signal } from '@angular/core';
import { email, form, FormField, FormRoot, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../core/auth-api';
import { authErrorMessage } from '../../stores/auth.store';
import { AuthLayout } from './auth-layout';

@Component({
  selector: 'app-forgot-password',
  imports: [
    FormRoot,
    FormField,
    RouterLink,
    HlmAlertImports,
    HlmButton,
    HlmCardImports,
    HlmFieldImports,
    HlmInput,
    HlmSpinner,
    AuthLayout,
    TranslatePipe,
  ],
  template: `
    <app-auth-layout
      [title]="'auth.forgot.title' | translate"
      [subtitle]="'auth.forgot.subtitle' | translate"
    >
      <section hlmCard>
        <div hlmCardContent>
          @if (sent()) {
            <div hlmAlert>
              <h4 hlmAlertTitle>{{ 'auth.forgot.checkInbox' | translate }}</h4>
              <p hlmAlertDescription>
                {{ 'auth.forgot.sent' | translate: { email: model().email } }}
              </p>
            </div>
          } @else {
            <form [formRoot]="request" class="flex flex-col gap-4">
              <div hlmField>
                <label hlmFieldLabel for="email">{{ 'auth.email' | translate }}</label>
                <input
                  hlmInput
                  id="email"
                  type="email"
                  autocomplete="email"
                  placeholder="you@example.com"
                  [formField]="request.email"
                />
              </div>
              @if (error()) {
                <hlm-field-error>{{ error() }}</hlm-field-error>
              }
              <button hlmBtn size="lg" type="submit" [disabled]="request().submitting()">
                @if (request().submitting()) {
                  <hlm-spinner />
                }
                {{ 'auth.forgot.send' | translate }}
              </button>
            </form>
          }
        </div>
      </section>
      <a hlmBtn variant="link" routerLink="/login">{{ 'auth.backToSignIn' | translate }}</a>
    </app-auth-layout>
  `,
})
export class ForgotPassword {
  private readonly api = inject(AuthApi);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly model = signal({ email: '' });
  protected readonly request = form(
    this.model,
    (path) => {
      required(path.email);
      email(path.email);
    },
    { submission: { action: () => this.submit() } },
  );

  private async submit(): Promise<undefined> {
    this.error.set(null);
    try {
      await firstValueFrom(this.api.forgotPassword(this.model().email.trim()));
      this.sent.set(true);
    } catch (error) {
      this.error.set(authErrorMessage(error, t('auth.didNotWork')));
    }
    return undefined;
  }
}
