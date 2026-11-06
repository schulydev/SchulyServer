import { TranslatePipe } from '@ngx-translate/core';
import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendarDays, lucideChartColumn, lucideFileText, lucideHardDrive, lucideLayoutDashboard, lucideMail, lucideMessagesSquare, lucideNotebook, lucidePlug, lucideUserX } from '@ng-icons/lucide';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { NavUser } from './nav-user';

interface NavItem {
  title: string;
  url: string;
  /** Name of an ng-icon. Ignored when image is set. */
  icon?: string;
  /** Decorative image path used instead of an icon. */
  image?: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [HlmSidebarImports, NgIcon, RouterLink, RouterLinkActive, NavUser, TranslatePipe],
  providers: [provideIcons({ lucideLayoutDashboard, lucideChartColumn, lucideCalendarDays, lucideUserX, lucideFileText, lucideHardDrive, lucideMail, lucideMessagesSquare, lucideNotebook, lucidePlug })],
  template: `
    <hlm-sidebar collapsible="icon" role="complementary" [attr.aria-label]="'nav.sidebar' | translate">
      <div hlmSidebarHeader class="border-b">
        <ul hlmSidebarMenu>
          <li hlmSidebarMenuItem>
            <a hlmSidebarMenuButton routerLink="/" class="!p-1.5">
              <img src="app_icon.png" alt="" class="size-5 shrink-0 rounded-sm group-data-[collapsible=icon]:size-4" />
              <span class="text-base font-semibold">Schuly</span>
            </a>
          </li>
        </ul>
      </div>
      <nav hlmSidebarContent [attr.aria-label]="'nav.main' | translate">
        @for (group of groups(); track group.label) {
          <div hlmSidebarGroup>
            <div hlmSidebarGroupLabel>{{ group.label | translate }}</div>
            <div hlmSidebarGroupContent>
              <ul hlmSidebarMenu>
                @for (item of group.items; track item.url) {
                  <li hlmSidebarMenuItem>
                    <a
                      hlmSidebarMenuButton
                      [routerLink]="item.url"
                      routerLinkActive
                      #rla="routerLinkActive"
                      [routerLinkActiveOptions]="{ exact: item.url === '/' }"
                      [isActive]="rla.isActive"
                      [tooltip]="item.title | translate"
                    >
                      @if (item.image) {
                        <img [src]="item.image" alt="" class="size-4 shrink-0" />
                      } @else {
                        <ng-icon [name]="item.icon!" />
                      }
                      <span>{{ item.title | translate }}</span>
                    </a>
                  </li>
                }
              </ul>
            </div>
          </div>
        }
      </nav>
      <div hlmSidebarFooter>
        <app-nav-user />
      </div>
    </hlm-sidebar>
  `,
})
export class AppSidebar {
  private readonly linked = inject(LinkedAccountsStore);

  private readonly aiGroup = {
    label: 'nav.ai',
    items: [
      { title: 'nav.helply', url: '/ai/helply', image: 'helply-avatar.svg' },
      { title: 'nav.mcp', url: '/ai/mcp', icon: 'lucidePlug' },
    ],
  };

  protected readonly groups = computed<{ label: string; items: NavItem[] }[]>(() => [
    ...this.schoolGroups,
    ...this.linked.navGroups().map((group) => ({ label: group.label, items: group.items })),
    this.aiGroup,
  ]);

  private readonly schoolGroups: { label: string; items: NavItem[] }[] = [
    {
      label: 'nav.home',
      items: [{ title: 'nav.overview', url: '/', icon: 'lucideLayoutDashboard' }],
    },
    {
      label: 'nav.school',
      items: [
        { title: 'nav.grades', url: '/grades', icon: 'lucideChartColumn' },
        { title: 'nav.calendar', url: '/calendar', icon: 'lucideCalendarDays' },
        { title: 'nav.absences', url: '/absences', icon: 'lucideUserX' },
        { title: 'nav.documents', url: '/documents', icon: 'lucideFileText' },
      ],
    },
  ];
}
