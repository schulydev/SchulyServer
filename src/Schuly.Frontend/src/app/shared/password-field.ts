import { Component, input, model, signal } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEye, lucideEyeOff } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * A password input with its show/hide toggle joined on the right, outside the input box. Password managers
 * (KeePassXC, Bitwarden, 1Password, the browser's key) draw their icon inside the input's right edge, so
 * nothing of ours sits there. Works with `[formField]` or with `[(value)]`.
 */
@Component({
  selector: 'app-password-field',
  imports: [NgIcon, TranslatePipe],
  providers: [provideIcons({ lucideEye, lucideEyeOff })],
  host: { class: 'flex w-full min-w-0' },
  template: `
    <input
      class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 placeholder:text-muted-foreground h-8 w-full min-w-0 rounded-l-lg rounded-r-none border bg-transparent px-2.5 py-1 text-base outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      [id]="inputId()"
      [attr.name]="fieldName() || inputId()"
      [type]="shown() ? 'text' : 'password'"
      [attr.autocomplete]="autocomplete()"
      [attr.data-autofocus]="autofocus() ? '' : null"
      [attr.aria-invalid]="(invalid() && touched()) || markInvalid() ? 'true' : null"
      [attr.aria-describedby]="describedBy() || null"
      [disabled]="disabled()"
      [value]="value()"
      (input)="value.set($any($event.target).value)"
      (blur)="touched.set(true)"
    />
    <button
      type="button"
      class="border-input text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 grid size-8 shrink-0 place-items-center rounded-l-none rounded-r-lg border border-l-0 outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-3"
      [attr.aria-label]="(shown() ? 'auth.login.hidePassword' : 'auth.login.showPassword') | translate"
      [attr.aria-pressed]="shown()"
      [attr.aria-controls]="inputId()"
      [disabled]="disabled()"
      (click)="shown.set(!shown())"
    >
      <ng-icon [name]="shown() ? 'lucideEyeOff' : 'lucideEye'" size="16px" class="block size-4 leading-none" aria-hidden="true" />
    </button>
  `,
})
export class PasswordField implements FormValueControl<string> {
  readonly value = model('');
  readonly touched = model(false);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly inputId = input.required<string>();
  /** Defaults to the id, so a manager sees the same stable name every time. */
  readonly fieldName = input<string>('');
  /** For an error the form itself doesn't know about, such as a refused sign-in. */
  readonly markInvalid = input(false);
  readonly autocomplete = input.required<'current-password' | 'new-password'>();
  readonly autofocus = input(false);
  readonly describedBy = input<string>('');
  protected readonly shown = signal(false);
}

/**
 * The account a password form belongs to, for password managers to match an entry. Visually hidden rather
 * than display:none, which some managers skip; never focused and not read out.
 */
@Component({
  selector: 'app-username-hint',
  host: { class: 'sr-only' },
  template: `<input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" readonly [value]="username()" />`,
})
export class UsernameHint {
  readonly username = input.required<string>();
}
