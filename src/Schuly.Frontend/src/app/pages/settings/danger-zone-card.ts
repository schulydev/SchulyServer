import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { SecurityStore } from '../../stores/security.store';
import { UserStore } from '../../stores/user.store';
import { Proof } from './proof';

type Dialog = 'email' | 'export' | 'delete';

/** Changes to the account itself: its email, a copy of its data, and deleting it. */
@Component({
  selector: 'app-danger-zone-card',
  imports: [NgIcon, HlmAlertImports, HlmButton, HlmCardImports, HlmDialogImports, HlmFieldImports, HlmInput, HlmSpinner, Proof],
  providers: [provideIcons({ lucideDownload, lucideTriangleAlert })],
  template: `
    <section hlmCard class="border-destructive/40" aria-labelledby="danger-title">
      <div hlmCardHeader>
        <h3 hlmCardTitle id="danger-title" class="text-destructive">Danger zone</h3>
        <p hlmCardDescription>Changes to the account itself.</p>
      </div>
      <div hlmCardContent>
        <ul class="divide-y">
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">Change email</span>
              <span class="text-muted-foreground text-sm">Where Schuly sends codes and notices.</span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" aria-label="Change email" (click)="open('email')">Change</button>
          </li>
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">Export your data</span>
              <span class="text-muted-foreground text-sm">A file with your profile, linked accounts and synced school data.</span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" aria-label="Export your data" (click)="open('export')">Export</button>
          </li>
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">Delete account</span>
              <span class="text-muted-foreground text-sm">Removes your account and everything Schuly stored. This can't be undone.</span>
            </div>
            <button hlmBtn variant="destructive" type="button" class="shrink-0" aria-label="Delete account" (click)="open('delete')">Delete</button>
          </li>
        </ul>
      </div>
    </section>

    <hlm-dialog [state]="dialog() ? 'open' : 'closed'" (closed)="close()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        @switch (dialog()) {
          @case ('email') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>Change email</h2>
              <p hlmDialogDescription>We send a link to the new address; your email changes once you open it.</p>
            </hlm-dialog-header>
            @if (!user.hasPassword()) {
              <div hlmAlert>
                <h3 hlmAlertTitle>Add a password first</h3>
                <p hlmAlertDescription>Your email here belongs to the provider you sign in with. Add a password in Security, then you can choose your own.</p>
              </div>
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" data-autofocus (click)="close()">Close</button>
              </hlm-dialog-footer>
            } @else if (sentTo()) {
              <div hlmAlert role="status">
                <h3 hlmAlertTitle>Check your inbox</h3>
                <p hlmAlertDescription>We sent a link to {{ sentTo() }}. Open it to finish the change.</p>
              </div>
              <hlm-dialog-footer>
                <button hlmBtn type="button" data-autofocus (click)="close()">Done</button>
              </hlm-dialog-footer>
            } @else {
              <form class="flex flex-col gap-4" (submit)="changeEmail($event)">
                <div hlmField>
                  <label hlmFieldLabel for="new-email">New email</label>
                  <input hlmInput id="new-email" type="email" autocomplete="email" placeholder="name@example.ch" data-autofocus [value]="newEmail()" (input)="newEmail.set($any($event.target).value)" />
                </div>
                <app-proof #proof inputId="email-password" what="change your email" resume="email" [(password)]="password" />
                @if (error()) {
                  <p class="text-destructive text-sm" role="alert">{{ error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                  <button hlmBtn type="submit" [disabled]="busy() || !proof.ready() || !validEmail()">Send link</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('export') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>Export your data</h2>
              <p hlmDialogDescription>Download your account, school data, Helply chats, connected apps and devices as a JSON file. Document files stay in Documents, and the file lists anything else it leaves out.</p>
            </hlm-dialog-header>
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
              <button hlmBtn type="button" data-autofocus [disabled]="user.busy()" (click)="user.exportData()">
                @if (user.busy()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  <ng-icon name="lucideDownload" aria-hidden="true" />
                }
                Export data
              </button>
            </hlm-dialog-footer>
          }
          @case ('delete') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>Delete your account?</h2>
              <p hlmDialogDescription>Your profile, linked accounts and all synced school data are deleted. Your school accounts themselves stay untouched.</p>
            </hlm-dialog-header>
            <form class="flex flex-col gap-4" (submit)="deleteAccount($event)">
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideTriangleAlert" hlmAlertIcon aria-hidden="true" />
                <h3 hlmAlertTitle>This can't be undone</h3>
                <p hlmAlertDescription>Export your data first if you want to keep it.</p>
              </div>
              <app-proof #proof inputId="delete-password" what="delete your account" resume="delete" [(password)]="password" />
              @if (proof.mode() !== 'reauth') {
                <div hlmField>
                  <label hlmFieldLabel for="delete-confirm">Type DELETE to confirm</label>
                  <input hlmInput id="delete-confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" [attr.data-autofocus]="proof.mode() === 'none' ? '' : null" [value]="confirmText()" (input)="confirmText.set($any($event.target).value)" />
                </div>
              }
              @if (user.deleteError(); as problem) {
                <p class="text-destructive text-sm" role="alert">{{ problem }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">Cancel</button>
                <button hlmBtn variant="destructive" type="submit" [disabled]="user.busy() || !proof.ready() || confirmText().trim() !== 'DELETE'">Delete account</button>
              </hlm-dialog-footer>
            </form>
          }
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class DangerZoneCard {
  protected readonly user = inject(UserStore);
  private readonly security = inject(SecurityStore);
  /** A settings action to reopen after signing in again. */
  readonly resume = input<string | null>(null);

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly password = signal('');
  protected readonly newEmail = signal('');
  protected readonly confirmText = signal('');
  protected readonly sentTo = signal<string | null>(null);
  protected readonly busy = computed(() => this.security.busy());
  protected readonly error = signal<string | null>(null);
  private readonly proof = viewChild<Proof>('proof');
  private resumed = false;

  constructor() {
    effect(() => {
      const resume = this.resume();
      if (this.resumed || !this.user.user() || !resume) return;
      this.resumed = true;
      untracked(() => {
        if (resume === 'email' || resume === 'delete') this.open(resume);
      });
    });
  }

  protected open(dialog: Dialog): void {
    this.password.set('');
    this.newEmail.set('');
    this.confirmText.set('');
    this.sentTo.set(null);
    this.error.set(null);
    this.dialog.set(dialog);
  }

  protected close(): void {
    this.dialog.set(null);
  }

  protected validEmail(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.newEmail().trim());
  }

  private passwordOrNull(): string | null {
    return this.proof()?.mode() === 'password' ? this.password() : null;
  }

  protected async changeEmail(event: Event): Promise<void> {
    event.preventDefault();
    const email = this.newEmail().trim();
    if (await this.security.requestEmailChange(email, this.password())) this.sentTo.set(email);
    else this.error.set(this.security.error());
  }

  protected deleteAccount(event: Event): void {
    event.preventDefault();
    this.user.deleteAccount(this.passwordOrNull() ?? '');
  }
}
