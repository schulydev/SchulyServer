import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { form, FormField, FormRoot, minLength, required } from '@angular/forms/signals';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSeparator } from '@spartan-ng/helm/separator';
import { SecurityStore } from '../../stores/security.store';
import { AppDatePipe } from '../../core/date-format';

@Component({
  selector: 'app-security-card',
  imports: [
    AppDatePipe,
    FormRoot,
    FormField,
    HlmAlertImports,
    HlmBadge,
    HlmButton,
    HlmCardImports,
    HlmFieldImports,
    HlmInput,
    HlmSeparator,
  ],
  template: `
    <section hlmCard>
      <div hlmCardHeader>
        <h3 hlmCardTitle>Security</h3>
        <p hlmCardDescription>Your password, two-factor authentication, sign-in providers and remembered devices.</p>
      </div>
      <div hlmCardContent class="flex flex-col gap-6">
        @if (security.signInAgain() && !security.recoveryCodes()) {
          <div hlmAlert>
            <h4 hlmAlertTitle>{{ security.signInAgain() }}</h4>
            <p hlmAlertDescription>
              For your safety, changing how you sign in ends every session, including this one.
            </p>
          </div>
          <button hlmBtn class="self-start" (click)="security.continueToSignIn()">
            Sign in again
          </button>
        }
        @if (security.notice()) {
          <div hlmAlert>
            <p hlmAlertDescription>{{ security.notice() }}</p>
          </div>
        }
        @if (security.error()) {
          <div hlmAlert variant="destructive">
            <p hlmAlertDescription>{{ security.error() }}</p>
          </div>
        }

        <form class="flex flex-col gap-3" [formRoot]="passwordForm">
          <span class="text-sm font-medium">Change password</span>
          <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div hlmField>
              <label hlmFieldLabel for="current-password">Current password</label>
              <input
                hlmInput
                id="current-password"
                type="password"
                autocomplete="current-password"
                [formField]="passwordForm.currentPassword"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="next-password">New password</label>
              <input
                hlmInput
                id="next-password"
                type="password"
                autocomplete="new-password"
                [formField]="passwordForm.newPassword"
              />
            </div>
            <button
              hlmBtn
              variant="outline"
              type="submit"
              [disabled]="security.busy() || passwordForm().invalid()"
            >
              Change
            </button>
          </div>
        </form>

        <hlm-separator />

        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">Two-factor authentication</span>
            @if (security.twoFactor()?.enabled) {
              <span hlmBadge variant="outline">On</span>
            } @else {
              <span hlmBadge variant="secondary">Off</span>
            }
          </div>

          @if (security.recoveryCodes(); as codes) {
            <div hlmAlert>
              <h4 hlmAlertTitle>Save your recovery codes</h4>
              <p hlmAlertDescription>
                Each one signs you in once if you lose your phone. They are only shown now.
              </p>
            </div>
            <ul class="bg-muted grid grid-cols-2 gap-2 rounded-lg p-4 font-mono text-sm">
              @for (code of codes; track code) {
                <li>{{ code }}</li>
              }
            </ul>
            <button hlmBtn class="self-start" (click)="security.continueToSignIn()">
              I saved them
            </button>
          } @else if (security.setup(); as setup) {
            <p class="text-muted-foreground text-sm">
              Scan this with an authenticator app, then enter the 6-digit code it shows.
            </p>
            <div class="flex flex-wrap items-start gap-6">
              <img
                [src]="setup.qr"
                alt="QR code for your authenticator app"
                class="size-40 rounded-lg border bg-white p-1"
              />
              <form class="flex flex-1 flex-col gap-3" [formRoot]="confirmForm">
                <div hlmField>
                  <label hlmFieldLabel for="setup-code">Code</label>
                  <input
                    hlmInput
                    id="setup-code"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    [formField]="confirmForm.code"
                  />
                </div>
                <p class="text-muted-foreground text-xs break-all">
                  Or type this key: <span class="font-mono">{{ setup.secret }}</span>
                </p>
                <div class="flex gap-2">
                  <button
                    hlmBtn
                    type="submit"
                    [disabled]="security.busy() || confirmForm().invalid()"
                  >
                    Turn on
                  </button>
                  <button hlmBtn variant="ghost" type="button" (click)="security.cancelSetup()">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          } @else if (security.twoFactor()?.enabled) {
            <p class="text-muted-foreground text-sm">
              {{ security.twoFactor()?.recoveryCodesRemaining ?? 0 }} recovery codes left.
            </p>
            <form
              class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              [formRoot]="disableForm"
            >
              <div hlmField>
                <label hlmFieldLabel for="disable-password">Current password</label>
                <input
                  hlmInput
                  id="disable-password"
                  type="password"
                  autocomplete="current-password"
                  [formField]="disableForm.password"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="disable-code"
                  >Code from your app, or a recovery code</label
                >
                <input
                  hlmInput
                  id="disable-code"
                  autocomplete="one-time-code"
                  [formField]="disableForm.proof"
                />
              </div>
              <button
                hlmBtn
                variant="outline"
                type="submit"
                [disabled]="security.busy() || disableForm().invalid()"
              >
                Turn off
              </button>
            </form>
          } @else {
            <p class="text-muted-foreground text-sm">
              Ask for a code from your phone each time you sign in on a new device.
            </p>
            <form class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" [formRoot]="beginForm">
              <div hlmField>
                <label hlmFieldLabel for="enable-password">Current password</label>
                <input
                  hlmInput
                  id="enable-password"
                  type="password"
                  autocomplete="current-password"
                  [formField]="beginForm.currentPassword"
                />
              </div>
              <button hlmBtn type="submit" [disabled]="security.busy() || beginForm().invalid()">
                Set up
              </button>
            </form>
          }
        </div>

        @if (security.providers().length || security.linked().length) {
          <hlm-separator />
          <div class="flex flex-col gap-3">
            <span class="text-sm font-medium">Sign-in providers</span>
            <ul class="divide-y rounded-lg border">
              @for (provider of providerRows(); track provider.key) {
                <li class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    {{ provider.name }}
                    @if (provider.linked) {
                      <span hlmBadge variant="outline" class="ml-1">Linked</span>
                    }
                  </span>
                  @if (provider.linked) {
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      [disabled]="security.busy()"
                      (click)="security.unlinkProvider(provider.key, proof())"
                    >
                      Unlink
                    </button>
                  } @else {
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      [disabled]="security.busy()"
                      (click)="security.linkProvider(provider.key, proof())"
                    >
                      Link
                    </button>
                  }
                </li>
              }
            </ul>
            <div hlmField>
              <label hlmFieldLabel for="provider-proof">{{
                security.twoFactor()?.enabled ? 'Code from your app' : 'Current password'
              }}</label>
              <input
                hlmInput
                id="provider-proof"
                [type]="security.twoFactor()?.enabled ? 'text' : 'password'"
                [attr.autocomplete]="security.twoFactor()?.enabled ? 'one-time-code' : 'current-password'"
                [value]="proofValue()"
                (input)="proofValue.set($any($event.target).value)"
              />
              <p hlmFieldDescription>
                Needed to link or unlink. Unlinking signs you out everywhere.
              </p>
            </div>
          </div>
        }

        @if (security.devices().length) {
          <hlm-separator />
          <div class="flex flex-col gap-3">
            <span class="text-sm font-medium">Remembered devices</span>
            <ul class="divide-y rounded-lg border">
              @for (device of security.devices(); track device.id) {
                <li class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    {{ device.label || 'Unknown device' }}
                    @if (device.isCurrent) {
                      <span hlmBadge variant="secondary" class="ml-1">This device</span>
                    }
                  </span>
                  <span class="text-muted-foreground text-xs">{{
                    device.lastUsedAt || device.createdAt | appDate: 'date'
                  }}</span>
                </li>
              }
            </ul>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              class="self-start"
              [disabled]="security.busy()"
              (click)="security.forgetDevices()"
            >
              Forget all devices
            </button>
          </div>
        }
      </div>
    </section>
  `,
})
export class SecurityCard {
  protected readonly security = inject(SecurityStore);
  protected readonly proofValue = signal('');
  protected readonly providerRows = computed(() => {
    const linked = this.security.linked();
    const rows = this.security.providers().map((provider) => ({ key: provider.key, name: provider.display_name, linked: linked.some((login) => login.provider === provider.key) }));
    const retired = linked.filter((login) => !rows.some((row) => row.key === login.provider)).map((login) => ({ key: login.provider, name: login.display_name ?? login.provider, linked: true }));
    return [...rows, ...retired];
  });

