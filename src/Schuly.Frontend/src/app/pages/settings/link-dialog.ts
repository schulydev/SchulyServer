import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideChevronRight, lucideTriangleAlert } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { LinkProviderDto, LinkedAccountDto } from '../../core/linking-api';
import { stepTitle } from '../../core/linking-step';
import { LinkStepView, LinkSubmit } from '../../shared/link-step';
import { ProviderIcon } from '../../shared/provider-icon';
import { LinkSessionStore } from '../../stores/link-session.store';
import { LinkedAccountsStore } from '../../stores/linked-accounts.store';

type Mode = { kind: 'add' } | { kind: 'reauth'; account: LinkedAccountDto };

/**
 * Add an account or re-authenticate one: provider picker, optional flow picker, then the generic step renderer.
 * On success it closes, toasts, and the session store has already reloaded the accounts and everything derived from them.
 */
@Component({
  selector: 'app-link-dialog',
  imports: [NgIcon, HlmAlertImports, HlmButton, HlmDialogImports, HlmSpinner, LinkStepView, ProviderIcon],
  providers: [provideIcons({ lucideArrowLeft, lucideChevronRight, lucideTriangleAlert }), LinkSessionStore],
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="onClosed()">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ title() }}</h2>
          <p hlmDialogDescription [class.sr-only]="!description()">{{ description() || 'Link a school or service to Schuly.' }}</p>
        </hlm-dialog-header>

        @if (session.phase() === 'starting') {
          <p class="flex items-center gap-2 text-sm" role="status">
            <hlm-spinner aria-hidden="true" class="size-4" /> Starting the sign-in...
          </p>
        } @else if (session.phase() === 'failed') {
          <div class="flex flex-col gap-4">
            <div hlmAlert variant="destructive" role="alert">
              <ng-icon name="lucideTriangleAlert" hlmAlertIcon />
              <p hlmAlertDescription class="!text-destructive">{{ session.failure() }}</p>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button hlmBtn type="button" variant="ghost" class="text-muted-foreground -ml-3 mr-auto" (click)="back()">
                <ng-icon name="lucideArrowLeft" aria-hidden="true" />
                {{ mode().kind === 'add' ? 'Back' : 'Close' }}
              </button>
              <button hlmBtn type="button" data-autofocus (click)="session.restart()">Try again</button>
            </div>
          </div>
        } @else if (session.step(); as step) {
          <app-link-step
            [step]="step"
            [heading]="false"
            [backLabel]="mode().kind === 'reauth' && !session.nested() ? 'Cancel' : 'Back'"
            [busy]="session.busy()"
            [error]="session.error()"
            (submitted)="onSubmit($event)"
            (poll)="session.poll()"
            (linkProvider)="session.startNested($event)"
            (restart)="session.restart()"
            (back)="back()"
          />
        } @else if (pendingProvider(); as provider) {
          <form class="flex flex-col gap-4" (submit)="startPending($event)">
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-2 text-sm font-medium">How do you want to sign in to {{ provider.displayName }}?</legend>
              @for (flow of provider.flows; track flow.id) {
                <label class="hover:bg-muted/50 has-[:checked]:border-primary flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
                  <input type="radio" class="accent-primary mt-1 size-4" name="flow" [value]="flow.id" [checked]="pendingFlow() === flow.id" [attr.data-autofocus]="$first ? '' : null" (change)="pendingFlow.set(flow.id)" />
                  <span class="flex flex-col">
                    <span class="text-sm font-medium">{{ flow.label }}</span>
                    @if (flow.description) {
                      <span class="text-muted-foreground text-sm">{{ flow.description }}</span>
                    }
                  </span>
                </label>
              }
            </fieldset>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button hlmBtn type="button" variant="ghost" class="text-muted-foreground -ml-3 mr-auto" (click)="pendingProvider.set(null)">
                <ng-icon name="lucideArrowLeft" aria-hidden="true" /> Back
              </button>
              <button hlmBtn type="submit">Continue</button>
            </div>
          </form>
        } @else {
          @if (accounts.providersError(); as problem) {
            <div hlmAlert variant="destructive" role="alert">
              <ng-icon name="lucideTriangleAlert" hlmAlertIcon />
              <p hlmAlertDescription class="!text-destructive">{{ problem }}</p>
            </div>
            <button hlmBtn type="button" variant="outline" (click)="accounts.loadProviders()">Retry</button>
          } @else if (!accounts.linkableProviders().length) {
            <p class="text-muted-foreground text-sm" role="status">No schools or services can be linked from the web right now.</p>
          } @else {
            <ul class="flex flex-col gap-2">
              @for (provider of accounts.linkableProviders(); track provider.id) {
                <li>
                  <button
                    type="button"
                    class="hover:bg-muted/50 focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none focus-visible:ring-[3px]"
                    [attr.data-autofocus]="$first ? '' : null"
                    (click)="pick(provider)"
                  >
                    <app-provider-icon [icon]="provider.icon" />
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="text-sm font-medium">{{ provider.displayName }}</span>
                      @if (provider.description) {
                        <span class="text-muted-foreground text-sm">{{ provider.description }}</span>
                      }
                    </span>
                    <ng-icon name="lucideChevronRight" aria-hidden="true" class="text-muted-foreground shrink-0" />
                  </button>
                </li>
              }
            </ul>
          }
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class LinkDialog {
  protected readonly session = inject(LinkSessionStore);
  protected readonly accounts = inject(LinkedAccountsStore);

  protected readonly open = signal(false);
  protected readonly mode = signal<Mode>({ kind: 'add' });
  protected readonly pendingProvider = signal<LinkProviderDto | null>(null);
  protected readonly pendingFlow = signal('');

  /** The current step's title, else the dialog's own. */
  protected readonly title = computed(() => {
    const step = this.session.phase() === 'failed' ? null : this.session.step();
    if (step) return stepTitle(step);
    if (this.session.phase() === 'failed') return 'The sign-in did not complete';
    const provider = this.pendingProvider();
    if (provider) return `Sign in to ${provider.displayName}`;
    const mode = this.mode();
    return mode.kind === 'reauth' ? `Re-authenticate ${mode.account.title}` : 'Add an account';
  });

  protected readonly description = computed(() => {
    const step = this.session.phase() === 'failed' ? null : this.session.step();
    if (step) return step.description ?? '';
    if (this.session.phase() !== 'idle' || this.pendingProvider()) return '';
    return this.mode().kind === 'add' ? 'What should Schuly connect to?' : '';
  });

  constructor() {
    effect(() => {
      if (this.session.phase() !== 'finished') return;
      untracked(() => {
        const title = this.session.step()?.done?.title ?? this.session.linkedTitle();
        const reauth = this.mode().kind === 'reauth';
        this.open.set(false);
        this.session.cancel();
        toast.success(title ? `${reauth ? 'Signed in again to' : 'Linked'} ${title}` : reauth ? 'Signed in again' : 'Account linked');
      });
    });
  }

  openAdd(): void {
    this.mode.set({ kind: 'add' });
    this.reset();
    void this.accounts.loadProviders();
    this.open.set(true);
  }

  async openReauth(account: LinkedAccountDto): Promise<void> {
    this.mode.set({ kind: 'reauth', account });
    this.reset();
    this.open.set(true);
    await this.session.begin(account.providerId, null, account.id);
  }

  private reset(): void {
    this.pendingProvider.set(null);
    this.session.cancel();
  }

  protected pick(provider: LinkProviderDto): void {
    if (provider.flows.length > 1) {
      this.pendingFlow.set(provider.flows[0].id);
      this.pendingProvider.set(provider);
    } else void this.session.begin(provider.id, provider.flows[0]?.id ?? null);
  }

  protected startPending(event: Event): void {
    event.preventDefault();
    const provider = this.pendingProvider();
    if (!provider) return;
    this.pendingProvider.set(null);
    void this.session.begin(provider.id, this.pendingFlow() || null);
  }

  protected onSubmit(event: LinkSubmit): void {
    void this.session.submit(event.values, event.action);
  }

  /** Back out of a nested flow, return to the picker, or close when re-authenticating. */
  protected back(): void {
    if (this.session.nested()) return this.session.cancel();
    this.session.cancel();
    if (this.mode().kind === 'reauth') this.open.set(false);
  }

  protected onClosed(): void {
    this.open.set(false);
    this.session.cancel();
    this.pendingProvider.set(null);
  }
}
