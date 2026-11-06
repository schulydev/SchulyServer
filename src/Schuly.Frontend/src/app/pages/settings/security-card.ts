import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideKeyRound, lucidePlus } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { SessionSummary, SignInProof } from '../../core/auth-api';
import { formatModified } from '../../core/date-format';
import { describeAgent } from '../../core/signed-in-at';
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
  imports: [NgIcon, HlmAlertImports, HlmButton, HlmCardImports, HlmDialogImports, HlmFieldImports, HlmInput, Proof],
  providers: [provideIcons({ lucideArrowLeft, lucideKeyRound, lucidePlus })],
  template: `
    <section hlmCard aria-labelledby="security-title">
      <div hlmCardHeader>
        <h3 hlmCardTitle id="security-title">Security</h3>
        <p hlmCardDescription>How you sign in to Schuly, and where you're signed in.</p>
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
              <span class="text-sm font-medium">Password</span>
              <span class="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                <span class="size-1.5 shrink-0 rounded-full" [class]="user.hasPassword() ? 'bg-green-500' : 'bg-muted-foreground'" aria-hidden="true"></span>
                {{ user.hasPassword() ? 'Set' : 'Not set · you sign in with a provider' }}
              </span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" (click)="open({ kind: 'password' })">
              {{ user.hasPassword() ? 'Change' : 'Add password' }}
            </button>
          </li>
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">Two-factor authentication</span>
              <span class="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                <span class="size-1.5 shrink-0 rounded-full" [class]="twoFactorOn() ? 'bg-green-500' : 'bg-muted-foreground'" aria-hidden="true"></span>
                @if (twoFactorOn()) {
                  On · {{ security.twoFactor()?.recoveryCodesRemaining ?? 0 }} recovery codes left
                } @else {
                  Off · a code from your phone at each new sign-in
                }
              </span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" (click)="open({ kind: twoFactorOn() ? 'twoFactorOff' : 'twoFactor' })">
              {{ twoFactorOn() ? 'Turn off' : 'Set up' }}
            </button>
          </li>
        </ul>

        @if (security.providers().length || security.linked().length) {
          <div class="mt-2 flex items-center justify-between gap-3 border-t pt-4 pb-1">
            <h4 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Sign-in providers</h4>
            @if (security.unlinkedRows().length) {
              <button hlmBtn variant="outline" size="sm" type="button" aria-label="Link a sign-in provider" (click)="open({ kind: 'linkPick' })">
                <ng-icon name="lucidePlus" aria-hidden="true" />
                Link
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
                  <button hlmBtn variant="outline" type="button" class="shrink-0" [attr.aria-label]="'Unlink ' + provider.name" (click)="unlink(provider)">Unlink</button>
                </li>
              }
            </ul>
          } @else {
            <p class="text-muted-foreground py-3 text-sm">No provider linked. Link one to sign in without your password.</p>
          }
        }

        @if (security.sessions().length) {
          <h4 class="text-muted-foreground mt-2 border-t pt-4 pb-1 text-xs font-semibold tracking-wide uppercase">Devices</h4>
          <ul class="divide-y">
            @for (session of security.sessions(); track session.id) {
              <li class="flex items-center justify-between gap-4 py-3">
                <span class="grid min-w-0 gap-0.5">
                  <span class="truncate text-sm font-medium">{{ deviceName(session) }}</span>
                  <span class="text-muted-foreground text-xs">Last active: {{ when(session.lastUsedAt) }}</span>
                </span>
                @if (session.isCurrent) {
                  <span class="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-sm">
                    <span class="size-1.5 rounded-full bg-green-500" aria-hidden="true"></span>
                    This device
                  </span>
                } @else {
                  <button hlmBtn variant="outline" type="button" class="shrink-0" [attr.aria-label]="'Sign out ' + deviceName(session)" (click)="open({ kind: 'signOut', session })">Sign out</button>
                }
              </li>
            }
          </ul>
        }
        @if (security.devices().length) {
          <div class="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span class="text-muted-foreground text-xs">{{ security.devices().length }} {{ security.devices().length === 1 ? 'device skips' : 'devices skip' }} the two-factor code.</span>
            <button hlmBtn variant="ghost" size="sm" type="button" [disabled]="security.busy()" (click)="security.forgetDevices()">Forget remembered devices</button>
          </div>
        }
      </div>
    </section>

    <hlm-dialog [state]="dialog() ? 'open' : 'closed'" (closed)="close()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        @switch (dialog()?.kind) {
          @case ('password') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ user.hasPassword() ? 'Change password' : 'Add a password' }}</h2>
              <p hlmDialogDescription>
                {{ user.hasPassword() ? 'Then sign in again with the new one, here and on your other devices.' : 'Then you can also sign in with your email and this password.' }}
              </p>
            </hlm-dialog-header>
            <form class="flex flex-col gap-4" (submit)="submitPassword($event)">
              <app-proof #proof what="add a password" resume="password" [(password)]="currentPassword" />
              @if (proof.mode() !== 'reauth') {
                <div hlmField>
                  <label hlmFieldLabel for="new-password">New password</label>
                  <input hlmInput id="new-password" type="password" autocomplete="new-password" [attr.data-autofocus]="proof.mode() === 'none' ? '' : null" [value]="newPassword()" (input)="newPassword.set($any($event.target).value)" />
                  <p hlmFieldDescription>At least {{ minPassword }} characters. A sentence you'll remember works well.</p>
                </div>
              }
              @if (security.error()) {
                <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                <button hlmBtn type="submit" [disabled]="security.busy() || !proof.ready() || newPassword().length < minPassword">
                  {{ user.hasPassword() ? 'Change password' : 'Add password' }}
                </button>
              </hlm-dialog-footer>
            </form>
          }
          @case ('twoFactor') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>Set up two-factor authentication</h2>
              <p hlmDialogDescription>Step {{ twoFactorStep() }} of 3 · {{ stepLabel() }}</p>
            </hlm-dialog-header>
            <div class="flex gap-1.5" aria-hidden="true">
              @for (n of [1, 2, 3]; track n) {
                <span class="h-1 flex-1 rounded-full" [class]="n <= twoFactorStep() ? 'bg-primary' : 'bg-border'"></span>
              }
            </div>
            @if (security.recoveryCodes(); as codes) {
              <div hlmAlert>
                <h3 hlmAlertTitle>Save your recovery codes</h3>
                <p hlmAlertDescription>Each one signs you in once if you lose your phone. Keep them somewhere safe, not only on this device. They're only shown now.</p>
              </div>
              <ul class="bg-muted grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg p-3 font-mono text-sm" aria-label="Recovery codes">
                @for (code of codes; track code) {
                  <li>{{ code }}</li>
                }
              </ul>
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="copy(codes)">Copy codes</button>
                <button hlmBtn type="button" data-autofocus (click)="savedCodes()">I saved them</button>
              </hlm-dialog-footer>
            } @else if (security.setup(); as setup) {
              <form class="flex flex-col gap-4" (submit)="confirmTwoFactor($event)">
                <p class="text-muted-foreground text-sm">Scan this with your authenticator app, then type the 6-digit code it shows.</p>
                <img [src]="setup.qr" alt="QR code for your authenticator app" class="size-40 self-center rounded-lg border bg-white p-1" />
                <p class="text-muted-foreground text-center text-xs break-all">Can't scan? Enter <span class="font-mono">{{ setup.secret }}</span></p>
                <div hlmField>
                  <label hlmFieldLabel for="setup-code">Code from the app</label>
                  <input hlmInput id="setup-code" class="font-mono" inputmode="numeric" autocomplete="one-time-code" maxlength="7" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
                </div>
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="ghost" type="button" class="sm:mr-auto" (click)="security.cancelSetup()">
                    <ng-icon name="lucideArrowLeft" aria-hidden="true" /> Back
                  </button>
                  <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                  <button hlmBtn type="submit" [disabled]="security.busy() || code().replace(' ', '').length < 6">Verify</button>
                </hlm-dialog-footer>
              </form>
            } @else {
              <form class="flex flex-col gap-4" (submit)="beginTwoFactor($event)">
                <app-proof #proof what="turn on two-factor authentication" resume="twoFactor" [(password)]="currentPassword" />
                @if (proof.mode() !== 'reauth') {
                  <div hlmAlert>
                    <ng-icon name="lucideKeyRound" hlmAlertIcon aria-hidden="true" />
                    <h3 hlmAlertTitle>You'll need an authenticator app</h3>
                    <p hlmAlertDescription>Microsoft Authenticator, Google Authenticator or your password manager.</p>
                  </div>
                }
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                  <button hlmBtn type="submit" [attr.data-autofocus]="proof.mode() === 'none' ? '' : null" [disabled]="security.busy() || !proof.ready()">Continue</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('twoFactorOff') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>Turn off two-factor authentication</h2>
              <p hlmDialogDescription>Signing in then needs only your password or provider.</p>
            </hlm-dialog-header>
            <form class="flex flex-col gap-4" (submit)="disableTwoFactor($event)">
              <div hlmField>
                <label hlmFieldLabel for="off-code">Code from your app or a recovery code</label>
                <input hlmInput id="off-code" class="font-mono" autocomplete="one-time-code" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
              </div>
              <app-proof #proof inputId="off-password" what="turn off two-factor authentication" resume="twoFactorOff" [(password)]="currentPassword" />
              @if (security.error()) {
                <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                <button hlmBtn variant="destructive" type="submit" [disabled]="security.busy() || !proof.ready() || !code().trim()">Turn off</button>
              </hlm-dialog-footer>
            </form>
          }
          @case ('linkPick') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>Link a provider</h2>
              <p hlmDialogDescription>Pick one to sign in with, as well as the ones you have.</p>
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
                  <button hlmBtn type="button" class="shrink-0" [attr.data-autofocus]="$first ? '' : null" [attr.aria-label]="'Link ' + provider.name" (click)="open({ kind: 'link', provider })">Link</button>
                </li>
              }
            </ul>
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
            </hlm-dialog-footer>
          }
          @case ('link') {
            @if (providerOf(dialog()); as provider) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>Link {{ provider.name }}</h2>
                <p hlmDialogDescription>Then you can sign in with {{ provider.name }} too.</p>
              </hlm-dialog-header>
              <form class="flex flex-col gap-4" (submit)="link($event, provider)">
                @if (twoFactorOn()) {
                  <div hlmField>
                    <label hlmFieldLabel for="link-code">Code from your app</label>
                    <input hlmInput id="link-code" class="font-mono" autocomplete="one-time-code" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
                  </div>
                } @else {
                  <app-proof #proof [what]="'link ' + provider.name" [resume]="'link:' + provider.key" [(password)]="currentPassword" />
                }
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                  <button hlmBtn type="submit" [disabled]="security.busy() || !proofReady()">Continue to {{ provider.name }}</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('unlink') {
            @if (providerOf(dialog()); as provider) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>Unlink {{ provider.name }}?</h2>
                <p hlmDialogDescription>You won't be able to sign in with {{ provider.name }} any more, and you'll be signed out everywhere, here too.</p>
              </hlm-dialog-header>
              <form class="flex flex-col gap-4" (submit)="unlinkConfirmed($event, provider)">
                @if (twoFactorOn()) {
                  <div hlmField>
                    <label hlmFieldLabel for="unlink-code">Code from your app</label>
                    <input hlmInput id="unlink-code" class="font-mono" autocomplete="one-time-code" data-autofocus [value]="code()" (input)="code.set($any($event.target).value)" />
                  </div>
                } @else {
                  <app-proof #proof [what]="'unlink ' + provider.name" [resume]="'unlink:' + provider.key" [(password)]="currentPassword" />
                }
                @if (security.error()) {
                  <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                  <button hlmBtn variant="destructive" type="submit" [disabled]="security.busy() || !proofReady()">Unlink</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('lastWayIn') {
            @if (providerOf(dialog()); as provider) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>You can't unlink {{ provider.name }} yet</h2>
                <p hlmDialogDescription class="sr-only">It is your only way to sign in.</p>
              </hlm-dialog-header>
              <div hlmAlert variant="destructive">
                <h3 hlmAlertTitle>It's your only way to sign in</h3>
                <p hlmAlertDescription>Add a password or link another provider first, otherwise you'd lock yourself out.</p>
              </div>
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">Close</button>
                <button hlmBtn type="button" data-autofocus (click)="open({ kind: 'password' })">Add a password</button>
              </hlm-dialog-footer>
            }
          }
          @case ('signOut') {
            @if (sessionOf(dialog()); as session) {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>Sign out {{ deviceName(session) }}?</h2>
                <p hlmDialogDescription>It has to sign in again to use Schuly.</p>
              </hlm-dialog-header>
              @if (security.error()) {
                <p class="text-destructive text-sm" role="alert">{{ security.error() }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                <button hlmBtn variant="destructive" type="button" data-autofocus [disabled]="security.busy()" (click)="signOut(session)">Sign out</button>
              </hlm-dialog-footer>
            }
          }
          @case ('signInAgain') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ security.signInAgain() }}</h2>
              <p hlmDialogDescription>For your safety, changing how you sign in ends every session, including this one.</p>
            </hlm-dialog-header>
            <hlm-dialog-footer>
              <button hlmBtn type="button" data-autofocus (click)="security.continueToSignIn()">Sign in again</button>
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
  protected readonly stepLabel = computed(() => ["confirm it's you", 'connect your app', 'recovery codes'][this.twoFactorStep() - 1]);
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
      toast.success(`Signed out ${this.deviceName(session)}`);
    }
  }

  protected async copy(codes: string[]): Promise<void> {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Could not copy. Select the codes and copy them yourself.');
    }
  }

  protected deviceName(session: SessionSummary): string {
    return describeAgent(session.userAgent);
  }

  protected when(value: string): string {
    return formatModified(value);
  }
}
