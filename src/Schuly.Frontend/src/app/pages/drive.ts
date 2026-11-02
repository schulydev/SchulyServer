import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChildren } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideEye,
  lucideFile,
  lucideFileArchive,
  lucideFileSpreadsheet,
  lucideFileText,
  lucideFileType,
  lucideFolder,
  lucideHardDrive,
  lucideImage,
  lucidePresentation,
  lucideSquareArrowOutUpRight,
} from '@ng-icons/lucide';
import { HlmBreadcrumbImports } from '@spartan-ng/helm/breadcrumb';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { DriveContent } from '../core/drive-content';
import { formatSize } from '../core/drive-explorer';
import { DriveNavigation } from '../core/drive-navigation';
import { DriveSearch } from '../core/drive-search';
import { DriveTeams } from '../core/drive-teams';
import { DriveThumbnails } from '../core/drive-thumbnails';
import { persistedChoice } from '../core/persisted';
import { AccountPicker } from '../shared/account-picker';
import { AccountProblem } from '../shared/account-problem';
import { DriveLocations } from '../shared/drive-locations';
import { DriveSearchResults } from '../shared/drive-search-results';
import { DriveThumb } from '../shared/drive-thumb';
import { EmptyState } from '../shared/empty-state';
import { FileViewer, ViewerFile } from '../shared/file-viewer';
import { LoadMore } from '../shared/load-more';
import { SearchField } from '../shared/search-field';
import { DriveEntry, DriveStore } from '../stores/capability-data.store';
import { DriveExplorer } from './drive-explorer';

type DriveLayout = 'schuly' | 'explorer';

