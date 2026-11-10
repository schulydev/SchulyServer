import { TranslatePipe } from '@ngx-translate/core';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEllipsisVertical, lucideLogOut, lucideUserRound } from '@ng-icons/lucide';
import { ApiAvatar } from '../shared/api-avatar';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSidebarImports, HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { UserStore } from '../stores/user.store';

@Component({
  selector: 'app-nav-user',
  imports: [HlmSidebarImports, ApiAvatar, HlmDropdownMenuImports, NgIcon, RouterLink, TranslatePipe],
  providers: [provideIcons({ lucideEllipsisVertical, lucideLogOut, lucideUserRound })],
  template: `
    <ul hlmSidebarMenu>
      <li hlmSidebarMenuItem>
        <button
          hlmSidebarMenuButton
          size="lg"
          class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          [hlmDropdownMenuTrigger]="menu"
          [side]="menuSide()"
          align="end"
        >
          <app-api-avatar class="size-8" [src]="user.avatar()" [name]="user.name()" />
          <div class="grid flex-1 text-left text-sm leading-tight">
            <span class="truncate font-medium">{{ user.name() }}</span>
            <span class="text-muted-foreground truncate text-xs">{{ user.email() }}</span>
          </div>
          <ng-icon name="lucideEllipsisVertical" class="ml-auto" />
        </button>
      </li>
    </ul>

    <ng-template #menu>
      <hlm-dropdown-menu class="min-w-56 rounded-lg">
        <hlm-dropdown-menu-label class="p-0 font-normal">
          <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <app-api-avatar class="size-8" [src]="user.avatar()" [name]="user.name()" />
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-medium">{{ user.name() }}</span>
              <span class="text-muted-foreground truncate text-xs">{{ user.email() }}</span>
            </div>
          </div>
        </hlm-dropdown-menu-label>
        <hlm-dropdown-menu-separator />
        <hlm-dropdown-menu-group>
          <a hlmDropdownMenuItem routerLink="/settings">
            <ng-icon name="lucideUserRound" />
            <span>{{ 'common.account' | translate }}</span>
          </a>
        </hlm-dropdown-menu-group>
        <hlm-dropdown-menu-separator />
        <button hlmDropdownMenuItem (click)="user.logout()">
          <ng-icon name="lucideLogOut" />
          <span>{{ 'nav.logOut' | translate }}</span>
        </button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class NavUser {
  private readonly sidebar = inject(HlmSidebarService);
  protected readonly user = inject(UserStore);
  protected readonly menuSide = computed(() => (this.sidebar.isMobile() ? 'top' : 'right'));
}
