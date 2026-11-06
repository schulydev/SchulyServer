import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The "Sign in with Microsoft" button as Microsoft's branding guidelines specify it
 * (learn.microsoft.com/entra/identity-platform/howto-add-branding-in-apps): the official logo SVG at 21 px,
 * 41 px high, 12 px padding and 12 px between logo and text, Segoe UI 15 px weight 600, square corners.
 * Light: #FFFFFF with a 1 px #8C8C8C border and #5E5E5E text. Dark: #2F2F2F with #FFFFFF text.
 */
@Component({
  selector: 'app-microsoft-sign-in-button',
  imports: [TranslatePipe],
  template: `
    <button type="button" class="ms-sign-in" [disabled]="disabled()" (click)="pressed.emit()">
      <img src="/sso-icons/microsoft.svg" alt="" width="21" height="21" />
      <span>{{ 'auth.login.signInWithMicrosoft' | translate }}</span>
    </button>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: center;
    }
    .ms-sign-in {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      height: 41px;
      padding: 0 12px;
      border: 1px solid #8c8c8c;
      border-radius: 0;
      background: #ffffff;
      color: #5e5e5e;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 15px;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
    }
    .ms-sign-in img {
      display: block;
      width: 21px;
      height: 21px;
    }
    :host-context(.dark) .ms-sign-in {
      border-color: #2f2f2f;
      background: #2f2f2f;
      color: #ffffff;
    }
    .ms-sign-in:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
    }
    .ms-sign-in:disabled {
      cursor: default;
      opacity: 0.6;
    }
  `,
})
export class MicrosoftSignInButton {
  readonly disabled = input(false);
  readonly pressed = output<void>();
}

/** Microsoft providers get the branded button; the server maps their authority to this icon. */
export const isMicrosoftProvider = (provider: { key: string; icon_url?: string | null }): boolean =>
  provider.icon_url === '/sso-icons/microsoft.svg' || provider.key.toLowerCase() === 'microsoft';
