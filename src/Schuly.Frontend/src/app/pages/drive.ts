import { Component, ElementRef, computed, inject, signal, viewChildren } from '@angular/core';
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
import { formatSize } from '../core/drive-explorer';
import { persistedChoice } from '../core/persisted';
import { EmptyState } from '../shared/empty-state';
import { FileViewer, ViewerFile } from '../shared/file-viewer';
import { LoadMore } from '../shared/load-more';
import { AccountPicker } from '../shared/account-picker';
import { AccountProblem } from '../shared/account-problem';
import { SearchField } from '../shared/search-field';
import { DriveEntry, DriveKind, DriveStore } from '../stores/capability-data.store';
import { DriveExplorer } from './drive-explorer';

const kindIcons: Record<DriveKind, string> = {
  folder: 'lucideFolder',
  document: 'lucideFileText',
  spreadsheet: 'lucideFileSpreadsheet',
  presentation: 'lucidePresentation',
  pdf: 'lucideFileType',
  image: 'lucideImage',
  archive: 'lucideFileArchive',
  file: 'lucideFile',
};

type DriveLayout = 'schuly' | 'explorer';

@Component({
  selector: 'app-drive',
  imports: [HlmBreadcrumbImports, HlmButton, HlmSkeletonImports, HlmToggleGroupImports, NgIcon, DriveExplorer, EmptyState, FileViewer, LoadMore, AccountPicker, AccountProblem, SearchField],
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
  ],
  template: `
    <div class="flex flex-col gap-4 p-4 lg:p-6">
      <app-account-picker kind="drive" />

      @if (!store.problem()) {
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <nav hlmBreadcrumb aria-label="Folder path" class="min-w-0 flex-1">
            <ol hlmBreadcrumbList>
              <li hlmBreadcrumbItem>
                @if (trail().length) {
                  <button type="button" class="hover:text-foreground rounded-sm transition-colors" (click)="go(0)">Drive</button>
                } @else {
                  <span hlmBreadcrumbPage>Drive</span>
                }
              </li>
              @for (name of trail(); track $index; let last = $last) {
                <li hlmBreadcrumbSeparator></li>
                <li hlmBreadcrumbItem>
                  @if (last) {
                    <span hlmBreadcrumbPage>{{ name }}</span>
                  } @else {
                    <button type="button" class="hover:text-foreground rounded-sm transition-colors" (click)="go($index + 1)">{{ name }}</button>
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
                {{ current()?.isFolder ? 'Open folder' : 'Open in OneDrive' }}
                @if (current() && !current()?.isFolder) {
                  <span class="sr-only">(opens in a new tab)</span>
                }
              </button>
              @if (current(); as file) {
                @if (!file.isFolder && file.download) {
                  <button hlmBtn variant="ghost" size="sm" type="button" (click)="view()">
                    <ng-icon name="lucideEye" aria-hidden="true" />
                    View
                  </button>
                }
              }
              @if (current()?.download; as url) {
                <a hlmBtn variant="ghost" size="sm" [href]="url" download>
                  <ng-icon name="lucideDownload" aria-hidden="true" />
                  Download
                </a>
              }
            </div>
            <app-search-field [(value)]="query" label="Search files" placeholder="Search files" />
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
        @if (layout.value() === 'schuly' && query().trim() && store.hasMore()) {
          <p class="text-muted-foreground -mt-2 text-xs">Searching loaded items only. Scroll to load more.</p>
        }
      }

      @if (layout.value() === 'explorer' && !store.problem()) {
        <app-drive-explorer [trail]="trail()" (navigate)="go(null, $event)" (view)="view($event)" />
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
              [attr.aria-label]="entry.name + ', ' + meta(entry)"
              [attr.tabindex]="i === tabIndex() ? 0 : -1"
              (click)="select(entry.id)"
              (dblclick)="select(entry.id); open()"
            >
              <div
                class="bg-muted text-muted-foreground flex aspect-4/3 items-center justify-center rounded-lg border border-transparent group-hover:border-border"
                [class.border-ring]="entry.id === selectedId()"
                [class.text-foreground]="entry.id === selectedId()"
              >
                <ng-icon [name]="icon(entry.kind)" size="36" aria-hidden="true" />
              </div>
              <div class="line-clamp-2 text-center text-sm leading-snug font-medium break-words" aria-hidden="true">{{ entry.name }}</div>
              <div class="text-muted-foreground text-center text-xs" aria-hidden="true">{{ meta(entry) }}</div>
            </div>
          }
        </div>
        <p class="text-muted-foreground border-t pt-3 text-sm" aria-live="polite">{{ summary() }}</p>
      } @else if (store.entries().length) {
        <app-empty-state icon="lucideHardDrive" title="No matching files" description="Try a different search." />
      } @else {
        <app-empty-state icon="lucideHardDrive" title="This folder is empty" description="Files and folders from OneDrive appear here." />
      }

      <app-file-viewer [file]="viewing()" (closed)="viewing.set(null)" />

      <app-load-more
        label="Load more files"
        [hasMore]="store.hasMore()"
        [loading]="store.loadingMore()"
        [failed]="store.moreFailed()"
        [loaded]="store.loadedMore()"
        (more)="store.loadMore()"
      />
    </div>
  `,
})
export class Drive {
  protected readonly store = inject(DriveStore);

  /** Which Drive layout is shown; remembered per browser. */
  protected readonly layout = persistedChoice<DriveLayout>('schuly.drive.layout', ['schuly', 'explorer'], 'schuly');

  protected readonly viewing = signal<ViewerFile | null>(null);
  protected readonly query = signal('');
  protected readonly trail = signal<string[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  private readonly cards = viewChildren<ElementRef<HTMLElement>>('card');

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
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

  protected icon(kind: DriveKind): string {
    return kindIcons[kind];
  }

  protected meta(entry: { isFolder: boolean; childCount: number | null; size: number; extension: string }): string {
    if (entry.isFolder) {
      return entry.childCount === null ? 'Folder' : `${entry.childCount} ${entry.childCount === 1 ? 'item' : 'items'} · Folder`;
    }
    return `${formatSize(entry.size)} · ${entry.extension ? entry.extension.toUpperCase() : 'File'}`;
  }

  /** Fetches the pre-authenticated download link as a blob; the viewer shows PDFs, images and text and offers a download for the rest. */
  protected view(entry: DriveEntry | null = this.current()): void {
    const url = entry?.download;
    if (!entry || !url) return;
    this.viewing.set({
      name: entry.name,
      load: async () => {
        const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('download failed');
        return response.blob();
      },
    });
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
      this.go(null, [...this.trail(), entry.name]);
    } else if (entry.link) {
      window.open(entry.link, '_blank', 'noopener');
    }
  }

  /** Navigates to the first `depth` folders of the current trail, or to an explicit trail. */
  protected go(depth: number | null, trail = this.trail().slice(0, depth ?? 0)): void {
    this.trail.set(trail);
    this.selectedId.set(null);
    this.query.set('');
    this.store.openFolder(trail);
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
