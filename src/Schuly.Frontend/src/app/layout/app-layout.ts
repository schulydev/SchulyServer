import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMoon, lucideSun } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSeparator } from '@spartan-ng/helm/separator';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import { filter, map, startWith } from 'rxjs';
import { AbsencesStore } from '../stores/absences.store';
import { AgendaStore } from '../stores/agenda.store';
import { DataRefresh } from '../stores/data-refresh';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { DrivePdfConverter } from '../stores/drive-pdf-converter';
import { PDF_CONVERTER } from '../shared/file-viewer';
import { ClassesStore } from '../stores/classes.store';
import { DocumentsStore } from '../stores/documents.store';
import { GradesStore } from '../stores/grades.store';
import { SecurityStore } from '../stores/security.store';
import { ThemeStore } from '../stores/theme.store';
import { UserStore } from '../stores/user.store';
import { AppSidebar } from './app-sidebar';

@Component({
  selector: 'app-layout',
  imports: [HlmSidebarImports, HlmButton, HlmSeparator, NgIcon, RouterOutlet, AppSidebar],
  providers: [provideIcons({ lucideMoon, lucideSun }), UserStore, ClassesStore, GradesStore, AgendaStore, AbsencesStore, DocumentsStore, SecurityStore, DataRefresh, LinkedAccountsStore, { provide: PDF_CONVERTER, useClass: DrivePdfConverter }],
  styles: `
    [hlmSidebarWrapper] {
      --sidebar-width: calc(var(--spacing) * 64);
      --header-height: calc(var(--spacing) * 12 + 1px);
    }
  `,
  template: `
    <div hlmSidebarWrapper>
      <app-sidebar />
      <div hlmSidebarInset [class]="fullHeight() ? 'h-svh min-h-0 overflow-hidden' : ''">
        <header
          class="bg-background/90 sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b backdrop-blur transition-[width,height] ease-linear"
        >
          <div class="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <button hlmSidebarTrigger class="-ml-1"></button>
            <hlm-separator orientation="vertical" class="mx-2 data-vertical:h-4 data-vertical:self-center" />
            <h1 class="text-base font-medium">{{ title() }}</h1>
            <div class="ml-auto flex items-center gap-2">
              <button hlmBtn variant="ghost" size="icon-sm" (click)="theme.toggle()" [attr.aria-label]="theme.dark() ? 'Switch to light theme' : 'Switch to dark theme'">
                <ng-icon [name]="theme.dark() ? 'lucideSun' : 'lucideMoon'" />
              </button>
            </div>
          </div>
        </header>
        <main class="@container/main flex min-h-0 flex-1 flex-col" [class.overflow-hidden]="fullHeight()">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class AppLayout {
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeStore);

  private readonly leaf = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => {
        let route = this.router.routerState.snapshot.root;
        while (route.firstChild) route = route.firstChild;
        return { title: route.title ?? 'Schuly', fullHeight: route.data['fullHeight'] === true };
      }),
    ),
    { initialValue: { title: 'Schuly', fullHeight: false } },
  );

  protected readonly title = computed(() => this.leaf().title);
  /** Routes with `data: { fullHeight: true }` fill the viewport and scroll inside their own panes, never the page. */
  protected readonly fullHeight = computed(() => this.leaf().fullHeight);
}
