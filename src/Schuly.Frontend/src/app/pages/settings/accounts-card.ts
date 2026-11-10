import { Component, effect, inject, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { LinkedAccountDto, LinkedAccountStatus, LinkingApi } from '../../core/linking-api';
import { failureMessage, isTerminal, linkErrorMessage } from '../../core/linking-step';
import { ApiAvatar } from '../../shared/api-avatar';
import { ProviderIcon } from '../../shared/provider-icon';
import { LinkedAccountsStore } from '../../stores/linked-accounts.store';
import { LinkDialog } from './link-dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';

const STATUS: Record<LinkedAccountStatus, { label: string; dot: string; tone: string }> = {
  ok: { label: 'settings.accounts.status.ok', dot: 'bg-green-500', tone: '' },
  syncing: { label: 'settings.accounts.status.syncing', dot: 'bg-muted-foreground', tone: '' },
  expired: { label: 'settings.accounts.status.expired', dot: 'bg-amber-500', tone: 'text-amber-700 dark:text-amber-300' },
  error: { label: 'settings.accounts.status.error', dot: 'bg-destructive', tone: 'text-destructive' },
};

/** Every linked school and service, grouped by provider, with add, re-authenticate and unlink. Nothing here knows a provider by name. */
@Component({
  selector: 'app-accounts-card',
  imports: [TranslatePipe, HlmAlertImports, HlmAlertDialogImports, HlmButton, HlmCardImports, HlmSpinner, NgIcon, LinkDialog, ProviderIcon, ApiAvatar],
  providers: [provideIcons({ lucidePlus })],
  template: `
    <section hlmCard aria-labelledby="accounts-title">
      <div hlmCardHeader class="flex items-start justify-between gap-3">
        <div class="grid gap-1">
          <h3 hlmCardTitle id="accounts-title">{{ 'settings.accounts.title' | translate }}</h3>
          <p hlmCardDescription>{{ 'settings.accounts.description' | translate }}</p>
        </div>
        <button hlmBtn variant="outline" type="button" class="shrink-0" [attr.aria-label]="'settings.accounts.addAria' | translate" (click)="dialog().openAdd()">
          <ng-icon name="lucidePlus" aria-hidden="true" />
          {{ 'settings.accounts.add' | translate }}
        </button>
      </div>
      <div hlmCardContent class="flex flex-col gap-5">
        @if (store.loadError(); as problem) {
          <div hlmAlert variant="destructive" role="alert">
            <p hlmAlertDescription class="!text-destructive">{{ problem }}</p>
          </div>
        }
        @if (store.actionError(); as problem) {
          <div hlmAlert variant="destructive" role="alert">
            <p hlmAlertDescription class="!text-destructive">{{ problem }}</p>
          </div>
        }

        @if (store.loading()) {
          <hlm-spinner [attr.aria-label]="'settings.accounts.loading' | translate" />
        } @else if (store.groups().length) {
          @for (group of store.groups(); track group.providerId) {
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2.5">
                <app-provider-icon [icon]="group.provider?.icon" />
                <div class="grid min-w-0">
                  <h4 class="text-sm font-semibold">{{ group.name }}</h4>
                  @if (group.provider?.description; as description) {
                    <p class="text-muted-foreground truncate text-xs">{{ description }}</p>
                  }
                </div>
              </div>
              <ul class="divide-y rounded-xl border" [attr.aria-label]="'settings.accounts.groupAria' | translate: { name: group.name }">
                @for (account of group.accounts; track account.id) {
                  @if (!account.id) {
                    <li class="flex flex-col gap-1 px-3.5 py-3 text-sm">
                      <span class="text-destructive font-medium">{{ 'settings.accounts.loadFailed' | translate }}</span>
                      <span class="text-muted-foreground text-xs">{{ account.message || ('settings.accounts.noAnswer' | translate) }}</span>
                    </li>
                  } @else {
                    <li class="flex flex-col gap-2 px-3.5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span class="flex min-w-0 items-center gap-3">
                        <app-api-avatar class="size-10" [src]="account.pictureUrl" [name]="account.title" />
                        <span class="flex min-w-0 flex-col">
                        <span class="truncate font-medium">{{ account.title }}</span>
                        <span class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
                          @if (account.detail) {
                            <span class="truncate">{{ account.detail }}</span>
                            <span aria-hidden="true">·</span>
                          }
                          <span class="inline-flex items-center gap-1.5" [class]="status(account).tone">
                            <span class="size-1.5 rounded-full" [class]="status(account).dot" aria-hidden="true"></span>
                            {{ status(account).label | translate }}
                          </span>
                        </span>
                        @if (account.message) {
                          <span class="text-muted-foreground mt-0.5 text-xs">{{ account.message }}</span>
                        }
                        </span>
                      </span>
                      <span class="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        @if (account.canReauth) {
                          @if (account.status === 'expired') {
                            <button hlmBtn size="sm" type="button" [disabled]="store.busy()" [attr.aria-label]="'settings.accounts.signInAgainAria' | translate: { name: account.title }" (click)="reauth(account)">{{ 'settings.accounts.signInAgain' | translate }}</button>
                          } @else {
                            <button hlmBtn variant="outline" size="sm" type="button" [disabled]="store.busy()" [attr.aria-label]="'settings.accounts.reauthAria' | translate: { name: account.title }" (click)="reauth(account)">{{ 'settings.accounts.reauth' | translate }}</button>
                          }
                        }
                        <hlm-alert-dialog>
                          <button hlmAlertDialogTrigger hlmBtn variant="outline" size="sm" type="button" [disabled]="store.busy()" [attr.aria-label]="'settings.accounts.unlinkAria' | translate: { name: account.title }">{{ 'settings.accounts.unlink' | translate }}</button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>{{ 'settings.accounts.unlinkTitle' | translate: { name: account.title } }}</h2>
                              <p hlmAlertDialogDescription>{{ 'settings.accounts.unlinkText' | translate }}</p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel>{{ 'common.cancel' | translate }}</button>
                              <button hlmAlertDialogAction variant="destructive" (click)="unlink(account)">{{ 'settings.accounts.unlink' | translate }}</button>
                            </hlm-alert-dialog-footer>
                          </hlm-alert-dialog-content>
                        </hlm-alert-dialog>
                      </span>
                    </li>
                  }
                }
              </ul>
            </div>
          }
        } @else if (!store.loadError()) {
          <p class="text-muted-foreground text-sm">{{ 'settings.accounts.none' | translate }}</p>
        }
      </div>
    </section>
    <app-link-dialog />
  `,
})
export class AccountsCard {
  protected readonly store = inject(LinkedAccountsStore);
  protected readonly dialog = viewChild.required(LinkDialog);
  private readonly api = inject(LinkingApi);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  constructor() {
    // A host-callback sign-in comes back to /settings?linkSession=<id>; the finished session stays readable for a minute.
    effect(() => {
      const id = this.query()?.get('linkSession');
      if (id) untracked(() => void this.finishCallback(id));
    });
  }

  private async finishCallback(id: string): Promise<void> {
    await this.router.navigate([], { queryParams: { linkSession: null }, queryParamsHandling: 'merge', replaceUrl: true });
    try {
      const session = await firstValueFrom(this.api.poll(id));
      const end = isTerminal(session);
      if (end === 'failed') toast.error(failureMessage(session));
      else if (end === 'done') toast.success(session.step.done?.title ? t('settings.accounts.linked', { name: session.step.done.title }) : t('settings.accounts.accountLinked'));
      await this.store.afterLink();
    } catch (error) {
      toast.error(linkErrorMessage(error, t('settings.accounts.finishFailed')));
      await this.store.afterLink();
    }
  }

  protected status(account: LinkedAccountDto) {
    return STATUS[account.status] ?? STATUS.error;
  }

  protected reauth(account: LinkedAccountDto): void {
    void this.dialog().openReauth(account);
  }

  protected async unlink(account: LinkedAccountDto): Promise<void> {
    if (await this.store.unlink(account)) toast.success(t('settings.accounts.unlinked', { name: account.title }));
  }
}
