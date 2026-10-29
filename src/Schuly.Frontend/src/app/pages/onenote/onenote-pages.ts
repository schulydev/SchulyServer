import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, linkedSignal, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideBookmark, lucideFilePlus, lucideFileText, lucideSearch } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { EmptyState } from '../../shared/empty-state';
import { ListTime } from '../../shared/list-time';
import { LoadMore } from '../../shared/load-more';
import { AccountProblem } from '../../shared/account-problem';
import { SearchField } from '../../shared/search-field';
import { OneNoteStore } from '../../stores/onenote.store';

/** The middle pane: pages of the selected section, or search hits. */
@Component({
  selector: 'app-onenote-pages',
  imports: [EmptyState, HlmButton, HlmSkeletonImports, ListTime, LoadMore, AccountProblem, NgIcon, NgTemplateOutlet, SearchField],
  providers: [provideIcons({ lucideArrowLeft, lucideBookmark, lucideFilePlus, lucideFileText, lucideSearch })],
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' },
  template: `
    <div class="flex flex-col gap-2 px-4 pt-4 pb-2">
      <div class="flex items-center gap-2">
        <button hlmBtn variant="ghost" size="icon-sm" type="button" class="lg:hidden" (click)="back.emit()">
          <ng-icon name="lucideArrowLeft" aria-hidden="true" />
          <span class="sr-only">Back to notebooks</span>
        </button>
        <h2 class="min-w-0 flex-1 truncate text-lg font-semibold">
          @if (store.searchActive()) {
            Search results
          } @else {
            {{ store.selectedSection()?.displayName ?? 'Pages' }}
          }
        </h2>
        @if (store.canCreate() && !store.searchActive()) {
          <button hlmBtn size="sm" type="button" aria-keyshortcuts="n" title="New page (N)" (click)="newPage.emit()">
            <ng-icon name="lucideFilePlus" aria-hidden="true" />
            New page
          </button>
        }
      </div>
      @if (store.searchActive()) {
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-muted-foreground min-w-0 flex-1 truncate">
            @if (!store.searchAll() && store.selectedNotebook(); as notebook) {
              In {{ notebook.displayName }}
            } @else {
              In all notebooks
            }
          </span>
          @if (store.selectedNotebook()) {
            <button hlmBtn size="sm" variant="outline" type="button" [attr.aria-pressed]="store.searchAll()" (click)="store.searchAll.set(!store.searchAll())">
              All notebooks
            </button>
          }
        </div>
        @if (store.partial()) {
          <p class="text-muted-foreground text-xs">Only part of a large notebook could be searched. Results may be incomplete.</p>
        }
      } @else if (store.selectedSectionId() && !store.pagesProblem()) {
        <app-search-field class="[&_hlm-input-group]:w-full" [(value)]="filter" label="Filter pages" placeholder="Filter pages" />
      }
    </div>

    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      @if (store.searchActive()) {
        @if (store.searching()) {
          <ng-container [ngTemplateOutlet]="skeleton" />
        } @else if (store.searchProblem(); as problem) {
          <div class="p-3"><ng-container [ngTemplateOutlet]="problemTpl" [ngTemplateOutletContext]="{ $implicit: problem }" /></div>
        } @else if (store.hits().length) {
          <ul aria-label="Search results">
            @for (hit of store.hits(); track hit.id) {
              <li class="min-w-0">
                <button type="button" [class]="rowClass(hit.id)" [attr.aria-current]="hit.id === store.pageId() ? 'true' : null" (click)="store.openPage(hit.id, { title: hit.title, notebook: hit.notebook?.displayName ?? null, section: hit.section?.displayName ?? null })">
                  <ng-icon name="lucideFileText" class="text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
                  <span class="block min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{{ hit.title || 'Untitled page' }}</span>
                    <span class="text-foreground/70 block truncate text-xs">{{ hit.notebook?.displayName }}@if (hit.notebook && hit.section) { / }{{ hit.section?.displayName }}</span>
                  </span>
                  <span class="text-foreground/70 shrink-0 text-xs"><app-list-time [value]="hit.lastModifiedDateTime" /></span>
                </button>
              </li>
            }
          </ul>
        } @else {
          <app-empty-state icon="lucideSearch" title="No pages found" description="Search matches page titles. Try another word." />
        }
      } @else if (!store.selectedSectionId()) {
        <app-empty-state icon="lucideBookmark" title="Select a section" description="Pick a section to see its pages." />
      } @else if (store.pagesLoading()) {
        <ng-container [ngTemplateOutlet]="skeleton" />
      } @else if (store.pagesProblem(); as problem) {
        <div class="p-3"><ng-container [ngTemplateOutlet]="problemTpl" [ngTemplateOutletContext]="{ $implicit: problem }" /></div>
      } @else if (filtered().length) {
        <ul aria-label="Pages">
          @for (page of filtered(); track page.id) {
            <li class="min-w-0">
              <button
                type="button"
                [class]="rowClass(page.id)"
                [style.padding-inline-start.rem]="1 + (filter().trim() ? 0 : Math.min(page.level, 4)) * 1.25"
                [attr.aria-current]="page.id === store.pageId() ? 'true' : null"
                (click)="store.openPage(page.id, { title: page.title, notebook: store.selectedNotebook()?.displayName ?? null, section: store.selectedSection()?.displayName ?? null })"
              >
                <ng-icon name="lucideFileText" class="text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-sm" [class.font-medium]="page.level === 0">
                  {{ page.title || 'Untitled page' }}
                  @if (page.level > 0) {
                    <span class="sr-only">(subpage)</span>
                  }
                </span>
                <span class="text-foreground/70 shrink-0 text-xs"><app-list-time [value]="page.lastModifiedDateTime" /></span>
              </button>
            </li>
          }
        </ul>
        <app-load-more label="Load more pages" [hasMore]="store.hasMore()" [loading]="store.loadingMore()" [failed]="store.moreFailed()" (more)="store.loadMorePages()" />
      } @else if (store.pages().length) {
        <app-empty-state icon="lucideFileText" title="No matching pages" description="Try a different filter, or load more pages." />
        <app-load-more label="Load more pages" [hasMore]="store.hasMore()" [loading]="store.loadingMore()" [failed]="store.moreFailed()" (more)="store.loadMorePages()" />
      } @else {
        <app-empty-state icon="lucideFileText" title="No pages" description="This section has no pages yet." />
      }
    </div>

    <ng-template #skeleton>
      <div class="flex flex-col gap-1 p-3" role="status" aria-label="Loading pages">
        @for (i of [1, 2, 3, 4, 5]; track i) {
          <hlm-skeleton class="h-9 w-full" />
        }
      </div>
    </ng-template>
    <ng-template #problemTpl let-problem>
      @if (problem === 'unsupported') {
        <app-empty-state icon="lucideFileText" title="OneNote cannot show this section" description="OneNote does not allow this section to be read from here." />
      } @else {
        <app-account-problem [problem]="problem === 'expired' || problem === 'missing' ? problem : 'failed'" />
      }
    </ng-template>
  `,
})
export class OneNotePages {
  protected readonly store = inject(OneNoteStore);
  protected readonly Math = Math;

  readonly back = output<void>();
  readonly newPage = output<void>();

  protected readonly filter = linkedSignal<string | null, string>({ source: this.store.selectedSectionId, computation: () => '' });

  protected readonly filtered = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const pages = this.store.pages();
    return q ? pages.filter((p) => (p.title || 'Untitled page').toLowerCase().includes(q)) : pages;
  });

  protected rowClass(id: string): string {
    return (
      'hover:bg-muted/60 focus-visible:outline-ring flex w-full min-w-0 items-start gap-3 overflow-hidden border-b py-2.5 ps-4 pe-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 ' +
      (id === this.store.pageId() ? 'bg-muted' : '')
    );
  }

}
