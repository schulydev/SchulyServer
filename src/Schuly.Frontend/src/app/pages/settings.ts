import { LanguageSelect } from '../shared/language-select';
import { TranslatePipe } from '@ngx-translate/core';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMonitor, lucideMoon, lucideSun } from '@ng-icons/lucide';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { Theme, ThemeStore } from '../stores/theme.store';
import { AccountCard } from './settings/account-card';
import { SecurityCard } from './settings/security-card';
import { AccountsCard } from './settings/accounts-card';
import { DangerZoneCard } from './settings/danger-zone-card';

@Component({
  selector: 'app-settings',
  imports: [
    LanguageSelect,
    TranslatePipe,
    AccountCard,
    SecurityCard,
    AccountsCard,
    DangerZoneCard,
    HlmCardImports,
    HlmToggleGroupImports,
    NgIcon,
  ],
  providers: [provideIcons({ lucideSun, lucideMoon, lucideMonitor })],
  template: `
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 lg:p-6">
      <app-account-card />
      <app-accounts-card />
      <app-security-card [resume]="resume" />

      <section hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle>{{ 'settings.appearance.title' | translate }}</h3>
          <p hlmCardDescription>{{ 'settings.appearance.description' | translate }}</p>
        </div>
        <div hlmCardContent class="divide-y">
          <div class="flex flex-wrap items-center justify-between gap-3 pb-3">
            <span class="text-sm">{{ 'settings.appearance.theme' | translate }}</span>
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
          </div>
          <app-language-select class="pt-3" [showLabel]="true" />
        </div>
      </section>

      <app-danger-zone-card [resume]="resume" />

      <p class="text-muted-foreground text-xs">{{ 'auth.layout.trademarks' | translate }}</p>
    </div>
  `,
})
export class Settings {
  protected readonly theme = inject(ThemeStore);
  /** Set when a fresh sign-in came back here to finish an action; read once, then taken off the address. */
  protected readonly resume = inject(ActivatedRoute).snapshot.queryParamMap.get('resume');

  constructor() {
    if (this.resume)
      void inject(Router).navigate([], {
        queryParams: { resume: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
  }

  protected setTheme(value: unknown): void {
    if (value === 'light' || value === 'dark' || value === 'system')
      this.theme.setTheme(value as Theme);
  }
}
