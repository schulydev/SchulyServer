import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, output, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideExternalLink, lucideFileText, lucideLock, lucidePaperclip, lucidePencil, lucideSave, lucideTrash2, lucideX } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { AccountProblem } from '../../shared/account-problem';
import { OneNoteProblem, OneNotePageUpdate, OneNoteResource } from '../../stores/onenote.model';
import { OneNoteStore } from '../../stores/onenote.store';
import { OneNoteBody } from './onenote-body';
import { OneNoteEditor } from './onenote-editor';
import { editorText, normalizeEditorHtml } from './page-html';
import { AppDatePipe } from '../../core/date-format';

const SAVE_ERRORS: Record<OneNoteProblem, string> = {
  readonly: 'notes.save.readonly',
  expired: 'notes.save.expired',
  missing: 'notes.save.missing',
  unsupported: 'notes.save.unsupported',
  failed: 'notes.save.failed',
};

/** The right pane: header, attachments and either the sandboxed page or the editors. */
@Component({
  selector: 'app-onenote-page-view',
  imports: [TranslatePipe, AppDatePipe, HlmAlertDialogImports, HlmButton, HlmInput, HlmSkeletonImports, AccountProblem, NgIcon, OneNoteBody, OneNoteEditor],
  providers: [provideIcons({ lucideArrowLeft, lucideExternalLink, lucideFileText, lucideLock, lucidePaperclip, lucidePencil, lucideSave, lucideTrash2, lucideX })],
  host: { class: '@container flex min-h-0 min-w-0 flex-1 flex-col', '(keydown)': 'onKey($event)' },
  template: `
    @if (store.page(); as page) {
      <div class="flex shrink-0 flex-col gap-2 border-b px-4 py-3 lg:px-6">
        <div class="flex items-start gap-2">
          <button hlmBtn variant="ghost" size="icon-sm" type="button" class="lg:hidden" (click)="back.emit()">
            <ng-icon name="lucideArrowLeft" aria-hidden="true" />
            <span class="sr-only">{{ 'notes.back' | translate }}</span>
          </button>
          <div class="min-w-0 flex-1">
            @if (editing()) {
              <label for="onenote-title" class="sr-only">{{ 'notes.pageTitle' | translate }}</label>
              <input
                hlmInput
                id="onenote-title"
                class="h-10 text-lg font-semibold"
                autocomplete="off"
                maxlength="255"
                [value]="titleDraft()"
                (input)="titleDraft.set(titleInput.value)"
                #titleInput
              />
            } @else {
              <h3 #title tabindex="-1" class="text-xl leading-tight font-semibold tracking-tight wrap-anywhere outline-none">
                {{ page.title || ('notes.untitledPage' | translate) }}
              </h3>
            }
            <p class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 text-xs">
              @if (page.notebook || page.section) {
                <span class="min-w-0 truncate">{{ page.notebook?.displayName }}@if (page.notebook && page.section) { / }{{ page.section?.displayName }}</span>
              }
              @if (page.lastModifiedDateTime; as modified) {
                <time [attr.datetime]="modified">{{ 'notes.modified' | translate: { date: (modified | appDate: 'weekdayDateTime') } }}</time>
              }
              @if (!page.writable) {
                <span class="inline-flex items-center gap-1">
                  <ng-icon name="lucideLock" aria-hidden="true" />
                  {{ 'notes.readOnly' | translate }}
                </span>
              }
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
            @if (editing()) {
              <button hlmBtn size="sm" type="button" aria-keyshortcuts="Control+S Meta+S" [disabled]="saving() || !dirty()" (click)="save()">
                <ng-icon name="lucideSave" aria-hidden="true" />
                {{ saving() ? ('notes.saving' | translate) : ('common.save' | translate) }}
              </button>
              <button hlmBtn size="sm" variant="ghost" type="button" aria-keyshortcuts="Escape" [disabled]="saving()" (click)="cancel()">
                <ng-icon name="lucideX" aria-hidden="true" />
                {{ 'common.cancel' | translate }}
              </button>
            } @else {
              @if (page.webUrl; as link) {
                <a hlmBtn size="sm" variant="ghost" [href]="link" target="_blank" rel="noopener noreferrer">
                  <ng-icon name="lucideExternalLink" aria-hidden="true" />
                  <span class="@max-3xl:sr-only">{{ 'notes.openOneNote' | translate }}</span>
                  <span class="sr-only">{{ 'common.opensNewTab' | translate }}</span>
                </a>
              }
              @if (page.writable) {
                <button #editButton hlmBtn size="sm" variant="ghost" type="button" aria-keyshortcuts="e" [title]="('common.edit' | translate) + ' (E)'" (click)="startEdit()">
                  <ng-icon name="lucidePencil" aria-hidden="true" />
                  <span class="@max-3xl:sr-only">{{ 'common.edit' | translate }}</span>
                </button>
                <button hlmBtn size="sm" variant="ghost" type="button" aria-keyshortcuts="Delete" [title]="('common.delete' | translate) + ' (Delete)'" (click)="askDelete()">
                  <ng-icon name="lucideTrash2" aria-hidden="true" />
                  <span class="@max-3xl:sr-only">{{ 'common.delete' | translate }}</span>
                </button>
              }
            }
          </div>
        </div>
        <p class="text-destructive text-sm empty:hidden" role="alert">{{ saveError() }}</p>
        @if (files().length && !editing()) {
          <ul class="flex flex-wrap gap-2" [attr.aria-label]="'mail.attachments' | translate">
            @for (file of files(); track file.id) {
              <li>
                <button hlmBtn variant="outline" size="sm" type="button" (click)="download(file)">
                  <ng-icon name="lucidePaperclip" aria-hidden="true" />
                  {{ file.name || ('chat.attachment' | translate) }}
                  <span class="sr-only">{{ 'notes.download' | translate }}</span>
                </button>
              </li>
            }
          </ul>
        }
      </div>

      @if (editing()) {
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
          @for (outline of page.outlines; track outline.id; let i = $index) {
            @if (outline.editable) {
              <app-onenote-editor [label]="'Text box ' + (i + 1)" [html]="outline.html" (changed)="draft(outline.id, $event)" />
            } @else {
              <section class="flex flex-col gap-2" [attr.aria-label]="'notes.box' | translate: { number: i + 1 }">
                <p class="text-muted-foreground flex items-center gap-2 text-sm">
                  <ng-icon name="lucideLock" aria-hidden="true" />
                  {{ 'notes.inkBox' | translate }}
                </p>
                <div class="flex h-48 min-w-0 flex-col">
                  <app-onenote-body [html]="outline.html" [resources]="page.resources" [title]="'notes.boxPreview' | translate: { number: i + 1 }" />
                </div>
              </section>
            }
          }
          <div class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">{{ 'notes.addText' | translate }}</h3>
            <app-onenote-editor [label]="'notes.addText' | translate" (changed)="appendDraft.set($event)" />
          </div>
        </div>
      } @else {
        <div class="flex min-h-0 flex-1 flex-col p-4 lg:p-6">
          <app-onenote-body [html]="page.html" [width]="page.width" [height]="page.height" [resources]="page.resources" [title]="'Content of ' + (page.title || ('notes.untitledPage' | translate))" />
        </div>
      }
    } @else if (store.pageProblem(); as problem) {
      <div class="flex items-center gap-2 border-b px-4 py-3 lg:hidden">
        <button hlmBtn variant="ghost" size="icon-sm" type="button" (click)="back.emit()">
          <ng-icon name="lucideArrowLeft" aria-hidden="true" />
          <span class="sr-only">{{ 'notes.back' | translate }}</span>
        </button>
      </div>
      <div class="p-4">
        @if (problem === 'unsupported') {
          <p class="text-sm">{{ 'notes.cannotShow' | translate }}</p>
        } @else {
          <app-account-problem [problem]="problem === 'expired' || problem === 'missing' ? problem : 'failed'" />
        }
      </div>
    } @else {
      <div class="flex flex-col gap-3 p-4 lg:p-6" role="status" [attr.aria-label]="'notes.loadingPage' | translate">
        <div class="flex items-center gap-2">
          <button hlmBtn variant="ghost" size="icon-sm" type="button" class="lg:hidden" (click)="back.emit()">
            <ng-icon name="lucideArrowLeft" aria-hidden="true" />
            <span class="sr-only">{{ 'notes.back' | translate }}</span>
          </button>
          <h3 class="min-w-0 truncate text-xl font-semibold">{{ store.pageHint()?.title || ('notes.loadingPage' | translate) }}</h3>
        </div>
        <hlm-skeleton class="h-4 w-full" />
        <hlm-skeleton class="h-4 w-11/12" />
        <hlm-skeleton class="h-4 w-4/5" />
        <hlm-skeleton class="h-40 w-full" />
      </div>
    }

    <hlm-alert-dialog [state]="deleteOpen() ? 'open' : 'closed'" (closed)="deleteOpen.set(false)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h2 hlmAlertDialogTitle>{{ 'notes.deleteTitle' | translate }}</h2>
          <p hlmAlertDialogDescription>
            {{ 'notes.deleteHint' | translate: { title: store.page()?.title || ('notes.thisPage' | translate) } }}
          </p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel>{{ 'common.cancel' | translate }}</button>
          <button hlmAlertDialogAction variant="destructive" class="bg-destructive! text-white! hover:bg-destructive/90! dark:text-black!" (click)="remove()">{{ 'common.delete' | translate }}</button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class OneNotePageView {
  protected readonly store = inject(OneNoteStore);
  private readonly injector = inject(Injector);

  readonly back = output<void>();

  private readonly titleEl = viewChild<ElementRef<HTMLElement>>('title');
  private readonly editButton = viewChild<ElementRef<HTMLElement>>('editButton');

  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');
  protected readonly deleteOpen = signal(false);
  protected readonly titleDraft = signal('');
  protected readonly outlineDrafts = signal<Record<string, string>>({});
  protected readonly appendDraft = signal('');

  protected readonly files = computed<OneNoteResource[]>(() => this.store.page()?.resources.filter((r) => r.kind === 'file') ?? []);

  private readonly baselines = computed(() => {
    const map: Record<string, string> = {};
    for (const o of this.store.page()?.outlines ?? []) if (o.editable) map[o.id] = normalizeEditorHtml(o.html);
    return map;
  });

  private readonly changedOutlines = computed(() => {
    const baselines = this.baselines();
    const drafts = this.outlineDrafts();
    return Object.entries(drafts).filter(([id, html]) => id in baselines && html !== baselines[id]);
  });

  protected readonly dirty = computed(() => {
    const page = this.store.page();
    if (!page) return false;
    const title = this.titleDraft().trim();
    return (!!title && title !== page.title) || this.changedOutlines().length > 0 || editorText(this.appendDraft()).length > 0;
  });

  constructor() {
    // A different page, or the same one replaced by a save, ends editing and moves focus to the title.
    effect(() => {
      const id = this.store.pageId();
      untracked(() => {
        this.editing.set(false);
        this.saveError.set('');
        this.deleteOpen.set(false);
        if (id) afterNextRender(() => this.titleEl()?.nativeElement.focus(), { injector: this.injector });
      });
    });
  }

  protected draft(id: string, html: string): void {
    this.outlineDrafts.update((d) => ({ ...d, [id]: html }));
  }

  startEdit(): void {
    const page = this.store.page();
    if (!page?.writable || this.editing()) return;
    this.titleDraft.set(page.title);
    this.outlineDrafts.set({});
    this.appendDraft.set('');
    this.saveError.set('');
    this.editing.set(true);
    afterNextRender(() => document.getElementById('onenote-title')?.focus(), { injector: this.injector });
  }

  cancel(): void {
    if (!this.editing() || this.saving()) return;
    this.editing.set(false);
    this.saveError.set('');
    afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
  }

  askDelete(): void {
    if (this.store.page()?.writable && !this.editing()) this.deleteOpen.set(true);
  }

  protected async save(): Promise<void> {
    const page = this.store.page();
    if (!page || !this.editing() || this.saving() || !this.dirty()) return;
    const update: OneNotePageUpdate = {};
    const title = this.titleDraft().trim();
    if (title && title !== page.title) update.title = title;
    const outlines = this.changedOutlines().map(([id, html]) => ({ id, html }));
    if (outlines.length) update.outlines = outlines;
    if (editorText(this.appendDraft())) update.append = this.appendDraft();
    this.saving.set(true);
    this.saveError.set('');
    const result = await this.store.savePage(update);
    this.saving.set(false);
    if (result.ok) {
      this.editing.set(false);
      toast.success(t('notes.saved'));
      afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
    } else {
      this.saveError.set(t(SAVE_ERRORS[result.reason]));
    }
  }

  protected async remove(): Promise<void> {
    this.deleteOpen.set(false);
    const result = await this.store.deletePage();
    if (result.ok) toast.success(t('notes.deleted'));
    else toast.error(t(result.reason === 'readonly' ? SAVE_ERRORS.readonly : 'notes.deleteFailed'));
  }

  protected async download(file: OneNoteResource): Promise<void> {
    const name = file.name || 'attachment';
    const ok = await this.store.downloadFile(file.id, name);
    if (ok) toast.success(`Downloaded ${name}.`);
    else toast.error(t('mail.downloadFailed', { name }));
  }

  protected onKey(event: KeyboardEvent): void {
    if (!this.editing()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.save();
    } else if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
  }
}