@Component({
  selector: 'app-drive',
  imports: [
    HlmBreadcrumbImports,
    HlmButton,
    HlmSkeletonImports,
    HlmToggleGroupImports,
    NgIcon,
    DriveExplorer,
    DriveLocations,
    DriveSearchResults,
    DriveThumb,
    EmptyState,
    FileViewer,
    LoadMore,
    AccountPicker,
    AccountProblem,
    SearchField,
  ],
  providers: [
    provideIcons({
      lucideDownload,
      lucideEye,
      lucideFile,
      lucideFileArchive,
      lucideFileSpreadsheet,
      lucideFileText,
      lucideFileType,
      lucideFolder,
      lucideHardDrive,
      lucideImage,
      lucidePresentation,
      lucideSquareArrowOutUpRight,
    }),
    DriveStore,
    DriveThumbnails,
    DriveSearch,
    DriveTeams,
    DriveNavigation,
    DriveContent,
  ],
  template: `
    <div class="flex flex-col gap-4 p-4 lg:p-6">
      <app-account-picker kind="drive" />

      <div class="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <app-drive-locations class="lg:sticky lg:top-(--header-height)" />

        <div class="flex min-w-0 flex-col gap-4">
          @if (!store.problem()) {
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <nav hlmBreadcrumb aria-label="Folder path" class="w-full min-w-0 sm:w-auto sm:flex-1">
                <ol hlmBreadcrumbList>
                  <li hlmBreadcrumbItem>
                    @if (nav.trail().length) {
                      <button type="button" class="hover:text-foreground rounded-sm transition-colors" (click)="nav.goToDepth(0)">{{ nav.rootLabel() }}</button>
                    } @else {
                      <span hlmBreadcrumbPage>{{ nav.rootLabel() }}</span>
                    }
                  </li>
                  @for (crumb of nav.trail(); track $index; let last = $last) {
                    <li hlmBreadcrumbSeparator></li>
                    <li hlmBreadcrumbItem>
                      @if (last) {
                        <span hlmBreadcrumbPage>{{ crumb.name }}</span>
                      } @else {
                        <button type="button" class="hover:text-foreground rounded-sm transition-colors" (click)="nav.goToDepth($index + 1)">{{ crumb.name }}</button>
                      }
                    </li>
                  }
                </ol>
              </nav>
              @if (layout.value() === 'schuly') {
                <div class="flex items-center gap-2">
                  <div class="flex items-center gap-1" role="toolbar" aria-label="File actions">
                    <button hlmBtn variant="ghost" size="sm" [disabled]="!current()" (click)="open()">
                      <ng-icon [name]="current()?.isFolder ? 'lucideFolder' : 'lucideSquareArrowOutUpRight'" aria-hidden="true" />
                      {{ current()?.isFolder ? 'Open folder' : 'Open online' }}
                      @if (current() && !current()?.isFolder) {
                        <span class="sr-only">(opens in a new tab)</span>
                      }
                    </button>
                    @if (current(); as file) {
                      @if (file.openable) {
                        <button hlmBtn variant="ghost" size="sm" type="button" (click)="view()">
                          <ng-icon name="lucideEye" aria-hidden="true" />
                          View
                        </button>
                        <button hlmBtn variant="ghost" size="sm" type="button" (click)="content.save(file)">
                          <ng-icon name="lucideDownload" aria-hidden="true" />
                          Download
                        </button>
                      }
                    }
                  </div>
                  <app-search-field [(value)]="search.query" label="Search all files" placeholder="Search all files" />
                </div>
              }
              <hlm-toggle-group
                type="single"
                variant="outline"
                size="sm"
                [nullable]="false"
                [value]="layout.value()"
                (valueChange)="setLayout($event)"
                aria-label="Drive view"
              >
                <button hlmToggleGroupItem value="schuly" class="px-3">Schuly</button>
                <button hlmToggleGroupItem value="explorer" class="px-3">Explorer</button>
              </hlm-toggle-group>
            </div>
          }

          @if (layout.value() === 'explorer' && !store.problem()) {
            <app-drive-explorer (view)="view($event.entry, $event.files)" />
          } @else if (store.waiting() || store.loading()) {
            <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
              @for (i of [1, 2, 3, 4, 5, 6]; track i) {
                <hlm-skeleton class="aspect-4/3 w-full" />
              }
            </div>
          } @else if (store.problem(); as problem) {
            <app-account-problem [problem]="problem" />
          } @else if (filtered().length) {
            <div
              role="listbox"
              aria-label="Files and folders"
              class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4"
              [attr.aria-busy]="store.loadingMore()"
              (keydown)="onKeydown($event)"
            >
              @for (entry of filtered(); track entry.id; let i = $index) {
                <div
                  #card
                  role="option"
                  class="focus-visible:outline-ring group flex cursor-pointer flex-col gap-2 rounded-lg p-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                  [class.bg-muted]="entry.id === selectedId()"
                  [attr.aria-selected]="entry.id === selectedId()"
                  [attr.tabindex]="i === tabIndex() ? 0 : -1"
                  (click)="select(entry.id)"
                  (dblclick)="select(entry.id); open()"
                >
                  <app-drive-thumb
                    [entry]="entry"
                    size="medium"
                    iconSize="36"
                    class="bg-muted text-muted-foreground group-hover:border-border aspect-4/3 w-full rounded-lg border border-transparent"
                    [class.border-ring]="entry.id === selectedId()"
                    [class.text-foreground]="entry.id === selectedId()"
                  />
                  <div class="line-clamp-2 text-center text-sm leading-snug font-medium break-words">{{ entry.name }}</div>
                  <div class="text-muted-foreground text-center text-xs">{{ meta(entry) }}</div>
                </div>
              }
            </div>
            <p class="text-muted-foreground border-t pt-3 text-sm" aria-live="polite">{{ summary() }}</p>
          } @else if (store.entries().length) {
            <app-empty-state icon="lucideHardDrive" title="No matching files here" description="Files from everywhere are listed below." />
          } @else {
            <app-empty-state icon="lucideHardDrive" title="This folder is empty" [description]="nav.emptyText()" />
          }

          <app-drive-search-results (open)="openFound($event)" />

          <app-load-more
            label="Load more files"
            [hasMore]="store.hasMore()"
            [loading]="store.loadingMore()"
            [failed]="store.moreFailed()"
            [loaded]="store.loadedMore()"
            (more)="store.loadMore()"
          />
        </div>
      </div>

      <app-file-viewer [file]="viewing()" [files]="viewerFiles()" (closed)="viewing.set(null)" />
    </div>
  `,
})
export class Drive {
  protected readonly store = inject(DriveStore);
  protected readonly nav = inject(DriveNavigation);
  protected readonly search = inject(DriveSearch);
  protected readonly content = inject(DriveContent);

  /** Which Drive layout is shown; remembered per browser. */
  protected readonly layout = persistedChoice<DriveLayout>('schuly.drive.layout', ['schuly', 'explorer'], 'schuly');

  protected readonly viewing = signal<ViewerFile | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  private readonly cards = viewChildren<ElementRef<HTMLElement>>('card');

