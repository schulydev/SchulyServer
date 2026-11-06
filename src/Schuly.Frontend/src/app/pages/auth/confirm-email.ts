import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, afterNextRender, computed, inject, output, signal } from '@angular/core';
import { form, FormRoot, FormField, required } from '@angular/forms/signals';
import { BrnInputOtp } from '@spartan-ng/brain/input-otp';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputOtpImports } from '@spartan-ng/helm/input-otp';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { AuthStore, EmailChallenge, errorCode } from '../../stores/auth.store';

const CODE_LENGTH = 6;
const DEFAULT_COOLDOWN = 60;

export function confirmEmailHint(challenge: EmailChallenge | null): string {
  if (challenge && challenge.method !== 'code') return t('auth.confirm.checkEmail');
  return challenge?.email
    ? t('auth.confirm.sentTo', { email: challenge.email })
    : t('auth.confirm.sent');
}

/** Shared "Confirm your email" step for sign-in and registration. */
@Component({
  selector: 'app-confirm-email',
  imports: [
    FormRoot,
    FormField,
    BrnInputOtp,
    HlmButton,
    HlmCardImports,
    HlmFieldImports,
    HlmInputOtpImports,
    HlmInput,
    HlmSpinner,
    TranslatePipe,
  ],
  template: `
    <section hlmCard>
      <div hlmCardContent>
        <form [formRoot]="codeForm" class="flex flex-col gap-4">
          @if (isCode()) {
            <div hlmField>
              <label hlmFieldLabel for="email-code">{{ 'auth.confirm.code' | translate }}</label>
              <brn-input-otp
                hlmInputOtp
                class="justify-center"
                inputId="email-code"
                inputMode="numeric"
                inputAutocomplete="one-time-code"
                [length]="codeLength"
                [formField]="codeForm.code"
                (completed)="submit()"
              >
                <div hlmInputOtpGroup>
                  @for (slot of slots; track slot) {
                    <hlm-input-otp-slot [index]="slot" />
                  }
                </div>
              </brn-input-otp>
            </div>
          }
          <div aria-live="polite" role="status">
            @if (error()) {
              <hlm-field-error forceShow>{{ error() }}</hlm-field-error>
            } @else if (notice()) {
              <p class="text-muted-foreground text-center text-sm">{{ notice() }}</p>
            }
          </div>
          @if (isCode()) {
            <button hlmBtn size="lg" type="submit" [disabled]="codeForm().submitting()">
              @if (codeForm().submitting()) {
                <hlm-spinner />
              }
              {{ 'auth.verify' | translate }}
            </button>
          }
          <button
            hlmBtn
            variant="link"
            type="button"
            [disabled]="resending() || cooldown() > 0"
            (click)="resend()"
          >
            @if (resending()) {
              <hlm-spinner />
            }
            {{ cooldown() > 0 ? ('auth.confirm.resendIn' | translate: { seconds: cooldown() }) : ('auth.confirm.resend' | translate) }}
          </button>
        </form>
        @if (changing()) {
          <form class="mt-4 flex flex-col gap-3 border-t pt-4" (submit)="changeAddress($event)">
            <div hlmField>
              <label hlmFieldLabel for="new-address">Your email address</label>
              <input hlmInput id="new-address" type="email" autocomplete="email" [value]="newAddress()" (input)="newAddress.set($any($event.target).value)" />
              <p hlmFieldDescription>We send a new code there. The old one stops working.</p>
            </div>
            <div class="flex gap-2">
              <button hlmBtn type="submit" class="flex-1" [disabled]="busy() || !newAddress().includes('@')">
                @if (busy()) {
                  <hlm-spinner />
                }
                Send code
              </button>
              <button hlmBtn variant="outline" type="button" (click)="changing.set(false)">Cancel</button>
            </div>
          </form>
        } @else {
          <button hlmBtn variant="link" type="button" class="w-full" (click)="changing.set(true)">Wrong address? Change email</button>
        }
      </div>
    </section>
    <button hlmBtn variant="link" type="button" (click)="back()">{{ 'auth.backToSignIn' | translate }}</button>
  `,
})
export class ConfirmEmail {
  private readonly auth = inject(AuthStore);

  readonly signedIn = output<void>();
  readonly twoFactor = output<void>();
  readonly cancelled = output<void>();

  protected readonly codeLength = CODE_LENGTH;
  protected readonly slots = Array.from({ length: CODE_LENGTH }, (_, index) => index);
  protected readonly isCode = computed(() => (this.auth.emailChallenge()?.method ?? 'code') === 'code');
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly resending = signal(false);
  protected readonly cooldown = signal(0);
  protected readonly changing = signal(false);
  protected readonly newAddress = signal('');
  protected readonly busy = signal(false);

  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly model = signal({ code: '' });
  protected readonly codeForm = form(this.model, (path) => required(path.code), {
    submission: { action: () => this.submit() },
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
    afterNextRender(() => document.getElementById('email-code')?.focus());
  }

  protected async submit(): Promise<undefined> {
    const code = this.model().code.trim();
    if (code.length < CODE_LENGTH) return undefined;
    this.error.set(null);
    this.notice.set(null);
    try {
      const result = await this.auth.verifyEmailCode(code);
      if (result === 'signedIn') this.signedIn.emit();
      else this.twoFactor.emit();
    } catch (error) {
      this.model.set({ code: '' });
      this.error.set(this.verifyMessage(error));
      document.getElementById('email-code')?.focus();
    }
    return undefined;
  }

  protected async resend(): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.resending.set(true);
    try {
      await this.auth.resendEmailCode();
      this.model.set({ code: '' });
      this.notice.set(t('auth.confirm.newCode'));
      this.startCooldown(DEFAULT_COOLDOWN);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 429) {
        const seconds = Number.parseInt(error.headers.get('Retry-After') ?? '', 10);
        this.startCooldown(seconds > 0 ? seconds : DEFAULT_COOLDOWN);
        this.notice.set(t('auth.confirm.wait'));
      } else if (error instanceof HttpErrorResponse && error.status === 401) {
        this.error.set(t('auth.confirm.invalid'));
      } else {
        this.error.set(t('auth.confirm.sendFailed'));
      }
    } finally {
      this.resending.set(false);
    }
  }

  protected async changeAddress(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await this.auth.changeEmailCodeAddress(this.newAddress().trim());
      this.model.set({ code: '' });
      this.changing.set(false);
      this.notice.set('We sent a new code to your new address.');
      document.getElementById('email-code')?.focus();
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.error.set(
        status === 409
          ? 'Another account already uses that email address.'
          : status === 400
            ? 'Enter a valid email address.'
            : status === 401
              ? 'This confirmation is no longer valid. Go back to sign in and start again.'
              : 'Something went wrong. Try again in a moment.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected back(): void {
    this.stopTimer();
    this.auth.cancelEmailChallenge();
    this.cancelled.emit();
  }

  private verifyMessage(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const code = errorCode(error);
    if (code === 'invalid_code') return t('auth.confirm.mismatch');
    if (code === 'code_expired') return t('auth.confirm.expired');
    if (status === 401 || code === 'invalid_grant') {
      return t('auth.confirm.invalid');
    }
    if (status === 400) return t('auth.confirm.mismatch');
    return t('auth.tryLater');
  }

  private startCooldown(seconds: number): void {
    this.stopTimer();
    this.cooldown.set(seconds);
    this.timer = setInterval(() => {
      this.cooldown.update((value) => Math.max(0, value - 1));
      if (this.cooldown() === 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
