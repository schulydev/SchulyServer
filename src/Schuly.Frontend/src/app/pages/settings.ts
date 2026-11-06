import { LanguageSelect } from '../shared/language-select';
import { TranslatePipe } from '@ngx-translate/core';
import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideMonitor,
  lucideMoon,
  lucideSun,
  lucideTrash2,
} from '@ng-icons/lucide';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { Theme, ThemeStore } from '../stores/theme.store';
import { AccountCard } from './settings/account-card';
import { SecurityCard } from './settings/security-card';
import { AccountsCard } from './settings/accounts-card';
import { UserStore } from '../stores/user.store';

@Component({
  selector: 'app-settings',
  imports: [
    LanguageSelect,TranslatePipe, 
    AccountCard,
    SecurityCard,
    AccountsCard,
    HlmCardImports,
    HlmButton,
    HlmInput,
    HlmToggleGroupImports,
    HlmAlertDialogImports,
    HlmSpinner,
    NgIcon,
  ],
  providers: [provideIcons({ lucideSun, lucideMoon, lucideMonitor, lucideDownload, lucideTrash2 })],
  template: `
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 lg:p-6">
      <app-account-card />
      <app-security-card />
      <app-accounts-card />

      <section hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle>{{ 'settings.appearance.title' | translate }}</h3>
          <p hlmCardDescription>{{ 'settings.appearance.description' | translate }}</p>
        </div>
        <div hlmCardContent>
          <hlm-toggle-group
            type="single"
            variant="outline"
            [nullable]="false"
            [value]="theme.theme()"
            (valueChange)="setTheme($event)"
            [attr.aria-label]="'settings.appearance.theme' | translate"
          >
            <button hlmToggleGroupItem value="light" class="gap-2 px-3">
              <ng-icon name="lucideSun" /> {{ 'settings.appearance.light' | translate }}
            </button>
            <button hlmToggleGroupItem value="dark" class="gap-2 px-3">
              <ng-icon name="lucideMoon" /> {{ 'settings.appearance.dark' | translate }}
            </button>
            <button hlmToggleGroupItem value="system" class="gap-2 px-3">
              <ng-icon name="lucideMonitor" /> {{ 'settings.appearance.system' | translate }}
            </button>
          </hlm-toggle-group>
          <div class="mt-4">
            <app-language-select [showLabel]="true" />
          </div>
        </div>
      </section>

      <section hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle>{{ 'settings.data.title' | translate }}</h3>
          <p hlmCardDescription>{{ 'settings.data.description' | translate }}</p>
        </div>
        <div hlmCardFooter>
          <button hlmBtn variant="outline" [disabled]="user.busy()" (click)="user.exportData()">
            @if (user.busy()) {
              <hlm-spinner />
            } @else {
              <ng-icon name="lucideDownload" />
            }
            {{ 'settings.data.export' | translate }}
          </button>
        </div>
      </section>

      <section hlmCard class="border-destructive/40">
        <div hlmCardHeader>
          <h3 hlmCardTitle>{{ 'settings.delete.title' | translate }}</h3>
          <p hlmCardDescription>
            {{ 'settings.delete.description' | translate }}
          </p>
          @if (user.deleteError(); as error) {
            <p class="text-destructive text-sm" role="alert">{{ error }}</p>
          }
        </div>
        <div hlmCardFooter>
          <hlm-alert-dialog>
            <button hlmAlertDialogTrigger hlmBtn variant="destructive" [disabled]="user.busy()">
              <ng-icon name="lucideTrash2" />
              {{ 'settings.delete.title' | translate }}
            </button>
            <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
              <hlm-alert-dialog-header>
                <h2 hlmAlertDialogTitle>{{ 'settings.delete.confirmTitle' | translate }}</h2>
                <p hlmAlertDialogDescription>
                  {{ 'settings.delete.confirmDescription' | translate }}
                </p>
              </hlm-alert-dialog-header>
              <label class="grid gap-1.5 text-sm font-medium">
                {{ 'settings.delete.password' | translate }}
                <input
                  hlmInput
                  type="password"
                  autocomplete="current-password"
                  [value]="deletePassword()"
                  (input)="deletePassword.set($any($event.target).value)"
                />
              </label>
              <hlm-alert-dialog-footer>
                <button hlmAlertDialogCancel>{{ 'common.cancel' | translate }}</button>
                <button hlmAlertDialogAction variant="destructive" (click)="confirmDelete()">
                  {{ 'settings.delete.title' | translate }}
                </button>
              </hlm-alert-dialog-footer>
            </hlm-alert-dialog-content>
          </hlm-alert-dialog>
        </div>
      </section>

      <p class="text-muted-foreground text-xs">{{ 'auth.layout.trademarks' | translate }}</p>
    </div>
  `,
})
export class Settings {
  protected readonly user = inject(UserStore);
  protected readonly theme = inject(ThemeStore);
  protected readonly deletePassword = signal('');

  protected confirmDelete(): void {
    this.user.deleteAccount(this.deletePassword());
    this.deletePassword.set('');
  }

  protected setTheme(value: unknown): void {
    if (value === 'light' || value === 'dark' || value === 'system')
      this.theme.setTheme(value as Theme);
  }
}
