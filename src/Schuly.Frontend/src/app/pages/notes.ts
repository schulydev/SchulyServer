import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyboard, lucideNotebook } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { persistedNumber } from '../core/persisted';
import { AccountPicker } from '../shared/account-picker';
import { SearchField } from '../shared/search-field';
import { SplitHandle } from '../shared/split-handle';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { OneNoteStore } from '../stores/onenote.store';
import { OneNotePageView } from './onenote/onenote-page-view';
import { OneNotePages } from './onenote/onenote-pages';
import { OneNoteTree } from './onenote/onenote-tree';

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '/', action: 'common.search' },
  { keys: 'N', action: 'notes.newPage' },
  { keys: 'E', action: 'notes.shortcut.edit' },
  { keys: 'Delete', action: 'notes.shortcut.delete' },
  { keys: 'Ctrl+S', action: 'notes.shortcut.save' },
  { keys: 'Esc', action: 'notes.shortcut.cancel' },
];

const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || !!target.closest('[role="dialog"], [role="alertdialog"]');
};

@Component({
  selector: 'app-notes',
  imports: [TranslatePipe, HlmButton, HlmDialogImports, HlmInput, HlmSpinner, AccountPicker, NgIcon, OneNotePageView, OneNotePages, OneNoteTree, SearchField, SplitHandle],
  providers: [provideIcons({ lucideKeyboard, lucideNotebook }), OneNoteStore],
  host: {
    class: 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
    '(document:keydown)': 'shortcut($event)',
  },
  template: `
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 lg:px-6">
      <app-account-picker kind="notes" />
      <div #searchBox class="ms-auto flex min-w-0 items-center gap-2">
        <app-search-field
          class="[&_hlm-input-group]:w-full min-w-0 flex-1 sm:w-72 sm:flex-none"
          [label]="'notes.searchPages' | translate"
          [placeholder]="'notes.searchPages' | translate"
          [value]="store.query()"
          (valueChange)="store.setQuery($event)"
        />
        <div class="relative" (keydown.escape)="shortcutsOpen.set(false)">
          <button hlmBtn variant="ghost" size="icon-sm" type="button" [title]="'notes.shortcuts' | translate" aria-controls="onenote-shortcuts" [attr.aria-expanded]="shortcutsOpen()" (click)="shortcutsOpen.set(!shortcutsOpen())">
            <ng-icon name="lucideKeyboard" aria-hidden="true" />
            <span class="sr-only">{{ 'notes.shortcuts' | translate }}</span>
          </button>
          <div id="onenote-shortcuts" class="bg-popover text-popover-foreground ring-foreground/10 absolute end-0 top-full z-30 mt-1 flex w-64 flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1" [hidden]="!shortcutsOpen()">
            <h2 class="text-sm font-medium">{{ 'notes.shortcuts' | translate }}</h2>
            <dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
              @for (s of shortcuts; track s.keys) {
                <dt><kbd class="bg-muted rounded px-1.5 py-0.5 text-xs">{{ s.keys }}</kbd></dt>
                <dd>{{ s.action | translate }}</dd>
              }
            </dl>
          </div>
        </div>
      </div>
    </div>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row" [style.--tree-w.px]="treeWidth.value()" [style.--list-w.px]="listWidth.value()">
      <nav class="min-h-0 flex-1 overflow-y-auto lg:w-(--tree-w) lg:flex-none lg:shrink-0" [class.max-lg:hidden]="stage() !== 'tree'" [attr.aria-label]="'notes.tree' | translate">
        <app-onenote-tree />
      </nav>
      <app-split-handle [label]="'notes.resizeTree' | translate" [width]="treeWidth.value()" [min]="200" [max]="420" [initial]="288" (widthChange)="treeWidth.set($event)" />

      <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:w-(--list-w) lg:flex-none lg:shrink-0" [class.max-lg:hidden]="stage() !== 'list'" [attr.aria-label]="'notes.pages' | translate">
        <app-onenote-pages (back)="backToTree()" (newPage)="openNew()" />
      </section>
      <app-split-handle [label]="'notes.resizePages' | translate" [width]="listWidth.value()" [min]="240" [max]="560" [initial]="340" (widthChange)="listWidth.set($event)" />

      <section class="min-h-0 min-w-0 flex-1 flex-col overflow-hidden" [class]="stage() === 'page' ? 'flex' : 'hidden lg:flex'" [attr.aria-label]="'notes.page' | translate">
        @if (store.pageId()) {
          <app-onenote-page-view (back)="store.closePage()" />
        } @else {
          <div class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
            <ng-icon name="lucideNotebook" class="text-2xl" aria-hidden="true" />
            {{ 'notes.select' | translate }}
          </div>
        }
      </section>
    </div>

    <hlm-dialog [state]="newOpen() ? 'open' : 'closed'" (closed)="newOpen.set(false)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-md">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ 'notes.newPage' | translate }}</h2>
          <p hlmDialogDescription>{{ 'notes.addedTo' | translate: { section: store.selectedSection()?.displayName ?? ('notes.thisSection' | translate) } }}</p>
        </hlm-dialog-header>
        <form class="flex flex-col gap-4" [attr.aria-busy]="creating()" (submit)="create($event)">
          <div class="flex flex-col gap-2">
            <label for="onenote-new-title" class="text-sm font-medium">{{ 'helply.list.title' | translate }}</label>
            <input
              #titleInput
              hlmInput
              id="onenote-new-title"
              required
              autocomplete="off"
              maxlength="255"
              [value]="newTitle()"
              (input)="newTitle.set(titleInput.value)"
              [placeholder]="'notes.untitledPage' | translate"
            />
          </div>
          <p class="text-destructive text-sm empty:hidden" role="alert">{{ newError() }}</p>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" type="button" [disabled]="creating()" (click)="newOpen.set(false)">{{ 'common.cancel' | translate }}</button>
            <button hlmBtn type="submit" [disabled]="!newTitle().trim() || creating()">
              @if (creating()) {
                <hlm-spinner aria-hidden="true" />
              }
              {{ 'notes.createPage' | translate }}
            </button>
          </hlm-dialog-footer>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class Notes {
  protected readonly store = inject(OneNoteStore);
  protected readonly accounts = inject(LinkedAccountsStore);
  protected readonly shortcuts = SHORTCUTS;
  protected readonly treeWidth = persistedNumber('schuly.onenote.tree', 288);
  protected readonly listWidth = persistedNumber('schuly.onenote.list', 340);

  protected readonly shortcutsOpen = signal(false);
  protected readonly newOpen = signal(false);
  protected readonly newTitle = signal('');
  protected readonly creating = signal(false);
  protected readonly newError = signal('');

  private readonly searchBox = viewChild<ElementRef<HTMLElement>>('searchBox');
  private readonly view = viewChild(OneNotePageView);

  /** Which single pane shows on narrow screens. */
  protected readonly stage = computed<'tree' | 'list' | 'page'>(() => {
    if (this.store.pageId()) return 'page';
    return this.store.selectedSectionId() || this.store.searchActive() ? 'list' : 'tree';
  });

  protected backToTree(): void {
    if (this.store.searchActive()) this.store.setQuery('');
    else this.store.clearSection();
  }

  protected openNew(): void {
    if (!this.store.canCreate()) return;
    this.newTitle.set('');
    this.newError.set('');
    this.newOpen.set(true);
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.newTitle().trim();
    if (!title || this.creating()) return;
    this.creating.set(true);
    this.newError.set('');
    const result = await this.store.createPage(title);
    this.creating.set(false);
    if (result.ok) this.newOpen.set(false);
    else this.newError.set(result.reason === 'readonly' ? t('notes.readOnlyNotebook') : result.reason === 'unsupported' ? t('notes.cannotAdd') : t('notes.createFailed'));
  }

  protected shortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    switch (event.key) {
      case '/':
        event.preventDefault();
        this.searchBox()?.nativeElement.querySelector('input')?.focus();
        break;
      case 'n':
        if (this.store.canCreate()) {
          event.preventDefault();
          this.openNew();
        }
        break;
      case 'e':
        if (this.store.page()?.writable) {
          event.preventDefault();
          this.view()?.startEdit();
        }
        break;
      case 'Delete':
        if (this.store.page()?.writable) {
          event.preventDefault();
          this.view()?.askDelete();
        }
        break;
    }
  }
}
