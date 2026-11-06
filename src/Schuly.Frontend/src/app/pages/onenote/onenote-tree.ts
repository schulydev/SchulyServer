import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBookmark, lucideChevronDown, lucideChevronRight, lucideFolder, lucideLock, lucideNotebook } from '@ng-icons/lucide';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { EmptyState } from '../../shared/empty-state';
import { AccountProblem } from '../../shared/account-problem';
import { OneNoteNode, OneNoteNotebook, OneNoteProblem, TreeRow, visibleRows } from '../../stores/onenote.model';
import { OneNoteStore } from '../../stores/onenote.store';

interface Branch {
  nodes: OneNoteNode[];
  notebookId: string;
  level: number;
}

/** Notebooks, section groups and sections as an ARIA tree with a roving tabindex. */
@Component({
  selector: 'app-onenote-tree',
  imports: [TranslatePipe, EmptyState, HlmSkeletonImports, AccountProblem, NgIcon, NgTemplateOutlet],
  providers: [provideIcons({ lucideBookmark, lucideChevronDown, lucideChevronRight, lucideFolder, lucideLock, lucideNotebook })],
  host: { class: 'block' },
  template: `
    @if (store.waiting() || store.notebooksLoading()) {
      <div class="flex flex-col gap-2 p-3" role="status" [attr.aria-label]="'notes.loadingNotebooks' | translate">
        @for (i of [1, 2, 3, 4]; track i) {
          <hlm-skeleton class="h-8 w-full" />
        }
      </div>
    } @else if (store.notebooksProblem(); as problem) {
      <div class="p-3"><app-account-problem [problem]="problemKind(problem)" /></div>
    } @else if (store.notebooks().length) {
      <ul role="tree" [attr.aria-label]="'notes.notebooks' | translate" class="flex flex-col gap-0.5 p-2">
        @for (notebook of store.notebooks(); track notebook.id) {
          <li role="none">
            <div
              role="treeitem"
              [class]="rowClass(notebook.id)"
              [attr.data-id]="notebook.id"
              [style.padding-inline-start.rem]="0.5"
              aria-level="1"
              [attr.aria-setsize]="store.notebooks().length"
              [attr.aria-posinset]="$index + 1"
              [attr.aria-expanded]="expanded().has(notebook.id)"
              aria-selected="false"
              [attr.aria-current]="store.selectedNotebookId() === notebook.id && !store.selectedSectionId() ? 'true' : null"
              [tabindex]="tabId() === notebook.id ? 0 : -1"
              (click)="activate(notebook.id, 'notebook', notebook.id)"
              (focus)="focusId.set(notebook.id)"
              (keydown)="key($event, notebook.id, 'notebook', notebook.id)"
            >
              <ng-icon [name]="expanded().has(notebook.id) ? 'lucideChevronDown' : 'lucideChevronRight'" class="shrink-0" aria-hidden="true" />
              <ng-icon name="lucideNotebook" class="shrink-0" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ notebook.displayName || ('notes.untitledNotebook' | translate) }}</span>
                @if (teamOf(notebook); as team) {
                  <span class="text-muted-foreground block truncate text-xs font-normal">{{ team }}</span>
                }
              </span>
              @if (!notebook.writable) {
                <ng-icon name="lucideLock" class="text-muted-foreground shrink-0 text-xs" aria-hidden="true" />
                <span class="sr-only">{{ 'notes.readOnly' | translate }}</span>
              }
            </div>
            @if (expanded().has(notebook.id)) {
              @let tree = store.trees()[notebook.id];
              @if (tree?.nodes?.length) {
                <ng-container *ngTemplateOutlet="branch; context: { $implicit: { nodes: tree!.nodes, notebookId: notebook.id, level: 2 } }" />
              } @else if (tree?.loading || !tree) {
                <p class="text-muted-foreground py-1 ps-9 text-xs" role="status">{{ 'notes.loadingSections' | translate }}</p>
              } @else if (tree?.problem; as problem) {
                <p class="text-destructive py-1 ps-9 text-xs" role="status">{{ problemText(problem) }}</p>
              } @else {
                <p class="text-muted-foreground py-1 ps-9 text-xs" role="status">{{ 'notes.noSections' | translate }}</p>
              }
            }
          </li>
        }
      </ul>
    } @else {
      <app-empty-state icon="lucideNotebook" [title]="'notes.noNotebooks' | translate" [description]="'notes.noNotebooksHint' | translate" />
    }

    <ng-template #branch let-b>
      <ul role="group" class="flex flex-col gap-0.5">
        @for (node of b.nodes; track node.id) {
          <li role="none">
            <div
              role="treeitem"
              [class]="rowClass(node.id)"
              [attr.data-id]="node.id"
              [style.padding-inline-start.rem]="0.5 + (b.level - 1) * 1.1"
              [attr.aria-level]="b.level"
              [attr.aria-setsize]="b.nodes.length"
              [attr.aria-posinset]="$index + 1"
              [attr.aria-expanded]="node.kind === 'group' ? expanded().has(node.id) : null"
              [attr.aria-selected]="node.kind === 'section' ? store.selectedSectionId() === node.id : false"
              [tabindex]="tabId() === node.id ? 0 : -1"
              (click)="activate(node.id, node.kind, b.notebookId)"
              (focus)="focusId.set(node.id)"
              (keydown)="key($event, node.id, node.kind, b.notebookId)"
            >
              @if (node.kind === 'group') {
                <ng-icon [name]="expanded().has(node.id) ? 'lucideChevronDown' : 'lucideChevronRight'" class="shrink-0" aria-hidden="true" />
                <ng-icon name="lucideFolder" class="shrink-0" aria-hidden="true" />
              } @else {
                <span class="w-4 shrink-0" aria-hidden="true"></span>
                <ng-icon name="lucideBookmark" class="shrink-0" aria-hidden="true" />
              }
              <span class="min-w-0 flex-1 truncate">{{ node.displayName || ('mail.untitled' | translate) }}</span>
            </div>
            @if (node.kind === 'group' && expanded().has(node.id) && node.children.length) {
              <ng-container *ngTemplateOutlet="branch; context: { $implicit: { nodes: node.children, notebookId: b.notebookId, level: b.level + 1 } }" />
            }
          </li>
        }
      </ul>
    </ng-template>
  `,
})
export class OneNoteTree {
  protected readonly store = inject(OneNoteStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly focusId = signal<string | null>(null);
  private opened = false;

  private readonly rows = computed<TreeRow[]>(() => visibleRows(this.store.notebooks(), this.store.trees(), this.expanded()));
  protected readonly tabId = computed(() => {
    const rows = this.rows();
    const focus = this.focusId();
    return rows.find((r) => r.id === focus)?.id ?? rows[0]?.id ?? null;
  });

  constructor() {
    // The first notebook opens by itself so there is something to pick; a new account starts over.
    effect(() => {
      const first = this.store.notebooks()[0];
      untracked(() => {
        if (!first) {
          this.opened = false;
          this.expanded.set(new Set());
        } else if (!this.opened) {
          this.opened = true;
          this.expand(first.id, true);
        }
      });
    });
  }

  protected rowClass(id: string): string {
    const selected = this.store.selectedSectionId() === id || (this.store.selectedNotebookId() === id && !this.store.selectedSectionId());
    return (
      'flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pe-2 text-sm outline-none select-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' +
      (selected ? 'bg-muted font-semibold' : '')
    );
  }

  protected teamOf(notebook: OneNoteNotebook): string | null {
    return notebook.source?.kind === 'team' ? notebook.source.name || t('notes.teamNotebook') : null;
  }

  protected problemKind(problem: OneNoteProblem): 'expired' | 'missing' | 'failed' {
    return problem === 'expired' || problem === 'missing' ? problem : 'failed';
  }

  protected problemText(problem: OneNoteProblem): string {
    return problem === 'expired' ? t('notes.signInExpired') : problem === 'missing' ? t('notes.notebookMissing') : t('notes.sectionsFailed');
  }

  private expand(id: string, notebook: boolean): void {
    this.expanded.update((set) => new Set(set).add(id));
    if (notebook) void this.store.loadTree(id);
  }

  private collapse(id: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  protected activate(id: string, kind: 'notebook' | 'group' | 'section', notebookId: string): void {
    this.focusId.set(id);
    if (kind === 'section') {
      if (this.store.selectedSectionId() !== id) this.store.closePage();
      this.store.setQuery('');
      this.store.selectSection(id, notebookId);
      return;
    }
    if (kind === 'notebook') this.store.selectNotebook(id);
    if (this.expanded().has(id)) this.collapse(id);
    else this.expand(id, kind === 'notebook');
  }

  private focusRow(id: string | undefined): void {
    if (!id) return;
    this.focusId.set(id);
    afterNextRender(
      () => {
        const items = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[role="treeitem"]'));
        items.find((el) => el.dataset['id'] === id)?.focus();
      },
      { injector: this.injector },
    );
  }

  protected key(event: KeyboardEvent, id: string, kind: 'notebook' | 'group' | 'section', notebookId: string): void {
    const rows = this.rows();
    const index = rows.findIndex((r) => r.id === id);
    const row = rows[index];
    if (!row) return;
    const open = this.expanded().has(id);
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(rows[index + 1]?.id);
        break;
      case 'ArrowUp':
        this.focusRow(rows[index - 1]?.id);
        break;
      case 'Home':
        this.focusRow(rows[0]?.id);
        break;
      case 'End':
        this.focusRow(rows.at(-1)?.id);
        break;
      case 'ArrowRight':
        if (row.expandable && !open) this.expand(id, kind === 'notebook');
        else if (row.expandable && rows[index + 1]?.parentId === id) this.focusRow(rows[index + 1].id);
        break;
      case 'ArrowLeft':
        if (row.expandable && open) this.collapse(id);
        else if (row.parentId) this.focusRow(row.parentId);
        break;
      case 'Enter':
      case ' ':
        this.activate(id, kind, notebookId);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }
}
