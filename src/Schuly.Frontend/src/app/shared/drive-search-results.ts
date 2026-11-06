import { TranslatePipe } from '@ngx-translate/core';
import { Component, inject, output } from '@angular/core';
import { DriveSearch } from '../core/drive-search';
import { formatModified, formatSize } from '../core/drive-explorer';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { DriveEntry } from '../stores/capability-data.store';
import { DriveThumb } from './drive-thumb';

/** Files found everywhere in the account for the text in the search field: name, where it lives, when it changed. */
@Component({
  selector: 'app-drive-search-results',
  imports: [TranslatePipe, HlmButton, HlmSkeletonImports, DriveThumb],
  host: { class: 'block' },
  template: `
    @if (search.active()) {
      <section aria-labelledby="drive-search-heading" class="flex flex-col gap-2">
        <h2 id="drive-search-heading" class="text-muted-foreground text-sm font-medium">{{ 'files.everywhere' | translate }}</h2>
        <div aria-live="polite" class="sr-only">
          @if (search.loading()) {
            {{ 'files.searching' | translate }}
          } @else if (search.failed()) {
            {{ 'files.searchFailed' | translate }}
          } @else {
            {{ 'files.results' | translate: { count: search.results().length } }}
          }
        </div>
        @if (search.loading()) {
          <div class="flex flex-col gap-1" aria-hidden="true">
            @for (i of [1, 2, 3]; track i) {
              <hlm-skeleton class="h-12 w-full" />
            }
          </div>
        } @else if (search.failed() && !search.results().length) {
          <p class="text-muted-foreground text-sm">{{ 'files.searchError' | translate }}</p>
        } @else if (!search.results().length) {
          <p class="text-muted-foreground text-sm">{{ 'files.noneFound' | translate }}</p>
        } @else {
          <ul class="flex flex-col">
            @for (result of search.results(); track result.entry.driveId + '|' + result.entry.id) {
              <li class="border-b last:border-b-0">
                <button
                  type="button"
                  class="hover:bg-muted/60 focus-visible:outline-ring flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
                  (click)="open.emit(result.entry)"
                >
                  <app-drive-thumb [entry]="result.entry" size="small" iconSize="18" class="bg-muted/60 size-9 shrink-0 rounded-sm" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{{ result.entry.name }}</span>
                    <span class="text-muted-foreground block truncate text-xs">{{ result.where }}</span>
                  </span>
                  <span class="text-muted-foreground shrink-0 text-right text-xs tabular-nums">
                    <span class="block">{{ when(result.entry) }}</span>
                    @if (!result.entry.isFolder) {
                      <span class="block">{{ size(result.entry) }}</span>
                    }
                  </span>
                </button>
              </li>
            }
          </ul>
          @if (search.failed()) {
            <p class="text-muted-foreground text-sm">{{ 'files.moreFailed' | translate }}</p>
          }
          @if (search.nextFrom() !== null) {
            <div>
              <button hlmBtn variant="outline" size="sm" type="button" [disabled]="search.loadingMore()" (click)="search.loadMore()">
                {{ search.loadingMore() ? ('common.loading' | translate) : ('files.moreResults' | translate) }}
              </button>
            </div>
          }
        }
      </section>
    }
  `,
})
export class DriveSearchResults {
  protected readonly search = inject(DriveSearch);
  /** A found file or folder was chosen. */
  readonly open = output<DriveEntry>();

  protected when(entry: DriveEntry): string {
    return formatModified(entry.modified, new Date());
  }

  protected size(entry: DriveEntry): string {
    return formatSize(entry.size);
  }
}
