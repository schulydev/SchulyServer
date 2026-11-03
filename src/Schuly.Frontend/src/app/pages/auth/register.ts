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
  ],
  template: `
    <app-auth-layout
      [title]="confirming() ? 'Confirm your email' : 'Create your account.'"
      [subtitle]="confirming() ? hint() : 'Free, and your school data stays yours.'"
    >
      @if (confirming()) {
        <app-confirm-email (signedIn)="finish()" (twoFactor)="toSignIn()" (cancelled)="toSignIn()" />
      } @else {
      <section hlmCard>
        <div hlmCardContent>
          <form [formRoot]="account" class="flex flex-col gap-4">
            <div hlmField>
              <label hlmFieldLabel for="username">Username</label>
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
              <label hlmFieldLabel for="email">Email</label>
              <input
                hlmInput
                id="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                [formField]="account.email"
              />
              <p hlmFieldDescription>We send a code to confirm it.</p>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="new-password">Password</label>
              <input
                hlmInput
                id="new-password"
                type="password"
                autocomplete="new-password"
                [formField]="account.password"
              />
              <p hlmFieldDescription>At least 8 characters.</p>
            </div>
            @if (error()) {
              <hlm-field-error>{{ error() }}</hlm-field-error>
            }
            <button hlmBtn size="lg" type="submit" [disabled]="account().submitting()">
              @if (account().submitting()) {
                <hlm-spinner />
              }
              Create account
            </button>
            <p class="text-muted-foreground text-sm">{{ notice }}</p>
            <p class="text-muted-foreground text-center text-sm">
              By creating an account you agree to our
              <a
                class="text-foreground underline underline-offset-4"
                href="https://schuly.dev/terms"
                target="_blank"
                rel="noopener"
                >Terms</a
              >.<br />
              See our
              <a
                class="text-foreground underline underline-offset-4"
                href="https://schuly.dev/privacy"
                target="_blank"
                rel="noopener"
                >Privacy Policy</a
              >.
            </p>
          </form>
        </div>
      </section>
      <p class="text-muted-foreground text-center text-sm">
        Already have an account?
        <a routerLink="/login" class="text-foreground font-medium underline-offset-4 hover:underline">Sign in</a>
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
      this.error.set(authErrorMessage(error, 'That username or email is already taken.'));
    }
    return undefined;
  }
}