  constructor() {
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    if (query.has('linked') || query.has('error')) {
      this.security.linkFinished(query.get('linked'), query.get('error'), query.get('state'));
      void inject(Router).navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  protected proof(): { currentPassword?: string; code?: string } {
    const value = this.proofValue().trim();
    if (!value) return {};
    return this.security.twoFactor()?.enabled ? { code: value } : { currentPassword: value };
  }
  private readonly passwordModel = signal({ currentPassword: '', newPassword: '' });
  protected readonly passwordForm = form(
    this.passwordModel,
    (path) => {
      required(path.currentPassword);
      required(path.newPassword);
      minLength(path.newPassword, 8);
    },
    {
      submission: {
        action: async () => {
          const { currentPassword, newPassword } = this.passwordModel();
          await this.security.changePassword(currentPassword, newPassword);
          this.passwordModel.set({ currentPassword: '', newPassword: '' });
          return undefined;
        },
      },
    },
  );

  private readonly beginModel = signal({ currentPassword: '' });
  protected readonly beginForm = form(this.beginModel, (path) => required(path.currentPassword), {
    submission: {
      action: async () => {
        await this.security.beginTwoFactor(this.beginModel().currentPassword);
        this.beginModel.set({ currentPassword: '' });
        return undefined;
      },
    },
  });

  private readonly confirmModel = signal({ code: '' });
  protected readonly confirmForm = form(
    this.confirmModel,
    (path) => {
      required(path.code);
      minLength(path.code, 6);
    },
    {
      submission: {
        action: async () => {
          await this.security.confirmTwoFactor(this.confirmModel().code.trim());
          this.confirmModel.set({ code: '' });
          return undefined;
        },
      },
    },
  );

  private readonly disableModel = signal({ password: '', proof: '' });
  protected readonly disableForm = form(
    this.disableModel,
    (path) => {
      required(path.password);
      required(path.proof);
    },
    {
      submission: {
        action: async () => {
          await this.security.disableTwoFactor(
            this.disableModel().proof.trim(),
            this.disableModel().password,
          );
          this.disableModel.set({ password: '', proof: '' });
          return undefined;
        },
      },
    },
  );
}
