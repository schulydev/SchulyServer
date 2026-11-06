import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, minLength, required } from '@angular/forms/signals';
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
  selector: 'app-reset-password',
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
      [title]="'auth.reset.title' | translate"
      [subtitle]="'auth.reset.subtitle' | translate"
    >
      <section hlmCard>
        <div hlmCardContent>
          @if (done()) {
            <div hlmAlert>
              <h4 hlmAlertTitle>{{ 'auth.reset.changed' | translate }}</h4>
              <p hlmAlertDescription>{{ 'auth.reset.signInNew' | translate }}</p>
            </div>
          } @else if (!token()) {
            <div hlmAlert variant="destructive">
              <h4 hlmAlertTitle>{{ 'auth.reset.incomplete' | translate }}</h4>
              <p hlmAlertDescription>{{ 'auth.reset.openAgain' | translate }}</p>
            </div>
          } @else {
            <form [formRoot]="reset" class="flex flex-col gap-4">
              <div hlmField>
                <label hlmFieldLabel for="new-password">{{ 'auth.reset.new' | translate }}</label>
                <input
                  hlmInput
                  id="new-password"
                  type="password"
                  autocomplete="new-password"
                  [formField]="reset.password"
                />
                <p hlmFieldDescription>{{ 'auth.minLength' | translate }}</p>
              </div>
              @if (error()) {
                <hlm-field-error>{{ error() }}</hlm-field-error>
              }
              <button hlmBtn size="lg" type="submit" [disabled]="reset().submitting()">
                @if (reset().submitting()) {
                  <hlm-spinner />
                }
                {{ 'auth.reset.set' | translate }}
              </button>
            </form>
          }
        </div>
      </section>
      <a hlmBtn variant="link" [routerLink]="done() ? '/login' : '/forgot-password'">{{
        (done() ? 'nav.signIn' : 'auth.reset.request') | translate
      }}</a>
    </app-auth-layout>
  `,
})
export class ResetPassword {
  readonly token = input<string>();

  private readonly api = inject(AuthApi);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly model = signal({ password: '' });
  protected readonly reset = form(
    this.model,
    (path) => {
      required(path.password);
      minLength(path.password, 8);
    },
    { submission: { action: () => this.submit() } },
  );

  private async submit(): Promise<undefined> {
    this.error.set(null);
    try {
      await firstValueFrom(this.api.resetPassword(this.token() ?? '', this.model().password));
      this.done.set(true);
    } catch (error) {
      this.error.set(
        authErrorMessage(error, t('auth.reset.expired')),
      );
    }
    return undefined;
  }
}
