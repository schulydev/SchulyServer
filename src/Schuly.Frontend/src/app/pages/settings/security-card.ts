import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideKeyRound, lucidePlus } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { SessionSummary, SignInProof } from '../../core/auth-api';
import { formatModified } from '../../core/date-format';
import { t } from '../../core/i18n';
import { describeAgent } from '../../core/signed-in-at';
import { PasswordField, UsernameHint } from '../../shared/password-field';
import { ProviderRow, SecurityStore } from '../../stores/security.store';
import { UserStore } from '../../stores/user.store';
import { Proof } from './proof';

type Dialog =
  | { kind: 'password' }
  | { kind: 'twoFactor' }
  | { kind: 'twoFactorOff' }
  | { kind: 'linkPick' }
  | { kind: 'link'; provider: ProviderRow }
  | { kind: 'unlink'; provider: ProviderRow }
  | { kind: 'lastWayIn'; provider: ProviderRow }
  | { kind: 'signOut'; session: SessionSummary }
  | { kind: 'signInAgain' };

const MIN_PASSWORD = 8;

/** How you sign in and where you're signed in. The rows say the current state; every change happens in a dialog that asks for proof the way this account can give it. */
@Component({
  selector: 'app-security-card',
  imports: [NgIcon, TranslatePipe, HlmAlertImports, HlmButton, HlmCardImports, HlmDialogImports, HlmFieldImports, HlmInput, PasswordField, UsernameHint, Proof],
  providers: [provideIcons({ lucideArrowLeft, lucideKeyRound, lucidePlus })],
  template: `
    <section hlmCard aria-labelledby="security-title">
      <div hlmCardHeader>
        <h3 hlmCardTitle id="security-title">{{ 'settings.security.title' | translate }}</h3>
        <p hlmCardDescription>{{ 'settings.security.description' | translate }}</p>
      </div>
      <div hlmCardContent class="flex flex-col">
        @if (security.notice() && !dialog()) {
          <div hlmAlert class="mb-3" role="status">
            <p hlmAlertDescription>{{ security.notice() }}</p>
          </div>
        }
        @if (security.error() && !dialog()) {
          <div hlmAlert variant="destructive" class="mb-3" role="alert">
            <p hlmAlertDescription>{{ security.error() }}</p>
          </div>
        }

        <ul class="divide-y">
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">{{ 'settings.security.password.label' | translate }}</span>
              <span class="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                <span class="size-1.5 shrink-0 rounded-full" [class]="user.hasPassword() ? 'bg-green-500' : 'bg-muted-foreground'" aria-hidden="true"></span>
                {{ (user.hasPassword() ? 'settings.security.password.set' : 'settings.security.password.notSet') | translate }}
              </span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" (click)="open({ kind: 'password' })">
              {{ (user.hasPassword() ? 'settings.security.password.change' : 'settings.security.password.add') | translate }}
            </button>
          </li>
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">{{ 'settings.security.twoFactor.label' | translate }}</span>
              <span class="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                <span class="size-1.5 shrink-0 rounded-full" [class]="twoFactorOn() ? 'bg-green-500' : 'bg-muted-foreground'" aria-hidden="true"></span>
                @if (twoFactorOn()) {
                  {{ 'settings.security.twoFactor.on' | translate: { count: security.twoFactor()?.recoveryCodesRemaining ?? 0 } }}
                } @else {
                  {{ 'settings.security.twoFactor.off' | translate }}
                }
              </span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" (click)="open({ kind: twoFactorOn() ? 'twoFactorOff' : 'twoFactor' })">
              {{ (twoFactorOn() ? 'settings.security.twoFactor.turnOff' : 'settings.security.twoFactor.setUp') | translate }}
            </button>
          </li>
        </ul>

        @if (security.providers().length || security.linked().length) {
          <div class="mt-2 flex items-center justify-between gap-3 border-t pt-4 pb-1">
            <h4 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{{ 'settings.security.providers.title' | translate }}</h4>
            @if (security.unlinkedRows().length) {
              <button hlmBtn variant="outline" size="sm" type="button" [attr.aria-label]="'settings.security.providers.linkAria' | translate" (click)="open({ kind: 'linkPick' })">
                <ng-icon name="lucidePlus" aria-hidden="true" />
                {{ 'settings.security.providers.link' | translate }}
              </button>
            }
          </div>
          @if (security.linkedRows().length) {
            <ul class="divide-y">
              @for (provider of security.linkedRows(); track provider.key) {
                <li class="flex items-center justify-between gap-4 py-3">
                  <span class="flex min-w-0 items-center gap-3">
                    <span class="bg-muted grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold" aria-hidden="true">
                      @if (provider.iconUrl) {
                        <img [src]="provider.iconUrl" alt="" class="size-4 object-contain" />
                      } @else {
                        {{ provider.name.charAt(0) }}
                      }
                    </span>
                    <span class="truncate text-sm font-medium">{{ provider.name }}</span>
                  </span>
                  <button hlmBtn variant="outline" type="button" class="shrink-0" [attr.aria-label]="'settings.security.providers.unlinkAria' | translate: { name: provider.name }" (click)="unlink(provider)">{{ 'settings.security.providers.unlink' | translate }}</button>
                </li>
              }
            </ul>
          } @else {
            <p class="text-muted-foreground py-3 text-sm">{{ 'settings.security.providers.none' | translate }}</p>
          }
        }

        @if (security.sessions().length) {
          <h4 class="text-muted-foreground mt-2 border-t pt-4 pb-1 text-xs font-semibold tracking-wide uppercase">{{ 'settings.security.devices.title' | translate }}</h4>
          <ul class="divide-y">
            @for (session of security.sessions(); track session.id) {
              <li class="flex items-center justify-between gap-4 py-3">
                <span class="grid min-w-0 gap-0.5">
                  <span class="truncate text-sm font-medium">{{ deviceName(session) }}</span>
                  <span class="text-muted-foreground text-xs">{{ 'settings.security.devices.lastActive' | translate: { when: when(session.lastUsedAt) } }}</span>
                </span>
                @if (session.isCurrent) {
                  <span class="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-sm">
                    <span class="size-1.5 rounded-full bg-green-500" aria-hidden="true"></span>
                    {{ 'settings.security.devices.thisDevice' | translate }}
                  </span>
                } @else {
                  <button hlmBtn variant="outline" type="button" class="shrink-0" [attr.aria-label]="'settings.security.devices.signOutAria' | translate: { name: deviceName(session) }" (click)="open({ kind: 'signOut', session })">{{ 'settings.security.devices.signOut' | translate }}</button>
                }
              </li>
            }
          </ul>
        }
        @if (security.devices().length) {
          <div class="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span class="text-muted-foreground text-xs">{{ 'settings.security.devices.remembered' | translate: { count: security.devices().length } }}</span>
            <button hlmBtn variant="ghost" size="sm" type="button" [disabled]="security.busy()" (click)="security.forgetDevices()">{{ 'settings.security.devices.forget' | translate }}</button>
          </div>
        }
      </div>
    </section>

    <hlm-dialog [state]="dialog() ? 'open' : 'closed'" (closed)="close()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        @switch (dialog()?.kind) {
          @case ('password') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ (user.hasPassword() ? 'settings.security.passwordDialog.changeTitle' : 'settings.security.passwordDialog.addTitle') | translate }}</h2>
              <p hlmDialogDescription>
                {{ (user.hasPassword() ? 'settings.security.passwordDialog.changeDescription' : 'settings.security.passwordDialog.addDescription') | translate }}
              </p>
            </hlm-dialog-header>
            <form class="flex flex-col gap-4" (submit)="submitPassword($event)">
              <app-username-hint [username]="user.email()" />
              <app-proof #proof [reason]="'settings.proof.reason.addPassword' | translate" resume="password" [(password)]="currentPassword" />
              @if (proof.mode() !== 'reauth') {
                <div hlmField>
                  <label hlmFieldLabel for="new-password">{{ 'settings.security.passwordDialog.newPassword' | translate }}</label>
                  <app-password-field inputId="new-password" autocomplete="new-password" [autofocus]="proof.mode() === 'none'" [(value)]="newPassword" />
                  <p hlmFieldDescription>{{ 'settings.security.passwordDialog.newPasswordHint' | translate: { min: minPassword } }}</p>
                </div>
              }
              @if (security.error()) {
                <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                <button hlmBtn type="submit" [disabled]="security.busy() || !proof.ready() || newPassword().length < minPassword">
                  {{ (user.hasPassword() ? 'settings.security.passwordDialog.submitChange' : 'settings.security.passwordDialog.submitAdd') | translate }}
                </button>
              </hlm-dialog-footer>
            </form>
          }
          @case ('twoFactor') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ 'settings.security.twoFactorDialog.title' | translate }}</h2>
              <p hlmDialogDescription>{{ 'settings.security.twoFactorDialog.step' | translate: { step: twoFactorStep(), label: stepLabel() } }}</p>
            </hlm-dialog-header>
            <div class="flex gap-1.5" aria-hidden="true">
              @for (n of [1, 2, 3]; track n) {
                <span class="h-1 flex-1 rounded-full" [class]="n <= twoFactorStep() ? 'bg-primary' : 'bg-border'"></span>
              }
            </div>
            @if (security.recoveryCodes(); as codes) {
              <div hlmAlert>
                <h3 hlmAlertTitle>{{ 'settings.security.twoFactorDialog.codesTitle' | translate }}</h3>
                <p hlmAlertDescription>{{ 'settings.security.twoFactorDialog.codesText' | translate }}</p>
              </div>
              <ul class="bg-muted grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg p-3 font-mono text-sm" [attr.aria-label]="'settings.security.twoFactorDialog.codesAria' | translate">
                @for (code of codes; track code) {
                  <li>{{ code }}</li>
                }
              </ul>
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="copy(codes)">{{ 'settings.security.twoFactorDialog.copyCodes' | translate }}</button>
                <button hlmBtn type="button" data-autofocus (click)="savedCodes()">{{ 'settings.security.twoFactorDialog.saved' | translate }}</button>
              </hlm-dialog-footer>
            } @else if (security.setup(); as setup) {
              <form class="flex flex-col gap-4" (submit)="confirmTwoFactor($event)">
                <p class="text-muted-foreground text-sm">{{ 'settings.security.twoFactorDialog.scan' | translate }}</p>
                <img [src]="setup.qr" [alt]="'settings.security.twoFactorDialog.qrAlt' | translate" class="size-40 self-center rounded-lg border bg-white p-1" />
                <p class="text-muted-foreground text-center text-xs break-all">{{ 'settings.security.twoFactorDialog.cantScan' | translate }} <span class="font-mono">{{ setup.secret }}</span></p>
                <div hlmField>
                  <label hlmFieldLabel for="setup-code">{{ 'settings.security.twoFactorDialog.codeLabel' | translate }}</label>
                  <input hlmInput id="setup-code" name="one-time-code" class="font-mono" inputmode="numeric" autocomplete="one-time-code" maxlength="7" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
                </div>
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="ghost" type="button" class="sm:mr-auto" (click)="security.cancelSetup()">
                    <ng-icon name="lucideArrowLeft" aria-hidden="true" /> {{ 'common.back' | translate }}
                  </button>
                  <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                  <button hlmBtn type="submit" [disabled]="security.busy() || code().replace(' ', '').length < 6">{{ 'settings.security.twoFactorDialog.verify' | translate }}</button>
                </hlm-dialog-footer>
              </form>
            } @else {
              <form class="flex flex-col gap-4" (submit)="beginTwoFactor($event)">
                <app-username-hint [username]="user.email()" />
                <app-proof #proof [reason]="'settings.proof.reason.twoFactor' | translate" resume="twoFactor" [(password)]="currentPassword" />
                @if (proof.mode() !== 'reauth') {
                  <div hlmAlert>
                    <ng-icon name="lucideKeyRound" hlmAlertIcon aria-hidden="true" />
                    <h3 hlmAlertTitle>{{ 'settings.security.twoFactorDialog.appTitle' | translate }}</h3>
                    <p hlmAlertDescription>{{ 'settings.security.twoFactorDialog.appText' | translate }}</p>
                  </div>
                }
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                  <button hlmBtn type="submit" [attr.data-autofocus]="proof.mode() === 'none' ? '' : null" [disabled]="security.busy() || !proof.ready()">{{ 'common.next' | translate }}</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('twoFactorOff') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ 'settings.security.twoFactorOff.title' | translate }}</h2>
              <p hlmDialogDescription>{{ 'settings.security.twoFactorOff.description' | translate }}</p>
            </hlm-dialog-header>
            <form class="flex flex-col gap-4" (submit)="disableTwoFactor($event)">
              <app-username-hint [username]="user.email()" />
              <div hlmField>
                <label hlmFieldLabel for="off-code">{{ 'settings.security.twoFactorOff.codeLabel' | translate }}</label>
                <input hlmInput id="off-code" name="one-time-code" class="font-mono" autocomplete="one-time-code" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
              </div>
              <app-proof #proof [reason]="'settings.proof.reason.twoFactorOff' | translate" resume="twoFactorOff" [(password)]="currentPassword" />
              @if (security.error()) {
                <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                <button hlmBtn variant="destructive" type="submit" [disabled]="security.busy() || !proof.ready() || !code().trim()">{{ 'settings.security.twoFactor.turnOff' | translate }}</button>
              </hlm-dialog-footer>
            </form>
          }
          @case ('linkPick') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ 'settings.security.linkPick.title' | translate }}</h2>
              <p hlmDialogDescription>{{ 'settings.security.linkPick.description' | translate }}</p>
            </hlm-dialog-header>
            <ul class="divide-y rounded-xl border">
              @for (provider of security.unlinkedRows(); track provider.key) {
                <li class="flex items-center justify-between gap-4 px-3.5 py-3">
                  <span class="flex min-w-0 items-center gap-3">
                    <span class="bg-muted grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold" aria-hidden="true">
                      @if (provider.iconUrl) {
                        <img [src]="provider.iconUrl" alt="" class="size-4 object-contain" />
                      } @else {
                        {{ provider.name.charAt(0) }}
                      }
                    </span>
                    <span class="truncate text-sm font-medium">{{ provider.name }}</span>
                  </span>
                  <button hlmBtn type="button" class="shrink-0" [attr.data-autofocus]="$first ? '' : null" [attr.aria-label]="'settings.security.linkPick.linkAria' | translate: { name: provider.name }" (click)="open({ kind: 'link', provider })">{{ 'settings.security.providers.link' | translate }}</button>
                </li>
              }
            </ul>
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
            </hlm-dialog-footer>
          }
          @case ('link') {
            @if (providerOf(dialog()); as provider) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>{{ 'settings.security.link.title' | translate: { name: provider.name } }}</h2>
                <p hlmDialogDescription>{{ 'settings.security.link.description' | translate: { name: provider.name } }}</p>
              </hlm-dialog-header>
              <form class="flex flex-col gap-4" (submit)="link($event, provider)">
                <app-username-hint [username]="user.email()" />
                @if (twoFactorOn()) {
                  <div hlmField>
                    <label hlmFieldLabel for="link-code">{{ 'settings.security.link.codeLabel' | translate }}</label>
                    <input hlmInput id="link-code" name="one-time-code" class="font-mono" autocomplete="one-time-code" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
                  </div>
                } @else {
                  <app-proof #proof [reason]="'settings.proof.reason.link' | translate: { name: provider.name }" [resume]="'link:' + provider.key" [(password)]="currentPassword" />
                }
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                  <button hlmBtn type="submit" [disabled]="security.busy() || !proofReady()">{{ 'settings.security.link.submit' | translate: { name: provider.name } }}</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('unlink') {
            @if (providerOf(dialog()); as provider) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>{{ 'settings.security.unlink.title' | translate: { name: provider.name } }}</h2>
                <p hlmDialogDescription>{{ 'settings.security.unlink.description' | translate: { name: provider.name } }}</p>
              </hlm-dialog-header>
              <form class="flex flex-col gap-4" (submit)="unlinkConfirmed($event, provider)">
                <app-username-hint [username]="user.email()" />
                @if (twoFactorOn()) {
                  <div hlmField>
                    <label hlmFieldLabel for="unlink-code">{{ 'settings.security.link.codeLabel' | translate }}</label>
                    <input hlmInput id="unlink-code" name="one-time-code" class="font-mono" autocomplete="one-time-code" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
                  </div>
                } @else {
                  <app-proof #proof [reason]="'settings.proof.reason.unlink' | translate: { name: provider.name }" [resume]="'unlink:' + provider.key" [(password)]="currentPassword" />
                }
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                  <button hlmBtn variant="destructive" type="submit" [disabled]="security.busy() || !proofReady()">{{ 'settings.security.providers.unlink' | translate }}</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('lastWayIn') {
            @if (providerOf(dialog()); as provider) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>{{ 'settings.security.lastWayIn.title' | translate: { name: provider.name } }}</h2>
                <p hlmDialogDescription class="sr-only">{{ 'settings.security.lastWayIn.alertTitle' | translate }}</p>
              </hlm-dialog-header>
              <div hlmAlert variant="destructive">
                <h3 hlmAlertTitle>{{ 'settings.security.lastWayIn.alertTitle' | translate }}</h3>
                <p hlmAlertDescription>{{ 'settings.security.lastWayIn.alertText' | translate }}</p>
              </div>
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.close' | translate }}</button>
                <button hlmBtn type="button" data-autofocus (click)="open({ kind: 'password' })">{{ 'settings.security.lastWayIn.addPassword' | translate }}</button>
              </hlm-dialog-footer>
            }
          }
          @case ('signOut') {
            @if (sessionOf(dialog()); as session) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>{{ 'settings.security.signOutDialog.title' | translate: { name: deviceName(session) } }}</h2>
                <p hlmDialogDescription>{{ 'settings.security.signOutDialog.description' | translate }}</p>
              </hlm-dialog-header>
              @if (security.error()) {
                <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                <button hlmBtn variant="destructive" type="button" data-autofocus [disabled]="security.busy()" (click)="signOut(session)">{{ 'settings.security.devices.signOut' | translate }}</button>
              </hlm-dialog-footer>
            }
          }
          @case ('signInAgain') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ security.signInAgain() }}</h2>
              <p hlmDialogDescription>{{ 'settings.security.signInAgain.description' | translate }}</p>
            </hlm-dialog-header>
            <hlm-dialog-footer>
              <button hlmBtn type="button" data-autofocus (click)="security.continueToSignIn()">{{ 'settings.security.signInAgain.button' | translate }}</button>
            </hlm-dialog-footer>
          }
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class SecurityCard {
  protected readonly security = inject(SecurityStore);
  protected readonly user = inject(UserStore);
  /** A settings action to reopen after signing in again, such as `password` or `unlink:google`. */
  readonly resume = input<string | null>(null);

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly code = signal('');
  protected readonly minPassword = MIN_PASSWORD;
  private readonly proof = viewChild<Proof>('proof');

  protected readonly twoFactorOn = computed(() => !!this.security.twoFactor()?.enabled);
  protected readonly twoFactorStep = computed(() => (this.security.recoveryCodes() ? 3 : this.security.setup() ? 2 : 1));
  protected readonly stepLabel = computed(() => t(`settings.security.twoFactorDialog.steps.${['proof', 'app', 'codes'][this.twoFactorStep() - 1]}`));
  private resumed = false;
  /** Link and unlink take a code when there is a second factor, otherwise the account's usual proof. */
  protected readonly proofReady = computed(() => (this.twoFactorOn() ? this.code().trim().length > 0 : (this.proof()?.ready() ?? false)));
  private readonly waysIn = computed(() => this.security.linkedRows().length + (this.user.hasPassword() ? 1 : 0));

  constructor() {
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    if (query.has('linked') || query.has('error')) {
      this.security.linkFinished(query.get('linked'), query.get('error'), query.get('state'));
      void inject(Router).navigate([], { queryParams: {}, replaceUrl: true });
    }
    effect(() => {
      if (this.security.signInAgain() && !this.security.recoveryCodes()) untracked(() => this.dialog.set({ kind: 'signInAgain' }));
    });
    // Reopens the action that sent the user to sign in again, once the providers it may name have loaded.
    effect(() => {
      const resume = this.resume();
      if (!resume || this.resumed || this.security.busy() || !this.user.user()) return;
      this.resumed = true;
      untracked(() => this.reopen(resume));
    });
  }

  private reopen(resume: string): void {
    const [kind, key] = resume.split(':');
    const provider = (rows: ProviderRow[]) => rows.find((row) => row.key === key);
    if (kind === 'password' || kind === 'twoFactor' || kind === 'twoFactorOff') this.open({ kind });
    else if (kind === 'link' && provider(this.security.unlinkedRows())) this.open({ kind: 'link', provider: provider(this.security.unlinkedRows())! });
    else if (kind === 'unlink' && provider(this.security.linkedRows())) this.open({ kind: 'unlink', provider: provider(this.security.linkedRows())! });
  }

  protected open(dialog: Dialog): void {
    this.security.clearError();
    this.currentPassword.set('');
    this.newPassword.set('');
    this.code.set('');
    this.dialog.set(dialog);
  }

  protected close(): void {
    if (this.security.signInAgain()) return this.dialog.set({ kind: 'signInAgain' });
    if (this.security.setup()) this.security.cancelSetup();
    this.dialog.set(null);
    this.security.clearError();
  }

  protected providerOf(dialog: Dialog | null): ProviderRow | null {
    return dialog && 'provider' in dialog ? dialog.provider : null;
  }

  protected sessionOf(dialog: Dialog | null): SessionSummary | null {
    return dialog?.kind === 'signOut' ? dialog.session : null;
  }

  protected unlink(provider: ProviderRow): void {
    this.open(this.waysIn() <= 1 ? { kind: 'lastWayIn', provider } : { kind: 'unlink', provider });
  }

  private password(): string | null {
    return this.proof()?.mode() === 'password' ? this.currentPassword() : null;
  }

  private signInProof(): SignInProof {
    if (this.twoFactorOn()) return { code: this.code().trim() };
    const password = this.password();
    return password ? { currentPassword: password } : {};
  }

  /** A real form submit, prevented, so password managers see the change and offer to save the new one. */
  protected async submitPassword(event: Event): Promise<void> {
    event.preventDefault();
    await this.security.setPassword(this.user.hasPassword() ? this.currentPassword() : null, this.newPassword());
  }

  protected async beginTwoFactor(event: Event): Promise<void> {
    event.preventDefault();
    await this.security.beginTwoFactor(this.password());
  }

  protected async confirmTwoFactor(event: Event): Promise<void> {
    event.preventDefault();
    await this.security.confirmTwoFactor(this.code().replace(/\s/g, ''));
    this.code.set('');
  }

  protected savedCodes(): void {
    this.security.finishTwoFactor();
  }

  protected async disableTwoFactor(event: Event): Promise<void> {
    event.preventDefault();
    await this.security.disableTwoFactor(this.code().trim(), this.password());
  }

  protected async link(event: Event, provider: ProviderRow): Promise<void> {
    event.preventDefault();
    await this.security.linkProvider(provider.key, this.signInProof());
  }

  protected async unlinkConfirmed(event: Event, provider: ProviderRow): Promise<void> {
    event.preventDefault();
    await this.security.unlinkProvider(provider.key, this.signInProof());
  }

  protected async signOut(session: SessionSummary): Promise<void> {
    if (await this.security.signOutSession(session.id)) {
      this.dialog.set(null);
      toast.success(t('settings.security.devices.signedOut', { name: this.deviceName(session) }));
    }
  }

  protected async copy(codes: string[]): Promise<void> {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success(t('settings.security.twoFactorDialog.copied'));
    } catch {
      toast.error(t('settings.security.twoFactorDialog.copyFailed'));
    }
  }

  protected deviceName(session: SessionSummary): string {
    return describeAgent(session.userAgent, {
      unknown: t('settings.security.devices.unknown'),
      app: t('settings.security.devices.app'),
      on: (browser, system) => t('settings.security.devices.on', { browser, system }),
    });
  }

  protected when(value: string): string {
    return formatModified(value);
  }
}
