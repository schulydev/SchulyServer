import { PasswordField } from './password-field';
import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck, lucideCopy, lucideExternalLink, lucideSmartphone, lucideTriangleAlert } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { LinkFieldDto, LinkOptionDto, LinkStepDto } from '../core/linking-api';
import { linkText } from '../core/link-messages';
import { clock, countdownAnnouncement, formHints, initialValues, isHttps, secondsLeft, submitValues } from '../core/linking-step';

export interface LinkSubmit {
  values: Record<string, string>;
  action?: string;
}

/**
 * Renders one linking step. It knows step kinds, never providers: form, otp, pushCode, deviceCode, redirect, select, done and error.
 * The parent owns the session; this component only reports what the user did (`submitted`, `linkProvider`, `restart`)
 * and asks for a poll while a code step is on screen.
 */
@Component({
  selector: 'app-link-step',
  imports: [PasswordField, NgIcon, NgTemplateOutlet, HlmAlertImports, HlmButton, HlmFieldImports, HlmInput, HlmSpinner],
  providers: [provideIcons({ lucideCircleCheck, lucideCopy, lucideExternalLink, lucideSmartphone, lucideTriangleAlert })],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <div class="flex flex-col gap-1.5">
      <h3 #heading tabindex="-1" class="text-lg leading-none font-semibold outline-none" [id]="headingId()">{{ step().title || fallbackTitle() }}</h3>
      @if (step().description) {
        <p class="text-muted-foreground text-sm" [id]="descriptionId()">{{ step().description }}</p>
      }
    </div>

    <p class="sr-only" role="status" aria-live="polite">{{ announcement() }}</p>

    @if (step().error) {
      <div hlmAlert variant="destructive" role="alert">
        <ng-icon name="lucideTriangleAlert" hlmAlertIcon />
        <p hlmAlertDescription class="!text-destructive">{{ linkText(step().error) }}</p>
      </div>
    }
    @if (error()) {
      <div hlmAlert variant="destructive" role="alert">
        <ng-icon name="lucideTriangleAlert" hlmAlertIcon />
        <p hlmAlertDescription class="!text-destructive">{{ error() }}</p>
      </div>
    }

    @switch (step().kind) {
      @case ('form') {
        <form class="flex flex-col gap-4" novalidate [attr.aria-describedby]="step().description ? descriptionId() : null" (submit)="submitForm($event)">
          @if (summary()) {
            <p class="text-destructive text-sm" role="alert">{{ summary() }}</p>
          }
          @for (field of step().fields ?? []; track field.key) {
            <div hlmField>
              <label hlmFieldLabel [for]="fieldId(field)">
                {{ field.label }}
                @if (field.required === false) {
                  <span class="text-muted-foreground font-normal">(optional)</span>
                }
              </label>
              @if (field.type === 'select' && !field.allowCustom) {
                <select
                  hlmInput
                  [id]="fieldId(field)"
                  [attr.data-autofocus]="$first ? '' : null"
                  [attr.aria-invalid]="hints()[field.key] ? 'true' : null"
                  [attr.aria-describedby]="describedBy(field)"
                  [attr.aria-required]="field.required !== false"
                  [value]="values()[field.key] ?? ''"
                  (change)="setValue(field.key, $any($event.target).value)"
                >
                  <option value="">Choose...</option>
                  @for (option of field.options ?? []; track option.value) {
                    <option [value]="option.value" [selected]="option.value === values()[field.key]">{{ option.label }}</option>
                  }
                </select>
              } @else if (field.type === 'password') {
                <app-password-field
                  [inputId]="fieldId(field)"
                  [fieldName]="field.key"
                  autocomplete="current-password"
                  [autofocus]="$first"
                  [markInvalid]="!!hints()[field.key]"
                  [describedBy]="describedBy(field) ?? ''"
                  [value]="values()[field.key] ?? ''"
                  (valueChange)="setValue(field.key, $event)"
                />
              } @else {
                <input
                  hlmInput
                  [id]="fieldId(field)"
                  [attr.data-autofocus]="$first ? '' : null"
                  [type]="inputType(field)"
                  [attr.inputmode]="field.type === 'url' ? 'url' : null"
                  [attr.autocomplete]="autocomplete(field)"
                  [attr.list]="field.type === 'select' ? listId(field) : null"
                  [attr.placeholder]="field.placeholder || null"
                  [attr.maxlength]="field.maxLength || null"
                  [attr.aria-invalid]="hints()[field.key] ? 'true' : null"
                  [attr.aria-describedby]="describedBy(field)"
                  [attr.aria-required]="field.required !== false"
                  spellcheck="false"
                  autocapitalize="none"
                  [value]="values()[field.key] ?? ''"
                  (input)="setValue(field.key, $any($event.target).value)"
                />
                @if (field.type === 'select') {
                  <datalist [id]="listId(field)">
                    @for (option of field.options ?? []; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </datalist>
                }
              }
              @if (field.help || field.type === 'totpSecret') {
                <p hlmFieldDescription [id]="helpId(field)">{{ field.help || 'The secret key your authenticator app shows when you set it up, not a 6-digit code.' }}</p>
              }
              @if (hints()[field.key]; as hint) {
                <hlm-field-error forceShow [id]="errorId(field)">{{ hint }}</hlm-field-error>
              }
            </div>
          }
          <div class="flex flex-wrap items-center gap-2">
            <button hlmBtn type="submit" [disabled]="busy()">
              @if (busy()) {
                <hlm-spinner aria-hidden="true" />
              }
              {{ step().submitLabel || 'Continue' }}
            </button>
            <ng-container [ngTemplateOutlet]="actions" />
          </div>
        </form>
      }

      @case ('otp') {
        <form class="flex flex-col gap-4" novalidate (submit)="submitOtp($event)">
          <div hlmField>
            <label hlmFieldLabel [for]="otpId">{{ step().otp?.label || 'Code' }}</label>
            <input
              hlmInput
              [id]="otpId"
              data-autofocus
              type="text"
              autocomplete="one-time-code"
              [attr.inputmode]="otpNumeric() ? 'numeric' : 'text'"
              [attr.pattern]="otpNumeric() ? '[0-9]*' : null"
              [attr.maxlength]="step().otp?.length || null"
              [attr.aria-invalid]="otpError() ? 'true' : null"
              [attr.aria-describedby]="otpError() ? otpId + '-error' : null"
              class="max-w-48 text-center font-mono text-lg tracking-widest"
              spellcheck="false"
              [value]="code()"
              (input)="setCode($any($event.target).value)"
            />
            @if (otpError()) {
              <hlm-field-error forceShow [id]="otpId + '-error'">{{ otpError() }}</hlm-field-error>
            }
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button hlmBtn type="submit" [disabled]="busy()">
              @if (busy()) {
                <hlm-spinner aria-hidden="true" />
              }
              {{ step().submitLabel || 'Verify' }}
            </button>
            <ng-container [ngTemplateOutlet]="actions" />
          </div>
        </form>
      }

      @case ('pushCode') {
        <div class="flex flex-col items-start gap-3">
          @if (step().pushCode?.number; as number) {
            <p class="bg-muted rounded-lg px-6 py-3 font-mono text-5xl font-semibold tracking-widest tabular-nums" [attr.aria-label]="'Number to approve: ' + number">{{ number }}</p>
          }
          <p class="text-muted-foreground flex items-center gap-2 text-sm">
            @if (remaining() > 0) {
              <hlm-spinner aria-hidden="true" class="size-4" />
              <span>Waiting for approval. <span class="tabular-nums" aria-hidden="true">{{ clockText() }}</span> left</span>
            } @else {
              <span>This request expired.</span>
            }
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <ng-container [ngTemplateOutlet]="actions" />
          </div>
        </div>
      }

      @case ('deviceCode') {
        <div class="flex flex-col items-start gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <p class="bg-muted rounded-lg px-6 py-3 font-mono text-3xl font-semibold tracking-widest" data-testid="device-code" [attr.aria-label]="'Your code: ' + step().deviceCode?.userCode">{{ step().deviceCode?.userCode }}</p>
            <button hlmBtn type="button" variant="outline" (click)="copyCode()">
              <ng-icon name="lucideCopy" aria-hidden="true" />
              Copy code
            </button>
          </div>
          @if (verificationUrl(); as url) {
            <a hlmBtn data-autofocus [href]="url" target="_blank" rel="noopener noreferrer">
              <ng-icon name="lucideExternalLink" aria-hidden="true" />
              Open sign-in page<span class="sr-only"> (opens in a new tab)</span>
            </a>
          } @else {
            <p class="text-destructive text-sm" role="alert">The sign-in page address is not a secure link, so it was not opened. Cancel and try again.</p>
          }
          <p class="text-muted-foreground flex items-center gap-2 text-sm">
            @if (remaining() > 0) {
              <hlm-spinner aria-hidden="true" class="size-4" />
              <span>Waiting for you to finish. <span class="tabular-nums" aria-hidden="true">{{ clockText() }}</span> left</span>
            } @else {
              <span>This code expired.</span>
            }
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <ng-container [ngTemplateOutlet]="actions" />
          </div>
        </div>
      }

      @case ('redirect') {
        @if (step().redirect?.mode === 'capture') {
          <div hlmAlert>
            <ng-icon name="lucideSmartphone" hlmAlertIcon />
            <p hlmAlertDescription>This sign-in needs the Schuly mobile app. Open Schuly on your phone to link it there.</p>
          </div>
        } @else if (redirectUrl(); as url) {
          <div class="flex flex-wrap items-center gap-2">
            <button hlmBtn type="button" data-autofocus (click)="goTo(url)">
              <ng-icon name="lucideExternalLink" aria-hidden="true" />
              {{ step().submitLabel || 'Continue to sign in' }}
            </button>
            <ng-container [ngTemplateOutlet]="actions" />
          </div>
        } @else {
          <p class="text-destructive text-sm" role="alert">The sign-in address is not a secure link, so it was not opened.</p>
        }
      }

      @case ('select') {
        <form class="flex flex-col gap-4" novalidate (submit)="submitSelect($event)">
          <fieldset class="flex flex-col gap-2" [attr.aria-labelledby]="headingId()">
            @for (option of step().options ?? []; track option.value) {
              <label class="hover:bg-muted/50 has-[:checked]:border-primary flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
                <input
                  type="radio"
                  class="accent-primary mt-1 size-4"
                  [name]="'option-' + step().id"
                  [value]="option.value"
                  [checked]="chosen() === option.value"
                  [attr.data-autofocus]="$first ? '' : null"
                  (change)="choose(option.value)"
                />
                <span class="flex min-w-0 flex-col">
                  <span class="text-sm font-medium">{{ option.label }}</span>
                  @if (option.detail) {
                    <span class="text-muted-foreground text-sm">{{ linkText(option.detail) }}</span>
                  }
                </span>
              </label>
            }
          </fieldset>
          @if (selectError()) {
            <p class="text-destructive text-sm" role="alert">{{ selectError() }}</p>
          }
          <div class="flex flex-wrap items-center gap-2">
            <button hlmBtn type="submit" [disabled]="busy()">
              @if (busy()) {
                <hlm-spinner aria-hidden="true" />
              }
              {{ step().submitLabel || 'Continue' }}
            </button>
            <ng-container [ngTemplateOutlet]="actions" />
          </div>
        </form>
      }

      @case ('done') {
        <div hlmAlert>
          <ng-icon name="lucideCircleCheck" hlmAlertIcon />
          <p hlmAlertDescription role="status">{{ step().done?.title || 'Your account is linked.' }}</p>
        </div>
      }

      @case ('error') {
        <div class="flex flex-wrap items-center gap-2">
          <button hlmBtn type="button" data-autofocus (click)="restart.emit()">Try again</button>
        </div>
      }
    }

    <ng-template #actions>
      @for (action of step().actions ?? []; track action.id) {
        <button hlmBtn type="button" variant="link" class="px-1" [disabled]="busy()" (click)="submitted.emit({ values: {}, action: action.id })">{{ action.label }}</button>
      }
    </ng-template>
  `,
})
export class LinkStepView {
  protected readonly linkText = linkText;
  readonly step = input.required<LinkStepDto>();
  readonly busy = input(false);
  /** A problem with the last request (not part of the step itself). */
  readonly error = input<string | null>(null);

  readonly submitted = output<LinkSubmit>();
  readonly linkProvider = output<string>();
  readonly restart = output<void>();
  readonly poll = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly otpId = `link-otp-${Math.random().toString(36).slice(2, 8)}`;
  private readonly uid = Math.random().toString(36).slice(2, 8);

  protected readonly headingId = computed(() => `link-heading-${this.uid}`);
  protected readonly descriptionId = computed(() => `link-description-${this.uid}`);

  /** Values per field; kept while the same step comes back with an error, reset for a new step. */
  protected readonly values = linkedSignal<LinkStepDto, Record<string, string>>({
    source: this.step,
    computation: (step, previous) => (previous && previous.source.id === step.id ? previous.value : initialValues(step)),
  });
  protected readonly hints = linkedSignal<LinkStepDto, Record<string, string>>({ source: this.step, computation: () => ({}) });
  protected readonly summary = linkedSignal<LinkStepDto, string>({ source: this.step, computation: () => '' });
  protected readonly code = linkedSignal<LinkStepDto, string>({ source: this.step, computation: () => '' });
  protected readonly otpError = linkedSignal<LinkStepDto, string>({ source: this.step, computation: () => '' });
  protected readonly chosen = linkedSignal<LinkStepDto, string>({ source: this.step, computation: () => '' });
  protected readonly selectError = linkedSignal<LinkStepDto, string>({ source: this.step, computation: () => '' });

  protected readonly now = signal(Date.now());
  protected readonly remaining = computed(() => {
    const step = this.step();
    const expires = step.pushCode?.expiresAt ?? step.deviceCode?.expiresAt;
    return expires ? secondsLeft(expires, this.now()) : 0;
  });
  protected readonly clockText = computed(() => clock(this.remaining()));
  private readonly bucket = computed(() => countdownAnnouncement(this.remaining()));
  protected readonly announcement = computed(() => {
    const step = this.step();
    const parts = [step.title];
    if (step.kind === 'pushCode' && step.pushCode?.number) parts.push(`Your number is ${step.pushCode.number.split('').join(' ')}.`);
    if (step.kind === 'pushCode' || step.kind === 'deviceCode') parts.push(this.bucket());
    return parts.filter(Boolean).join(' ');
  });

  protected readonly otpNumeric = computed(() => this.step().otp?.numericOnly !== false);
  protected readonly verificationUrl = computed(() => {
    const uri = this.step().deviceCode?.verificationUri;
    return isHttps(uri) ? uri! : null;
  });
  protected readonly redirectUrl = computed(() => {
    const url = this.step().redirect?.url;
    return isHttps(url) ? url! : null;
  });
  protected readonly fallbackTitle = computed(() => {
    switch (this.step().kind) {
      case 'otp':
        return 'Enter your code';
      case 'pushCode':
        return 'Approve the sign-in';
      case 'deviceCode':
        return 'Enter this code to sign in';
      case 'select':
        return 'Choose an option';
      case 'done':
        return 'Account linked';
      case 'error':
        return 'Sign-in failed';
      default:
        return 'Sign in';
    }
  });

  /** Seconds between polls for the current code step, or 0. A computed, so a poll that changes nothing does not restart the timer. */
  private readonly pollSeconds = computed(() => {
    const step = this.step();
    const seconds = step.kind === 'pushCode' ? step.pushCode?.pollIntervalSeconds : step.kind === 'deviceCode' ? step.deviceCode?.pollIntervalSeconds : 0;
    return seconds ? Math.max(1, seconds) : 0;
  });

  constructor() {
    // Countdown tick and polling run only while a code step is on screen and stop when it leaves.
    effect((onCleanup) => {
      const seconds = this.pollSeconds();
      if (!seconds) return;
      this.now.set(Date.now());
      const tick = setInterval(() => this.now.set(Date.now()), 1000);
      const poller = setInterval(() => {
        if (typeof document === 'undefined' || !document.hidden) untracked(() => this.poll.emit());
      }, seconds * 1000);
      onCleanup(() => {
        clearInterval(tick);
        clearInterval(poller);
      });
    });

    // Move focus into the step when a new one appears; a poll that returns the same step does not steal it.
    let lastId: string | null = null;
    effect(() => {
      const id = this.step().id;
      if (id === lastId) return;
      lastId = id;
      afterNextRender(() => this.focusStep(), { injector: this.injector });
    });
  }

  private focusStep(): void {
    const root = this.host.nativeElement;
    const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>('h3');
    target?.focus({ preventScroll: false });
  }

  protected fieldId(field: LinkFieldDto): string {
    return `link-${this.uid}-${field.key}`;
  }
  protected listId(field: LinkFieldDto): string {
    return `${this.fieldId(field)}-list`;
  }
  protected helpId(field: LinkFieldDto): string {
    return `${this.fieldId(field)}-help`;
  }
  protected errorId(field: LinkFieldDto): string {
    return `${this.fieldId(field)}-error`;
  }
  protected describedBy(field: LinkFieldDto): string | null {
    const ids = [(field.help || field.type === 'totpSecret') && this.helpId(field), this.hints()[field.key] && this.errorId(field)].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }
  protected inputType(field: LinkFieldDto): string {
    switch (field.type) {
      case 'password':
      case 'totpSecret':
        return 'password';
      case 'email':
        return 'email';
      case 'url':
        return 'url';
      default:
        return 'text';
    }
  }
  protected autocomplete(field: LinkFieldDto): string {
    if (field.type === 'email') return 'username';
    if (field.type === 'password') return 'current-password';
    return 'off';
  }

  protected setValue(key: string, value: string): void {
    this.values.update((v) => ({ ...v, [key]: value }));
    if (this.hints()[key]) this.hints.update(({ [key]: _, ...rest }) => rest);
  }

  protected submitForm(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    const fields = this.step().fields ?? [];
    const hints = formHints(fields, this.values());
    this.hints.set(hints);
    const count = Object.keys(hints).length;
    this.summary.set(count ? `${count === 1 ? '1 field needs' : `${count} fields need`} attention.` : '');
    if (count) {
      const first = fields.find((f) => hints[f.key]);
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${first ? this.fieldId(first) : ''}`)?.focus(), { injector: this.injector });
      return;
    }
    const values = submitValues(fields, this.values());
    // Secrets leave this component with the submit and are not kept.
    this.values.update((v) => {
      const next = { ...v };
      for (const field of fields) if (field.secret || field.type === 'password' || field.type === 'totpSecret') next[field.key] = '';
      return next;
    });
    this.submitted.emit({ values });
  }

  protected setCode(value: string): void {
    this.code.set(this.otpNumeric() ? value.replace(/\D/g, '') : value);
    this.otpError.set('');
  }

  protected submitOtp(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    const length = this.step().otp?.length ?? 0;
    const code = this.code().trim();
    if (!code || (length && code.length !== length)) {
      this.otpError.set(length ? `Enter the ${length}-character code.` : 'Enter the code.');
      return;
    }
    this.code.set('');
    this.submitted.emit({ values: { code } });
  }

  protected choose(value: string): void {
    this.chosen.set(value);
    this.selectError.set('');
  }

  protected submitSelect(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    const option: LinkOptionDto | undefined = (this.step().options ?? []).find((o) => o.value === this.chosen());
    if (!option) {
      this.selectError.set('Choose an option to continue.');
      return;
    }
    if (option.linkProviderId) this.linkProvider.emit(option.linkProviderId);
    else this.submitted.emit({ values: { value: option.value } });
  }

  protected async copyCode(): Promise<void> {
    const code = this.step().deviceCode?.userCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Code copied');
    } catch {
      toast.error('Could not copy the code. Select it and copy it by hand.');
    }
  }

  protected goTo(url: string): void {
    if (isHttps(url)) window.location.assign(url);
  }
}
