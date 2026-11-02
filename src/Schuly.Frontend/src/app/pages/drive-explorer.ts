import { Component, DestroyRef, ElementRef, LOCALE_ID, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowDown,
  lucideArrowDownUp,
  lucideArrowUp,
  lucideCircle,
  lucideCircleCheck,
  lucideDownload,
  lucideEye,
  lucideFolderOpen,
  lucideLayoutGrid,
  lucideLink,
  lucideList,
  lucideSquareArrowOutUpRight,
} from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import {
  EXPLORER_SORT_KEYS,
  ExplorerSortKey,
  explorerTypeLabel,
  formatModified,
  formatSize,
  rangeOf,
  sortEntries,
} from '../core/drive-explorer';
import { persistedChoice } from '../core/persisted';
import { DriveThumb } from '../shared/drive-thumb';
import { SearchField } from '../shared/search-field';
import { DriveEntry, DriveStore } from '../stores/capability-data.store';

type Mode = 'list' | 'grid';
type SortChoice = `${ExplorerSortKey}:${'asc' | 'desc'}`;

interface Row {
  entry: DriveEntry;
  type: string;
  when: string;
  size: string;
  meta: string;
}

const SORT_CHOICES = EXPLORER_SORT_KEYS.flatMap((key) => [`${key}:asc`, `${key}:desc`] as SortChoice[]);
const COLUMN_LABELS: Record<ExplorerSortKey, string> = { name: 'Name', modified: 'Modified', type: 'Type', size: 'Size' };
/** How long a pointer rests on a folder before its listing is fetched ahead. */
const PREFETCH_DELAY_MS = 120;

/**
 * The explorer-style Drive view: a toolbar whose actions always stand and are off without a
 * selection, a details list with sortable columns or tiles with previews, desktop selection
 * (click, Ctrl/Cmd, Shift, arrows, Space, Ctrl+A), a context menu on the secondary click and a
 * status strip at the foot. Folders open in place; files open in the shared viewer.
 */
