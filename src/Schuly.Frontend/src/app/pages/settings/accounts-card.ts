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
import { ProviderIcon } from '../../shared/provider-icon';
import { LinkedAccountsStore } from '../../stores/linked-accounts.store';
import { LinkDialog } from './link-dialog';

const STATUS: Record<LinkedAccountStatus, { label: string; dot: string; tone: string }> = {
  ok: { label: 'Connected', dot: 'bg-green-500', tone: '' },
  syncing: { label: 'Syncing', dot: 'bg-muted-foreground', tone: '' },
  expired: { label: 'Sign-in expired', dot: 'bg-amber-500', tone: 'text-amber-700 dark:text-amber-300' },
  error: { label: 'Problem', dot: 'bg-destructive', tone: 'text-destructive' },
};

/** Every linked school and service, grouped by provider, with add, re-authenticate and unlink. Nothing here knows a provider by name. */
@Component({
  selector: 'app-accounts-card',
  imports: [HlmAlertImports, HlmAlertDialogImports, HlmButton, HlmCardImports, HlmSpinner, NgIcon, LinkDialog, ProviderIcon],
  providers: [provideIcons({ lucidePlus })],
  template: `
    <section hlmCard aria-labelledby="accounts-title">
      <div hlmCardHeader class="flex items-start justify-between gap-3">
        <div class="grid gap-1">
          <h3 hlmCardTitle id="accounts-title">Schools &amp; accounts</h3>
          <p hlmCardDescription>The schools and services Schuly syncs for you.</p>
        </div>
        <button hlmBtn variant="outline" type="button" class="shrink-0" aria-label="Add a school or account" (click)="dialog().openAdd()">
          <ng-icon name="lucidePlus" aria-hidden="true" />
          Add
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
          <hlm-spinner aria-label="Loading linked accounts" />
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
              <ul class="divide-y rounded-xl border" [attr.aria-label]="group.name + ' accounts'">
                @for (account of group.accounts; track account.id) {
                  @if (!account.id) {
                    <li class="flex flex-col gap-1 px-3.5 py-3 text-sm">
                      <span class="text-destructive font-medium">Could not load the accounts</span>
                      <span class="text-muted-foreground text-xs">{{ account.message || 'This service did not answer. Try again later.' }}</span>
                    </li>
                  } @else {
                    <li class="flex flex-col gap-2 px-3.5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span class="flex min-w-0 flex-col">
                        <span class="truncate font-medium">{{ account.title }}</span>
                        <span class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
                          @if (account.detail) {
                            <span class="truncate">{{ account.detail }}</span>
                            <span aria-hidden="true">·</span>
                          }
                          <span class="inline-flex items-center gap-1.5" [class]="status(account).tone">
                            <span class="size-1.5 rounded-full" [class]="status(account).dot" aria-hidden="true"></span>
                            {{ status(account).label }}
                          </span>
                        </span>
                        @if (account.message) {
                          <span class="text-muted-foreground mt-0.5 text-xs">{{ account.message }}</span>
                        }
                      </span>
                      <span class="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        @if (account.canReauth) {
                          @if (account.status === 'expired') {
                            <button hlmBtn size="sm" type="button" [disabled]="store.busy()" [attr.aria-label]="'Sign in again to ' + account.title" (click)="reauth(account)">Sign in again</button>
                          } @else {
                            <button hlmBtn variant="outline" size="sm" type="button" [disabled]="store.busy()" [attr.aria-label]="'Re-authenticate ' + account.title" (click)="reauth(account)">Re-authenticate</button>
                          }
                        }
                        <hlm-alert-dialog>
                          <button hlmAlertDialogTrigger hlmBtn variant="outline" size="sm" type="button" [disabled]="store.busy()" [attr.aria-label]="'Unlink ' + account.title">Unlink</button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>Unlink {{ account.title }}?</h2>
                              <p hlmAlertDialogDescription>Schuly stops reading it and deletes what it stored from it. You can add it again any time.</p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel>Cancel</button>
                              <button hlmAlertDialogAction variant="destructive" (click)="unlink(account)">Unlink</button>
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
          <p class="text-muted-foreground text-sm">No schools or accounts linked yet. Add one to start syncing.</p>
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
      else if (end === 'done') toast.success(session.step.done?.title ? `Linked ${session.step.done.title}` : 'Account linked');
      await this.store.afterLink();
    } catch (error) {
      toast.error(linkErrorMessage(error, 'Could not finish the sign-in.'));
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
    if (await this.store.unlink(account)) toast.success(`Unlinked ${account.title}`);
  }
}
