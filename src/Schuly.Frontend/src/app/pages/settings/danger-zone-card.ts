import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucideTriangleAlert } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { t } from '../../core/i18n';
import { UsernameHint } from '../../shared/password-field';
import { SecurityStore } from '../../stores/security.store';
import { UserStore } from '../../stores/user.store';
import { Proof } from './proof';

type Dialog = 'email' | 'export' | 'delete';

/** Changes to the account itself: its email, a copy of its data, and deleting it. */
@Component({
  selector: 'app-danger-zone-card',
  imports: [NgIcon, TranslatePipe, HlmAlertImports, HlmButton, HlmCardImports, HlmDialogImports, HlmFieldImports, HlmInput, HlmSpinner, UsernameHint, Proof],
  providers: [provideIcons({ lucideDownload, lucideTriangleAlert })],
  template: `
    <section hlmCard class="border-destructive/40" aria-labelledby="danger-title">
      <div hlmCardHeader>
        <h3 hlmCardTitle id="danger-title" class="text-destructive">{{ 'settings.danger.title' | translate }}</h3>
        <p hlmCardDescription>{{ 'settings.danger.description' | translate }}</p>
      </div>
      <div hlmCardContent>
        <ul class="divide-y">
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">{{ 'settings.danger.email.label' | translate }}</span>
              <span class="text-muted-foreground text-sm">{{ 'settings.danger.email.text' | translate }}</span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" [attr.aria-label]="'settings.danger.email.label' | translate" (click)="open('email')">{{ 'settings.danger.email.change' | translate }}</button>
          </li>
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">{{ 'settings.danger.export.label' | translate }}</span>
              <span class="text-muted-foreground text-sm">{{ 'settings.danger.export.text' | translate }}</span>
            </div>
            <button hlmBtn variant="outline" type="button" class="shrink-0" [attr.aria-label]="'settings.danger.export.label' | translate" (click)="open('export')">{{ 'settings.danger.export.button' | translate }}</button>
          </li>
          <li class="flex items-center justify-between gap-4 py-3.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm font-medium">{{ 'settings.delete.title' | translate }}</span>
              <span class="text-muted-foreground text-sm">{{ 'settings.danger.delete.text' | translate }}</span>
            </div>
            <button hlmBtn variant="destructive" type="button" class="shrink-0" [attr.aria-label]="'settings.delete.title' | translate" (click)="open('delete')">{{ 'common.delete' | translate }}</button>
          </li>
        </ul>
      </div>
    </section>

    <hlm-dialog [state]="dialog() ? 'open' : 'closed'" (closed)="close()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        @switch (dialog()) {
          @case ('email') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ 'settings.danger.email.label' | translate }}</h2>
              <p hlmDialogDescription>{{ 'settings.danger.email.description' | translate }}</p>
            </hlm-dialog-header>
            @if (!user.hasPassword()) {
              <div hlmAlert>
                <h3 hlmAlertTitle>{{ 'settings.danger.email.passwordFirst' | translate }}</h3>
                <p hlmAlertDescription>{{ 'settings.danger.email.passwordFirstText' | translate }}</p>
              </div>
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" data-autofocus (click)="close()">{{ 'common.close' | translate }}</button>
              </hlm-dialog-footer>
            } @else if (sentTo()) {
              <div hlmAlert role="status">
                <h3 hlmAlertTitle>{{ 'settings.danger.email.checkInbox' | translate }}</h3>
                <p hlmAlertDescription>{{ 'settings.danger.email.sentTo' | translate: { email: sentTo() } }}</p>
              </div>
              <hlm-dialog-footer>
                <button hlmBtn type="button" data-autofocus (click)="close()">{{ 'common.done' | translate }}</button>
              </hlm-dialog-footer>
            } @else {
              <form class="flex flex-col gap-4" (submit)="changeEmail($event)">
                <app-username-hint [username]="user.email()" />
                <div hlmField>
                  <label hlmFieldLabel for="new-email">{{ 'settings.danger.email.newEmail' | translate }}</label>
                  <input hlmInput id="new-email" name="email" type="email" autocomplete="email" placeholder="name@example.ch" data-autofocus [value]="newEmail()" (input)="newEmail.set($any($event.target).value)" />
                </div>
                <app-proof #proof [reason]="'settings.proof.reason.email' | translate" resume="email" [(password)]="password" />
                @if (error()) {
                  <p class="text-destructive text-sm" role="alert">{{ error() }}</p>
                }
                <hlm-dialog-footer>
                  <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                  <button hlmBtn type="submit" [disabled]="busy() || !proof.ready() || !validEmail()">{{ 'settings.danger.email.submit' | translate }}</button>
                </hlm-dialog-footer>
              </form>
            }
          }
          @case ('export') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ 'settings.danger.export.label' | translate }}</h2>
              <p hlmDialogDescription>{{ 'settings.data.description' | translate }}</p>
            </hlm-dialog-header>
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
              <button hlmBtn type="button" data-autofocus [disabled]="user.busy()" (click)="user.exportData()">
                @if (user.busy()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  <ng-icon name="lucideDownload" aria-hidden="true" />
                }
                {{ 'settings.data.export' | translate }}
              </button>
            </hlm-dialog-footer>
          }
          @case ('delete') {
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ 'settings.delete.confirmTitle' | translate }}</h2>
              <p hlmDialogDescription>{{ 'settings.danger.delete.description' | translate }}</p>
            </hlm-dialog-header>
            <form class="flex flex-col gap-4" (submit)="deleteAccount($event)">
              <app-username-hint [username]="user.email()" />
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideTriangleAlert" hlmAlertIcon aria-hidden="true" />
                <h3 hlmAlertTitle>{{ 'settings.danger.delete.alertTitle' | translate }}</h3>
                <p hlmAlertDescription>{{ 'settings.danger.delete.alertText' | translate }}</p>
              </div>
              <app-proof #proof [reason]="'settings.proof.reason.delete' | translate" resume="delete" [(password)]="password" />
              @if (proof.mode() !== 'reauth') {
                <div hlmField>
                  <label hlmFieldLabel for="delete-confirm">{{ 'settings.danger.delete.typeConfirm' | translate: { word: confirmWord() } }}</label>
                  <input hlmInput id="delete-confirm" name="delete-confirm" autocapitalize="characters" spellcheck="false" [attr.data-autofocus]="proof.mode() === 'none' ? '' : null" [value]="confirmText()" (input)="confirmText.set($any($event.target).value)" />
                </div>
              }
              @if (user.deleteError(); as problem) {
                <p class="text-destructive text-sm" role="alert">{{ problem }}</p>
              }
              <hlm-dialog-footer>
                <button hlmBtn variant="outline" type="button" (click)="close()">{{ 'common.cancel' | translate }}</button>
                <button hlmBtn variant="destructive" type="submit" [disabled]="user.busy() || !proof.ready() || confirmText().trim().toUpperCase() !== confirmWord()">{{ 'settings.delete.title' | translate }}</button>
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
  /** The word to type, in the page's language ("DELETE", "LÖSCHEN", ...). */
  protected readonly confirmWord = computed(() => t('settings.danger.delete.word').toUpperCase());
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