@Component({
  selector: 'app-drive-explorer',
  imports: [HlmButton, HlmContextMenuImports, HlmDropdownMenuImports, HlmSkeletonImports, HlmToggleGroupImports, NgIcon, DriveThumb, SearchField],
  providers: [
    provideIcons({
      lucideArrowDown,
      lucideArrowDownUp,
      lucideArrowUp,
      lucideCircle,
      lucideCircleCheck,
      lucideDownload,
      lucideEye,
      lucideFolderOpen,
      lucideLayoutGrid,
      lucideLink,
      lucideList,
      lucideSquareArrowOutUpRight,
    }),
  ],
  host: { class: '@container/explorer flex flex-col' },
  template: `
    <div #toolbar class="bg-background sticky top-(--header-height) z-[2] flex flex-wrap items-center gap-2 border-b pb-2">
      <div class="flex items-center gap-1" role="toolbar" aria-label="File actions">
        <button hlmBtn variant="ghost" size="sm" type="button" title="Open" [disabled]="!single()" (click)="openChosen()">
          <ng-icon [name]="single()?.isFolder ? 'lucideFolderOpen' : 'lucideEye'" aria-hidden="true" />
          <span class="@max-[44rem]/explorer:sr-only">Open</span>
        </button>
        <button hlmBtn variant="ghost" size="sm" type="button" title="Download" [disabled]="!downloadable().length" (click)="download(downloadable())">
          <ng-icon name="lucideDownload" aria-hidden="true" />
          <span class="@max-[44rem]/explorer:sr-only">Download</span>
        </button>
        <button hlmBtn variant="ghost" size="sm" type="button" title="Open in OneDrive" [disabled]="!single()?.link" (click)="openInOneDrive()">
          <ng-icon name="lucideSquareArrowOutUpRight" aria-hidden="true" />
          <span class="@max-[44rem]/explorer:sr-only">Open in OneDrive</span>
          <span class="sr-only">(opens in a new tab)</span>
        </button>
        <button hlmBtn variant="ghost" size="sm" type="button" title="Copy link" [disabled]="!linkable().length" (click)="copyLinks(linkable())">
          <ng-icon name="lucideLink" aria-hidden="true" />
          <span class="@max-[44rem]/explorer:sr-only">Copy link</span>
        </button>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <app-search-field [(value)]="query" label="Search files" placeholder="Search files" />
        @if (mode.value() === 'grid') {
          <button hlmBtn variant="outline" size="sm" type="button" [hlmDropdownMenuTrigger]="sortMenu" [attr.aria-label]="'Sort by ' + sortLabel()" title="Sort">
            <ng-icon name="lucideArrowDownUp" aria-hidden="true" />
            <span class="@max-[44rem]/explorer:sr-only">{{ sortLabel() }}</span>
          </button>
        }
        <hlm-toggle-group
          type="single"
          variant="outline"
          size="sm"
          [nullable]="false"
          [value]="mode.value()"
          (valueChange)="setMode($event)"
          aria-label="Layout"
        >
          <button hlmToggleGroupItem value="list" aria-label="List" title="List"><ng-icon name="lucideList" aria-hidden="true" /></button>
          <button hlmToggleGroupItem value="grid" aria-label="Grid" title="Grid"><ng-icon name="lucideLayoutGrid" aria-hidden="true" /></button>
        </hlm-toggle-group>
      </div>
      @if (query().trim() && store.hasMore()) {
        <p class="text-muted-foreground w-full text-xs">Searching loaded items only. Scroll to load more.</p>
      }
    </div>

    @if (busy()) {
      @if (mode.value() === 'list') {
        <div class="flex flex-col" aria-busy="true" aria-label="Loading files">
          @for (i of placeholders; track i) {
            <div class="flex h-10 items-center gap-3 border-b px-2">
              <hlm-skeleton class="size-6 rounded-sm" />
              <hlm-skeleton class="h-3.5 flex-1" [style.max-width.%]="35 + ((i * 17) % 40)" />
              <hlm-skeleton class="h-3.5 w-20 @max-[30rem]/explorer:hidden" />
              <hlm-skeleton class="h-3.5 w-12" />
            </div>
          }
        </div>
      } @else {
        <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2 py-2 @max-[44rem]/explorer:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]" aria-busy="true" aria-label="Loading files">
          @for (i of placeholders; track i) {
            <div class="flex flex-col items-center gap-2 rounded-lg border p-2 pt-3">
              <hlm-skeleton class="h-24 w-full rounded-md" />
              <hlm-skeleton class="h-3.5 w-3/4" />
              <hlm-skeleton class="h-3 w-1/2" />
            </div>
          }
        </div>
      }
    } @else if (!rows().length) {
      <div class="text-muted-foreground grid place-items-center gap-2 py-16 text-center">
        <ng-icon name="lucideFolderOpen" size="32" aria-hidden="true" />
        <p class="grid gap-1">
          <strong class="text-foreground font-medium">{{ store.entries().length ? 'No matching files' : 'This folder is empty' }}</strong>
          <span class="text-sm">{{ store.entries().length ? 'Try a different search.' : 'Files and folders from OneDrive appear here.' }}</span>
        </p>
      </div>
    } @else if (mode.value() === 'list') {
      <div role="grid" aria-multiselectable="true" aria-label="Files and folders" [attr.aria-rowcount]="rows().length + 1" [attr.aria-busy]="store.loadingMore()">
        <div
          role="row"
          aria-rowindex="1"
          class="bg-background sticky top-[calc(var(--header-height)+var(--explorer-toolbar,2.75rem))] z-[1] grid grid-cols-[minmax(0,1fr)_10rem_10rem_6rem] border-b @max-[44rem]/explorer:grid-cols-[minmax(0,1fr)_7.5rem_4.5rem] @max-[30rem]/explorer:grid-cols-[minmax(0,1fr)_4.5rem]"
        >
          @for (column of columns; track column) {
            <div
              role="columnheader"
              class="min-w-0 px-2"
              [class.text-right]="column === 'size'"
              [class]="columnClass(column)"
              [attr.aria-sort]="ariaSort(column)"
            >
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground focus-visible:outline-ring inline-flex min-h-8 items-center gap-1 rounded-sm text-xs font-medium focus-visible:outline-2"
                [class.text-foreground]="sort().key === column"
                [class.flex-row-reverse]="column === 'size'"
                (click)="sortBy(column)"
              >
                {{ columnLabels[column] }}
                @if (sort().key === column) {
                  <ng-icon [name]="sort().down ? 'lucideArrowDown' : 'lucideArrowUp'" size="14" aria-hidden="true" />
                }
              </button>
            </div>
          }
        </div>
        @for (row of rows(); track row.entry.id; let i = $index) {
          <div
            role="row"
            class="group focus-visible:outline-ring grid min-h-10 cursor-default grid-cols-[minmax(0,1fr)_10rem_10rem_6rem] items-center border-b select-none focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 @max-[44rem]/explorer:grid-cols-[minmax(0,1fr)_7.5rem_4.5rem] @max-[30rem]/explorer:grid-cols-[minmax(0,1fr)_4.5rem] hover:bg-muted/60 aria-selected:bg-accent aria-selected:hover:bg-accent"
            [attr.aria-rowindex]="i + 2"
            [attr.aria-selected]="selected(row.entry.id)"
            [attr.data-entry-id]="row.entry.id"
            [attr.tabindex]="tabStop() === row.entry.id ? 0 : -1"
            [hlmContextMenuTrigger]="rowMenu"
            (contextmenu)="pointAt(row.entry)"
            (click)="press($event, row.entry)"
            (dblclick)="open(row.entry)"
            (keydown)="key($event, row.entry)"
            (focus)="focused.set(row.entry.id); warm(row.entry, true)"
            (mouseenter)="warm(row.entry)"
            (mouseleave)="cool()"
          >
            <div role="gridcell" class="flex min-w-0 items-center gap-2.5 px-2 text-sm">
              <app-drive-thumb [entry]="row.entry" size="small" iconSize="18" class="bg-muted/60 size-7 shrink-0 rounded-sm" />
              <span class="truncate" [title]="row.entry.name">{{ row.entry.name }}</span>
            </div>
            <div role="gridcell" class="text-muted-foreground group-aria-selected:text-accent-foreground truncate px-2 text-sm @max-[30rem]/explorer:hidden">{{ row.when }}</div>
            <div role="gridcell" class="text-muted-foreground group-aria-selected:text-accent-foreground truncate px-2 text-sm @max-[44rem]/explorer:hidden">{{ row.type }}</div>
            <div role="gridcell" class="text-muted-foreground group-aria-selected:text-accent-foreground truncate px-2 text-right text-sm tabular-nums">{{ row.size }}</div>
          </div>
        }
      </div>
    } @else {
      <div
        role="listbox"
        aria-multiselectable="true"
        aria-orientation="horizontal"
        aria-label="Files and folders"
        class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2 py-2 @max-[44rem]/explorer:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]"
        [attr.aria-busy]="store.loadingMore()"
      >
        @for (row of rows(); track row.entry.id) {
          <div
            role="option"
            class="group focus-visible:outline-ring relative grid cursor-pointer grid-rows-[auto_2lh_auto] justify-items-center gap-1 rounded-lg border p-2 pt-3 text-center text-sm select-none focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 hover:bg-muted/60 aria-selected:border-ring aria-selected:bg-accent aria-selected:hover:bg-accent"
            [attr.aria-selected]="selected(row.entry.id)"
            [attr.data-entry-id]="row.entry.id"
            [attr.tabindex]="tabStop() === row.entry.id ? 0 : -1"
            [title]="row.entry.name"
            [hlmContextMenuTrigger]="rowMenu"
            (contextmenu)="pointAt(row.entry)"
            (click)="tap($event, row.entry)"
            (keydown)="key($event, row.entry)"
            (focus)="focused.set(row.entry.id); warm(row.entry, true)"
            (mouseenter)="warm(row.entry)"
            (mouseleave)="cool()"
          >
            <span
              class="bg-background/80 absolute top-1 left-1 z-[1] grid size-7 place-items-center rounded-full opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-selected:opacity-100 [@media(hover:none)]:opacity-100"
              [class.text-primary]="selected(row.entry.id)"
              [class.text-muted-foreground]="!selected(row.entry.id)"
              aria-hidden="true"
              (click)="toggle($event, row.entry)"
            >
              <ng-icon [name]="selected(row.entry.id) ? 'lucideCircleCheck' : 'lucideCircle'" size="18" />
            </span>
            <app-drive-thumb [entry]="row.entry" size="medium" iconSize="40" class="bg-muted h-24 w-full rounded-md" />
            <span class="line-clamp-2 max-w-full leading-snug font-medium wrap-anywhere">{{ row.entry.name }}</span>
            <span class="text-muted-foreground group-aria-selected:text-accent-foreground text-xs whitespace-nowrap tabular-nums">{{ row.meta }}</span>
          </div>
        }
      </div>
    }

    <div class="bg-background text-muted-foreground sticky bottom-0 z-[1] mt-auto flex justify-between gap-4 border-t py-2 text-xs">
      <p class="truncate">{{ status() }}</p>
      <p class="whitespace-nowrap" aria-live="polite">{{ chosen().length ? chosen().length + ' selected' : '' }}</p>
    </div>

    <ng-template #rowMenu>
      <hlm-dropdown-menu class="min-w-48">
        <button hlmDropdownMenuItem [disabled]="!single()" (click)="openChosen()">
          <ng-icon [name]="single()?.isFolder ? 'lucideFolderOpen' : 'lucideEye'" />
          <span>Open</span>
        </button>
        <button hlmDropdownMenuItem [disabled]="!downloadable().length" (click)="download(downloadable())">
          <ng-icon name="lucideDownload" />
          <span>Download</span>
        </button>
        <hlm-dropdown-menu-separator />
        <button hlmDropdownMenuItem [disabled]="!single()?.link" (click)="openInOneDrive()">
          <ng-icon name="lucideSquareArrowOutUpRight" />
          <span>Open in OneDrive</span>
        </button>
        <button hlmDropdownMenuItem [disabled]="!linkable().length" (click)="copyLinks(linkable())">
          <ng-icon name="lucideLink" />
          <span>{{ linkable().length > 1 ? 'Copy links' : 'Copy link' }}</span>
        </button>
      </hlm-dropdown-menu>
    </ng-template>

    <ng-template #sortMenu>
      <hlm-dropdown-menu class="min-w-44">
        <hlm-dropdown-menu-label>Sort by</hlm-dropdown-menu-label>
        @for (column of columns; track column) {
          <button hlmDropdownMenuItem (click)="sortBy(column)">
            @if (sort().key === column) {
              <ng-icon [name]="sort().down ? 'lucideArrowDown' : 'lucideArrowUp'" />
            } @else {
              <span class="size-4" aria-hidden="true"></span>
            }
            <span>{{ columnLabels[column] }}</span>
            @if (sort().key === column) {
              <span class="sr-only">(current, {{ sort().down ? 'descending' : 'ascending' }})</span>
            }
          </button>
        }
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class DriveExplorer {
  protected readonly store = inject(DriveStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The open folder as names from the drive root. */
  readonly trail = input.required<string[]>();
  /** Open a folder: the full trail of names. */
  readonly navigate = output<string[]>();
  /** Show a file in the viewer. */
  readonly view = output<DriveEntry>();

  protected readonly mode = persistedChoice<Mode>('schuly.drive.explorer.mode', ['list', 'grid'], 'list');
  private readonly sortChoice = persistedChoice<SortChoice>('schuly.drive.explorer.sort', SORT_CHOICES, 'name:asc');
  protected readonly sort = computed(() => {
    const [key, direction] = this.sortChoice.value().split(':') as [ExplorerSortKey, string];
    return { key, down: direction === 'desc' };
  });

  protected readonly query = signal('');
  protected readonly selection = signal<string[]>([]);
  protected readonly focused = signal<string | null>(null);
  private anchor: string | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly toolbar = viewChild.required<ElementRef<HTMLElement>>('toolbar');

  protected readonly columns = EXPLORER_SORT_KEYS;
  protected readonly columnLabels = COLUMN_LABELS;
  protected readonly placeholders = [1, 2, 3, 4, 5, 6, 7, 8];

  protected readonly busy = computed(() => this.store.waiting() || this.store.loading());

  protected readonly rows = computed<Row[]>(() => {
    const q = this.query().trim().toLowerCase();
    const entries = q ? this.store.entries().filter((e) => e.name.toLowerCase().includes(q)) : this.store.entries();
    const now = new Date();
    return sortEntries(entries, this.sort(), this.locale).map((entry) => {
      const type = explorerTypeLabel(entry);
      const size = entry.isFolder ? '' : formatSize(entry.size);
      const items = entry.childCount === null ? '' : `${entry.childCount} ${entry.childCount === 1 ? 'item' : 'items'}`;
      return {
        entry,
        type,
        when: formatModified(entry.modified, now, this.locale),
        size: entry.isFolder ? items : size,
        meta: entry.isFolder ? (items ? `${items} · Folder` : 'Folder') : `${size} · ${type}`,
      };
    });
  });

  private readonly ids = computed(() => this.rows().map((r) => r.entry.id));

  protected readonly chosen = computed(() => {
    const ids = new Set(this.selection());
    return this.rows()
      .filter((r) => ids.has(r.entry.id))
      .map((r) => r.entry);
  });
  protected readonly single = computed(() => (this.chosen().length === 1 ? this.chosen()[0] : null));
  protected readonly downloadable = computed(() => this.chosen().filter((e) => !e.isFolder && e.download));
  protected readonly linkable = computed(() => this.chosen().filter((e) => e.link));

  /** Roving tab stop: the focused row while it is listed, else the first. */
  protected readonly tabStop = computed(() => {
    const ids = this.ids();
    const focused = this.focused();
    return focused !== null && ids.includes(focused) ? focused : (ids[0] ?? null);
  });

  protected readonly sortLabel = computed(() => `${COLUMN_LABELS[this.sort().key]} ${this.sort().down ? 'descending' : 'ascending'}`);

  protected readonly status = computed(() => {
    const entries = this.rows().map((r) => r.entry);
    const folders = entries.filter((e) => e.isFolder).length;
    const files = entries.length - folders;
    const bytes = entries.reduce((sum, e) => sum + (e.isFolder ? 0 : e.size), 0);
    const parts: string[] = [];
    if (folders) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`);
    parts.push(`${files} ${files === 1 ? 'file' : 'files'}`, formatSize(bytes));
    return parts.join(' · ');
  });

  constructor() {
    // The column header sticks right under the toolbar, which wraps to two lines on a phone.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([item]) =>
        this.host.nativeElement.style.setProperty('--explorer-toolbar', `${Math.ceil(item.borderBoxSize?.[0]?.blockSize ?? item.contentRect.height)}px`),
      );
      observer.observe(this.toolbar().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    // Another folder starts with nothing selected and the search cleared.
    effect(() => {
      this.trail();
      untracked(() => {
        this.selection.set([]);
        this.focused.set(null);
        this.query.set('');
        this.anchor = null;
      });
    });
  }

  protected columnClass(column: ExplorerSortKey): string {
    if (column === 'type') return '@max-[44rem]/explorer:hidden';
    if (column === 'modified') return '@max-[30rem]/explorer:hidden';
    return '';
  }

  protected ariaSort(column: ExplorerSortKey): 'ascending' | 'descending' | 'none' {
    const sort = this.sort();
    return sort.key !== column ? 'none' : sort.down ? 'descending' : 'ascending';
  }

  protected sortBy(column: ExplorerSortKey): void {
    const sort = this.sort();
    const down = sort.key === column ? !sort.down : column === 'modified' || column === 'size';
    this.sortChoice.set(`${column}:${down ? 'desc' : 'asc'}`);
  }

  protected setMode(value: unknown): void {
    if (value === 'list' || value === 'grid') this.mode.set(value);
  }

  protected selected(id: string): boolean {
    return this.selection().includes(id);
  }

  /** List rows: a click selects, Ctrl or Cmd adds, Shift takes the range from the last click. A touch opens, or toggles while something is selected. */
  protected press(event: MouseEvent, entry: DriveEntry): void {
    if (event.shiftKey && this.anchor !== null && this.ids().includes(this.anchor)) {
      this.selection.set(rangeOf(this.ids(), this.anchor, entry.id));
    } else if (event.ctrlKey || event.metaKey) {
      this.toggleId(entry.id);
    } else if ((event as PointerEvent).pointerType === 'touch') {
      if (this.selection().length) this.toggleId(entry.id);
      else this.open(entry);
    } else {
      this.selection.set([entry.id]);
      this.anchor = entry.id;
    }
    this.focused.set(entry.id);
  }

  /** Tiles: a plain click opens, Ctrl, Cmd or Shift select as in the list, and so does any click while something is selected on a touch screen. */
  protected tap(event: MouseEvent, entry: DriveEntry): void {
    const touchSelecting = (event as PointerEvent).pointerType === 'touch' && this.selection().length > 0;
    if (event.ctrlKey || event.metaKey || event.shiftKey || touchSelecting) {
      this.press(touchSelecting ? new MouseEvent('click', { ctrlKey: true }) : event, entry);
    } else {
      this.focused.set(entry.id);
      this.open(entry);
    }
  }

  /** The corner mark of a tile. */
  protected toggle(event: MouseEvent, entry: DriveEntry): void {
    event.stopPropagation();
    this.toggleId(entry.id);
    this.focused.set(entry.id);
  }

  private toggleId(id: string): void {
    const now = this.selection();
    this.selection.set(now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
    this.anchor = id;
  }

  /** The secondary click acts on the selection, which becomes this entry unless it is already part of it. */
  protected pointAt(entry: DriveEntry): void {
    if (!this.selected(entry.id)) {
      this.selection.set([entry.id]);
      this.anchor = entry.id;
    }
    this.focused.set(entry.id);
  }

  protected key(event: KeyboardEvent, entry: DriveEntry): void {
    const ids = this.ids();
    const at = ids.indexOf(entry.id);
    const grid = this.mode.value() === 'grid';
    const step = grid ? this.columnsPerRow() : 1;
    let to: number;
    switch (event.key) {
      case 'ArrowDown':
        to = Math.min(at + step, ids.length - 1);
        break;
      case 'ArrowUp':
        if (event.altKey) return this.goUp(event);
        to = Math.max(at - step, 0);
        break;
      case 'ArrowRight':
        if (!grid) return;
        to = Math.min(at + 1, ids.length - 1);
        break;
      case 'ArrowLeft':
        if (!grid) return;
        to = Math.max(at - 1, 0);
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = ids.length - 1;
        break;
      case 'Enter':
        event.preventDefault();
        this.open(entry);
        return;
      case 'Backspace':
        return this.goUp(event);
      case 'Escape':
        if (this.selection().length) {
          event.preventDefault();
          this.selection.set([]);
        }
        return;
      case ' ':
        event.preventDefault();
        this.toggleId(entry.id);
        return;
      case 'a':
      case 'A':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.selection.set([...ids]);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    const next = ids[to];
    if (event.shiftKey) {
      const anchor = this.anchor !== null && ids.includes(this.anchor) ? this.anchor : entry.id;
      this.anchor = anchor;
      this.selection.set(rangeOf(ids, anchor, next));
    } else if (!event.ctrlKey && !event.metaKey) {
      this.selection.set([next]);
      this.anchor = next;
    }
    this.focused.set(next);
    this.focusEntry(next);
  }

  private goUp(event: KeyboardEvent): void {
    const trail = this.trail();
    if (!trail.length) return;
    event.preventDefault();
    this.navigate.emit(trail.slice(0, -1));
  }

  /** Tiles per row, read from the layout: the tiles sharing the first tile's top. */
  private columnsPerRow(): number {
    const tiles = [...this.host.nativeElement.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!tiles.length) return 1;
    const top = tiles[0].offsetTop;
    return tiles.filter((t) => t.offsetTop === top).length || 1;
  }

  private focusEntry(id: string): void {
    [...this.host.nativeElement.querySelectorAll<HTMLElement>('[data-entry-id]')].find((el) => el.dataset['entryId'] === id)?.focus();
  }

  protected openChosen(): void {
    const entry = this.single();
    if (entry) this.open(entry);
  }

  /** A folder opens in place; a file opens in the viewer, or in OneDrive when it has no download link. */
  protected open(entry: DriveEntry): void {
    if (entry.isFolder) {
      this.navigate.emit([...this.trail(), entry.name]);
    } else if (entry.download) {
      this.view.emit(entry);
    } else if (entry.link) {
      window.open(entry.link, '_blank', 'noopener');
    }
  }

  protected openInOneDrive(): void {
    const link = this.single()?.link;
    if (link) window.open(link, '_blank', 'noopener');
  }

  /** Each file through its pre-authenticated link, one after another so the browser takes them all. */
  protected download(entries: DriveEntry[]): void {
    entries.forEach((entry, i) => {
      if (!entry.download) return;
      const url = entry.download;
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = url;
        link.download = entry.name;
        link.rel = 'noopener';
        link.click();
      }, i * 400);
    });
  }

  protected async copyLinks(entries: DriveEntry[]): Promise<void> {
    const links = entries.map((e) => e.link).filter((l): l is string => !!l);
    if (!links.length) return;
    try {
      await navigator.clipboard.writeText(links.join('\n'));
      toast.success(links.length === 1 ? 'Link copied' : `${links.length} links copied`);
    } catch {
      toast.error('Could not copy the link');
    }
  }

  /** Folders are fetched ahead once a pointer rests on them (or keyboard focus reaches them), so opening shows at once. */
  protected warm(entry: DriveEntry, now = false): void {
    this.cool();
    if (!entry.isFolder) return;
    const trail = [...this.trail(), entry.name];
    if (now) return this.store.prefetchFolder(trail);
    this.hoverTimer = setTimeout(() => this.store.prefetchFolder(trail), PREFETCH_DELAY_MS);
  }

  protected cool(): void {
    if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
  }
}
