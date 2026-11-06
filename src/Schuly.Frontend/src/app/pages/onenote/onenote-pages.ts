import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
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
  imports: [TranslatePipe, EmptyState, HlmButton, HlmSkeletonImports, ListTime, LoadMore, AccountProblem, NgIcon, NgTemplateOutlet, SearchField],
  providers: [provideIcons({ lucideArrowLeft, lucideBookmark, lucideFilePlus, lucideFileText, lucideSearch })],
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' },
  template: `
    <div class="flex flex-col gap-2 px-4 pt-4 pb-2">
      <div class="flex items-center gap-2">
        <button hlmBtn variant="ghost" size="icon-sm" type="button" class="lg:hidden" (click)="back.emit()">
          <ng-icon name="lucideArrowLeft" aria-hidden="true" />
          <span class="sr-only">{{ 'notes.backNotebooks' | translate }}</span>
        </button>
        <h2 class="min-w-0 flex-1 truncate text-lg font-semibold">
          @if (store.searchActive()) {
            {{ 'notes.results' | translate }}
          } @else {
            {{ store.selectedSection()?.displayName ?? ('notes.pages' | translate) }}
          }
        </h2>
        @if (store.canCreate() && !store.searchActive()) {
          <button hlmBtn size="sm" type="button" aria-keyshortcuts="n" [title]="('notes.newPage' | translate) + ' (N)'" (click)="newPage.emit()">
            <ng-icon name="lucideFilePlus" aria-hidden="true" />
            {{ 'notes.newPage' | translate }}
          </button>
        }
      </div>
      @if (store.searchActive()) {
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-muted-foreground min-w-0 flex-1 truncate">
            @if (!store.searchAll() && store.selectedNotebook(); as notebook) {
              {{ 'notes.inNotebook' | translate: { name: notebook.displayName } }}
            } @else {
              {{ 'notes.inAll' | translate }}
            }
          </span>
          @if (store.selectedNotebook()) {
            <button hlmBtn size="sm" variant="outline" type="button" [attr.aria-pressed]="store.searchAll()" (click)="store.searchAll.set(!store.searchAll())">
              {{ 'notes.allNotebooks' | translate }}
            </button>
          }
        </div>
        @if (store.partial()) {
          <p class="text-muted-foreground text-xs">{{ 'notes.partial' | translate }}</p>
        }
      } @else if (store.selectedSectionId() && !store.pagesProblem()) {
        <app-search-field class="[&_hlm-input-group]:w-full" [(value)]="filter" [label]="'notes.filter' | translate" [placeholder]="'notes.filter' | translate" />
      }
    </div>

    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      @if (store.searchActive()) {
        @if (store.searching()) {
          <ng-container [ngTemplateOutlet]="skeleton" />
        } @else if (store.searchProblem(); as problem) {
          <div class="p-3"><ng-container [ngTemplateOutlet]="problemTpl" [ngTemplateOutletContext]="{ $implicit: problem }" /></div>
        } @else if (store.hits().length) {
          <ul [attr.aria-label]="'notes.results' | translate">
            @for (hit of store.hits(); track hit.id) {
              <li class="min-w-0">
                <button type="button" [class]="rowClass(hit.id)" [attr.aria-current]="hit.id === store.pageId() ? 'true' : null" (click)="store.openPage(hit.id, { title: hit.title, notebook: hit.notebook?.displayName ?? null, section: hit.section?.displayName ?? null })">
                  <ng-icon name="lucideFileText" class="text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
                  <span class="block min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{{ hit.title || ('notes.untitledPage' | translate) }}</span>
                    <span class="text-foreground/70 block truncate text-xs">{{ hit.notebook?.displayName }}@if (hit.notebook && hit.section) { / }{{ hit.section?.displayName }}</span>
                  </span>
                  <span class="text-foreground/70 shrink-0 text-xs"><app-list-time [value]="hit.lastModifiedDateTime" /></span>
                </button>
              </li>
            }
          </ul>
        } @else {
          <app-empty-state icon="lucideSearch" [title]="'notes.noneFound' | translate" [description]="'notes.noneFoundHint' | translate" />
        }
      } @else if (!store.selectedSectionId()) {
        <app-empty-state icon="lucideBookmark" [title]="'notes.selectSection' | translate" [description]="'notes.selectSectionHint' | translate" />
      } @else if (store.pagesLoading()) {
        <ng-container [ngTemplateOutlet]="skeleton" />
      } @else if (store.pagesProblem(); as problem) {
        <div class="p-3"><ng-container [ngTemplateOutlet]="problemTpl" [ngTemplateOutletContext]="{ $implicit: problem }" /></div>
      } @else if (filtered().length) {
        <ul [attr.aria-label]="'notes.pages' | translate">
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
                  {{ page.title || ('notes.untitledPage' | translate) }}
                  @if (page.level > 0) {
                    <span class="sr-only">{{ 'notes.subpage' | translate }}</span>
                  }
                </span>
                <span class="text-foreground/70 shrink-0 text-xs"><app-list-time [value]="page.lastModifiedDateTime" /></span>
              </button>
            </li>
          }
        </ul>
        <app-load-more [label]="'notes.loadMore' | translate" [hasMore]="store.hasMore()" [loading]="store.loadingMore()" [failed]="store.moreFailed()" (more)="store.loadMorePages()" />
      } @else if (store.pages().length) {
        <app-empty-state icon="lucideFileText" [title]="'notes.noMatch' | translate" [description]="'notes.noMatchHint' | translate" />
        <app-load-more [label]="'notes.loadMore' | translate" [hasMore]="store.hasMore()" [loading]="store.loadingMore()" [failed]="store.moreFailed()" (more)="store.loadMorePages()" />
      } @else {
        <app-empty-state icon="lucideFileText" [title]="'notes.none' | translate" [description]="'notes.noneHint' | translate" />
      }
    </div>

    <ng-template #skeleton>
      <div class="flex flex-col gap-1 p-3" role="status" [attr.aria-label]="'notes.loadingPages' | translate">
        @for (i of [1, 2, 3, 4, 5]; track i) {
          <hlm-skeleton class="h-9 w-full" />
        }
      </div>
    </ng-template>
    <ng-template #problemTpl let-problem>
      @if (problem === 'unsupported') {
        <app-empty-state icon="lucideFileText" [title]="'notes.sectionBlocked' | translate" [description]="'notes.sectionBlockedHint' | translate" />
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
    return q ? pages.filter((p) => (p.title || t('notes.untitledPage')).toLowerCase().includes(q)) : pages;
  });

  protected rowClass(id: string): string {
    return (
      'hover:bg-muted/60 focus-visible:outline-ring flex w-full min-w-0 items-start gap-3 overflow-hidden border-b py-2.5 ps-4 pe-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 ' +
      (id === this.store.pageId() ? 'bg-muted' : '')
    );
  }

}
