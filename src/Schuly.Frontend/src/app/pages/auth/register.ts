import { PasswordField } from '../../shared/password-field';
import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, inject, signal } from '@angular/core';
import { email, form, FormField, FormRoot, minLength, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { PRIVACY_NOTICE } from '../../core/privacy-notice';
import { takeReturnUrl } from '../../core/return-url';
import { AuthStore, authErrorMessage } from '../../stores/auth.store';
import { AuthLayout } from './auth-layout';
import { ConfirmEmail, confirmEmailHint } from './confirm-email';

@Component({
  selector: 'app-register',
  imports: [
    PasswordField,
    FormRoot,
    FormField,
    RouterLink,
    HlmButton,
    HlmCardImports,
    HlmFieldImports,
    HlmInput,
    HlmSpinner,
    AuthLayout,
    ConfirmEmail,
    TranslatePipe,
  ],
  template: `
    <app-auth-layout
      [title]="(confirming() ? 'auth.confirmEmail' : 'auth.register.title') | translate"
      [subtitle]="confirming() ? hint() : ('auth.register.subtitle' | translate)"
    >
      @if (confirming()) {
        <app-confirm-email (signedIn)="finish()" (twoFactor)="toSignIn()" (cancelled)="toSignIn()" />
      } @else {
      <section hlmCard>
        <div hlmCardContent>
          <form [formRoot]="account" class="flex flex-col gap-4">
            <div hlmField>
              <label hlmFieldLabel for="username">{{ 'auth.username' | translate }}</label>
              <input
                hlmInput
                id="username"
                autocomplete="username"
                autocapitalize="off"
                spellcheck="false"
                [formField]="account.userName"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="email">{{ 'auth.email' | translate }}</label>
              <input
                hlmInput
                id="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                [formField]="account.email"
              />
              <p hlmFieldDescription>{{ 'auth.register.emailHint' | translate }}</p>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="new-password">{{ 'auth.password' | translate }}</label>
              <app-password-field inputId="new-password" autocomplete="new-password" [formField]="account.password" />
              <p hlmFieldDescription>{{ 'auth.minLength' | translate }}</p>
            </div>
            @if (error()) {
              <hlm-field-error forceShow>{{ error() }}</hlm-field-error>
            }
            <button hlmBtn size="lg" type="submit" [disabled]="account().submitting()">
              @if (account().submitting()) {
                <hlm-spinner />
              }
              {{ 'nav.register' | translate }}
            </button>
            <p class="text-muted-foreground text-sm">{{ notice | translate }}</p>
            <p class="text-muted-foreground text-center text-sm">
              {{ 'auth.register.agree' | translate }}
              <a
                class="text-foreground underline underline-offset-4"
                href="https://schuly.dev/terms"
                target="_blank"
                rel="noopener"
                >{{ 'auth.layout.terms' | translate }}</a
              >.<br />
              {{ 'auth.register.see' | translate }}
              <a
                class="text-foreground underline underline-offset-4"
                href="https://schuly.dev/privacy"
                target="_blank"
                rel="noopener"
                >{{ 'auth.register.policy' | translate }}</a
              >.
            </p>
          </form>
        </div>
      </section>
      <p class="text-muted-foreground text-center text-sm">
        {{ 'auth.register.already' | translate }}
        <a routerLink="/login" class="text-foreground font-medium underline-offset-4 hover:underline">{{ 'nav.signIn' | translate }}</a>
      </p>
      }
    </app-auth-layout>
  `,
})
export class Register {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly error = signal<string | null>(null);
  protected readonly confirming = signal(false);

  protected hint(): string {
    return confirmEmailHint(this.auth.emailChallenge());
  }

  protected async finish(): Promise<void> {
    await this.router.navigateByUrl(takeReturnUrl());
  }

  protected toSignIn(): void {
    void this.router.navigateByUrl('/login');
  }

  protected readonly notice = PRIVACY_NOTICE;
  private readonly model = signal({ userName: '', email: '', password: '' });
  protected readonly account = form(
    this.model,
    (path) => {
      required(path.userName);
      required(path.email);
      email(path.email);
      required(path.password);
      minLength(path.password, 8);
    },
    { submission: { action: () => this.submit() } },
  );

  private async submit(): Promise<undefined> {
    this.error.set(null);
    const { userName, email, password } = this.model();
    try {
      const result = await this.auth.register(userName.trim(), email.trim(), password);
      if (result === 'email') this.confirming.set(true);
      else await this.router.navigateByUrl(takeReturnUrl());
    } catch (error) {
      this.error.set(authErrorMessage(error, t('auth.register.taken')));
    }
    return undefined;
  }
}
