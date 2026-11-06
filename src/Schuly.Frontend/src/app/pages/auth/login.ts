import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEye, lucideEyeOff } from '@ng-icons/lucide';
import { BrnInputOtp } from '@spartan-ng/brain/input-otp';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmInputOtpImports } from '@spartan-ng/helm/input-otp';
import { HlmSeparator } from '@spartan-ng/helm/separator';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';
import { AuthApi, SignInProvider } from '../../core/auth-api';
import { beginExternalSignIn, externalError, takePending } from '../../core/external-sign-in';
import { rememberReturnUrl, takeReturnUrl } from '../../core/return-url';
import { AuthStore, authErrorMessage } from '../../stores/auth.store';
import { AuthLayout } from './auth-layout';
import { ConfirmEmail, confirmEmailHint } from './confirm-email';

const CODE_LENGTH = 6;

@Component({
  selector: 'app-login',
  imports: [
    HlmAlertImports,
    FormRoot,
    FormField,
    RouterLink,
    NgIcon,
    BrnInputOtp,
    HlmButton,
    HlmCardImports,
    HlmCheckbox,
    HlmFieldImports,
    HlmInput,
    HlmInputGroupImports,
    HlmInputOtpImports,
    HlmSeparator,
    HlmSpinner,
    AuthLayout,
    ConfirmEmail,
    TranslatePipe,
  ],
  providers: [provideIcons({ lucideEye, lucideEyeOff })],
  template: `
    <app-auth-layout
      [title]="title()"
      [subtitle]="subtitle()"
    >
      @if (changed() && step() === 'credentials') {
        <div hlmAlert>
          <p hlmAlertDescription>
            {{ 'auth.login.changed' | translate }}
          </p>
        </div>
      }
      @if (step() === 'email') {
        <app-confirm-email (signedIn)="finishEmail()" (twoFactor)="step.set('code')" (cancelled)="startOver()" />
      } @else {
      <section hlmCard>
        <div hlmCardContent>
          @if (step() === 'credentials') {
            <form [formRoot]="credentials" class="flex flex-col gap-4">
              <div hlmField>
                <label hlmFieldLabel for="identifier">{{ 'auth.login.identifier' | translate }}</label>
                <input
                  hlmInput
                  id="identifier"
                  autocomplete="username"
                  autocapitalize="off"
                  spellcheck="false"
                  placeholder="you@example.com"
                  [formField]="credentials.identifier"
                />
              </div>
              <div hlmField [forceInvalid]="!!error()">
                <div class="flex items-center">
                  <label hlmFieldLabel for="password">{{ 'auth.password' | translate }}</label>
                  <a
                    routerLink="/forgot-password"
                    class="text-muted-foreground hover:text-foreground ml-auto text-sm underline-offset-4 hover:underline"
                    >{{ 'auth.login.forgot' | translate }}</a
                  >
                </div>
                <div hlmInputGroup>
                  <input
                    hlmInputGroupInput
                    id="password"
                    autocomplete="current-password"
                    [type]="passwordVisible() ? 'text' : 'password'"
                    [formField]="credentials.password"
                  />
                  <div hlmInputGroupAddon align="inline-end">
                    <button
                      hlmInputGroupButton
                      size="icon-xs"
                      [attr.aria-label]="passwordVisible() ? ('auth.login.hidePassword' | translate) : ('auth.login.showPassword' | translate)"
                      [attr.aria-pressed]="passwordVisible()"
                      (click)="passwordVisible.set(!passwordVisible())"
                    >
                      <ng-icon [name]="passwordVisible() ? 'lucideEyeOff' : 'lucideEye'" />
                    </button>
                  </div>
                </div>
                @if (error()) {
                  <hlm-field-error>{{ error() }}</hlm-field-error>
                }
              </div>
              <button hlmBtn size="lg" type="submit" [disabled]="credentials().submitting()">
                @if (credentials().submitting()) {
                  <hlm-spinner />
                }
                {{ 'auth.continue' | translate }}
              </button>
            </form>
            @if (providers().length) {
              <div class="my-4 flex items-center gap-3">
                <hlm-separator class="flex-1" />
                <span class="text-muted-foreground text-xs">{{ 'auth.login.or' | translate }}</span>
                <hlm-separator class="flex-1" />
              </div>
              <div class="flex flex-col gap-2">
                @for (provider of providers(); track provider.key) {
                  <button
                    hlmBtn
                    variant="outline"
                    size="lg"
                    type="button"
                    [disabled]="redirecting()"
                    (click)="signInWith(provider.key)"
                  >
                    @if (provider.icon_url) {
                      <img [src]="provider.icon_url" alt="" class="size-4" />
                    }
                    {{ 'auth.login.continueWith' | translate: { name: provider.display_name } }}
                  </button>
                }
              </div>
            }
          } @else {
            <form [formRoot]="codeForm" class="flex flex-col gap-4">
              @if (usingRecoveryCode()) {
                <div hlmField>
                  <label hlmFieldLabel for="recovery-code">{{ 'auth.login.recoveryCode' | translate }}</label>
                  <input
                    hlmInput
                    id="recovery-code"
                    autocomplete="one-time-code"
                    autocapitalize="off"
                    spellcheck="false"
                    [formField]="codeForm.code"
                  />
                </div>
              } @else {
                <div hlmField>
                  <label hlmFieldLabel for="totp-code">{{ 'auth.login.authCode' | translate }}</label>
                  <brn-input-otp
                    hlmInputOtp
                    class="justify-center"
                    inputId="totp-code"
                    inputMode="numeric"
                    inputAutocomplete="one-time-code"
                    [length]="codeLength"
                    [formField]="codeForm.code"
                    (completed)="submitCode()"
                  >
                    <div hlmInputOtpGroup>
                      @for (slot of slots; track slot) {
                        <hlm-input-otp-slot [index]="slot" />
                      }
                    </div>
                  </brn-input-otp>
                </div>
              }
              <label class="flex items-center gap-2 text-sm" for="remember-device">
                <hlm-checkbox
                  inputId="remember-device"
                  [checked]="rememberDevice()"
                  (checkedChange)="rememberDevice.set($event)"
                />
                {{ 'auth.login.remember' | translate }}
              </label>
              @if (error()) {
                <hlm-field-error>{{ error() }}</hlm-field-error>
              }
              <button hlmBtn size="lg" type="submit" [disabled]="codeForm().submitting()">
                @if (codeForm().submitting()) {
                  <hlm-spinner />
                }
                {{ 'auth.verify' | translate }}
              </button>
              <button hlmBtn variant="link" type="button" (click)="toggleRecoveryCode()">
                {{ usingRecoveryCode() ? ('auth.login.useApp' | translate) : ('auth.login.useRecovery' | translate) }}
              </button>
            </form>
          }
        </div>
      </section>
      }

      @if (step() === 'code') {
        <button hlmBtn variant="link" type="button" (click)="startOver()">{{ 'auth.backToSignIn' | translate }}</button>
      } @else if (step() === 'credentials') {
        <p class="text-muted-foreground text-center text-sm">
          {{ 'auth.login.newTo' | translate }}
          <a
            routerLink="/register"
            class="text-foreground font-medium underline-offset-4 hover:underline"
            >{{ 'auth.login.create' | translate }}</a
          >
        </p>
      }
    </app-auth-layout>
  `,
})
export class Login implements OnInit {
  readonly changed = input<string>();
  readonly returnUrl = input<string>();
  readonly code = input<string>();
  readonly state = input<string>();
  readonly failure = input<string>(undefined, { alias: 'error' });
  private readonly api = inject(AuthApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly codeLength = CODE_LENGTH;
  protected readonly slots = Array.from({ length: CODE_LENGTH }, (_, index) => index);
  protected readonly step = signal<'credentials' | 'email' | 'code'>('credentials');
  protected readonly passwordVisible = signal(false);
  protected readonly usingRecoveryCode = signal(false);
  protected readonly rememberDevice = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly providers = signal<SignInProvider[]>([]);
  protected readonly redirecting = signal(false);

  private readonly credentialsModel = signal({ identifier: '', password: '' });
  protected readonly credentials = form(
    this.credentialsModel,
    (path) => {
      required(path.identifier);
      required(path.password);
    },
    { submission: { action: () => this.submitCredentials() } },
  );

  private readonly codeModel = signal({ code: '' });
  protected readonly codeForm = form(this.codeModel, (path) => required(path.code), {
    submission: { action: () => this.submitCode() },
  });

  async ngOnInit(): Promise<void> {
    rememberReturnUrl(this.returnUrl());
    const code = this.code();
    const failure = this.failure();
    if (code || failure) {
      const pending = takePending(this.state() ?? null);
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
      if (failure) this.error.set(externalError(failure));
      else if (!pending) this.error.set(externalError());
      else await this.finishExternal(code!, pending.verifier);
    }
    this.providers.set(await firstValueFrom(this.api.providers()).catch(() => []));
  }

  protected async signInWith(provider: string): Promise<void> {
    this.redirecting.set(true);
    await beginExternalSignIn(provider, '/login');
  }

  private async finishExternal(code: string, verifier: string): Promise<void> {
    try {
      const result = await this.auth.signInExternal(code, verifier);
      if (result === 'challenge') this.step.set('code');
      else if (result === 'email') this.step.set('email');
      else await this.router.navigateByUrl(takeReturnUrl(this.returnUrl()));
    } catch (error) {
      this.error.set(authErrorMessage(error, externalError()));
    }
  }

  protected title(): string {
    if (this.step() === 'email') return t('auth.confirmEmail');
    return this.step() === 'code' ? t('auth.login.oneMore') : t('auth.login.title');
  }

  protected subtitle(): string {
    if (this.step() === 'email') return confirmEmailHint(this.auth.emailChallenge());
    return this.step() === 'code'
      ? this.codeHint()
      : t('auth.login.subtitle');
  }

  protected async finishEmail(): Promise<void> {
    await this.router.navigateByUrl(takeReturnUrl(this.returnUrl()));
  }

  protected codeHint(): string {
    return this.usingRecoveryCode()
      ? t('auth.login.recoveryHint')
      : t('auth.login.codeHint');
  }

  protected toggleRecoveryCode(): void {
    this.error.set(null);
    this.codeModel.set({ code: '' });
    this.usingRecoveryCode.update((using) => !using);
  }

  protected startOver(): void {
    this.auth.cancelChallenge();
    this.error.set(null);
    this.codeModel.set({ code: '' });
    this.credentialsModel.update((model) => ({ ...model, password: '' }));
    this.usingRecoveryCode.set(false);
    this.step.set('credentials');
  }

  private async submitCredentials(): Promise<undefined> {
    this.error.set(null);
    const { identifier, password } = this.credentialsModel();
    try {
      const result = await this.auth.signIn(identifier.trim(), password);
      if (result === 'challenge') this.step.set('code');
      else if (result === 'email') this.step.set('email');
      else await this.router.navigateByUrl(takeReturnUrl(this.returnUrl()));
    } catch (error) {
      this.error.set(
        authErrorMessage(error, t('auth.login.mismatch')),
      );
    }
    return undefined;
  }

  protected async submitCode(): Promise<undefined> {
    if (this.codeForm().submitting() && !this.codeModel().code) return undefined;
    this.error.set(null);
    try {
      await this.auth.verifyCode(this.codeModel().code.trim(), this.rememberDevice());
      await this.router.navigateByUrl(takeReturnUrl(this.returnUrl()));
    } catch (error) {
      this.codeModel.set({ code: '' });
      const rateLimited = error instanceof HttpErrorResponse && error.status === 429;
      this.error.set(
        this.usingRecoveryCode() || rateLimited
          ? authErrorMessage(error, t('auth.login.recoveryFailed'))
          : t('auth.login.codeFailed'),
      );
    }
    return undefined;
  }
}