  constructor() {
    // Another folder or location starts with nothing selected.
    effect(() => {
      this.nav.view();
      untracked(() => this.selectedId.set(null));
    });
  }

  /** The open folder, narrowed by the text in the search field. */
  protected readonly filtered = computed(() => {
    const q = this.search.query().trim().toLowerCase();
    return q ? this.store.entries().filter((e) => e.name.toLowerCase().includes(q)) : this.store.entries();
  });

  protected readonly current = computed(() => this.filtered().find((e) => e.id === this.selectedId()) ?? null);

  /** Roving tabindex: the selected card, else the first one. */
  protected readonly tabIndex = computed(() => Math.max(0, this.filtered().findIndex((e) => e.id === this.selectedId())));

  protected readonly summary = computed(() => {
    const entries = this.filtered();
    const folders = entries.filter((e) => e.isFolder).length;
    const files = entries.length - folders;
    const total = entries.reduce((sum, e) => sum + (e.isFolder ? 0 : e.size), 0);
    const parts = [];
    if (folders) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`);
    parts.push(`${files} ${files === 1 ? 'file' : 'files'}`, formatSize(total));
    return parts.join(' · ');
  });

  protected meta(entry: DriveEntry): string {
    if (entry.sharedBy) return `Shared by ${entry.sharedBy}`;
    if (entry.isFolder) {
      return entry.childCount === null ? 'Folder' : `${entry.childCount} ${entry.childCount === 1 ? 'item' : 'items'} · Folder`;
    }
    return `${formatSize(entry.size)} · ${entry.extension ? entry.extension.toUpperCase() : 'File'}`;
  }

  /** Shows a file in the viewer; Office formats also get the server-side PDF rendering. */
  protected view(entry: DriveEntry | null = this.current(), order: DriveEntry[] | null = null): void {
    if (!entry?.openable) return;
    // The explorer and the search results pass their own order; the card view uses the filtered list.
    this.viewerOrder.set(order);
    this.viewing.set(this.viewerFiles().find((f) => f.key === this.content.key(entry)) ?? null);
  }

  /** The files of the current list (no folders) for the viewer. */
  private readonly viewerOrder = signal<DriveEntry[] | null>(null);

  protected readonly viewerFiles = computed<ViewerFile[]>(() =>
    (this.viewerOrder() ?? this.filtered())
      .map((entry) => this.content.viewerFile(entry))
      .filter((file): file is ViewerFile => file !== null),
  );

  /** A search result: a folder becomes the open location, a file opens in the viewer next to the other results. */
  protected openFound(entry: DriveEntry): void {
    if (entry.isFolder) return this.nav.openFound(entry);
    this.view(
      entry,
      this.search.results().map((r) => r.entry),
    );
  }

  protected setLayout(value: unknown): void {
    if (value === 'schuly' || value === 'explorer') this.layout.set(value);
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected open(): void {
    const entry = this.current();
    if (!entry) return;
    if (entry.isFolder) {
      if (this.nav.enter(entry)) this.selectedId.set(null);
      else if (entry.link) window.open(entry.link, '_blank', 'noopener');
    } else if (entry.link) {
      window.open(entry.link, '_blank', 'noopener');
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const entries = this.filtered();
    if (!entries.length) return;
    const cards = this.cards().map((c) => c.nativeElement);
    const index = Math.max(0, entries.findIndex((e) => e.id === this.selectedId()));
    const hasSelection = this.selectedId() !== null;
    const columns = cards.filter((c) => c.offsetTop === cards[0].offsetTop).length || 1;

    let next = index;
    switch (event.key) {
      case 'ArrowRight': next = hasSelection ? index + 1 : 0; break;
      case 'ArrowLeft': next = hasSelection ? index - 1 : 0; break;
      case 'ArrowDown': next = hasSelection ? index + columns : 0; break;
      case 'ArrowUp': next = hasSelection ? index - columns : 0; break;
      case 'Home': next = 0; break;
      case 'End': next = entries.length - 1; break;
      case 'Enter':
        if (hasSelection) {
          event.preventDefault();
          this.open();
        }
        return;
      case ' ':
        event.preventDefault();
        this.selectedId.set(entries[index].id);
        return;
      default:
        return;
    }
    event.preventDefault();
    next = Math.min(entries.length - 1, Math.max(0, next));
    this.selectedId.set(entries[next].id);
    cards[next]?.focus();
  }
}
