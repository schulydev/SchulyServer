import { Component, computed, input, output, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideX } from '@ng-icons/lucide';
import { PkAttachmentPreview, Attachment } from '@prompt-kit/attachment-preview';
import { PkComposer } from '@prompt-kit/composer';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { formatSize } from '../../core/chat-media';
import { ACCEPT_ATTR, canSendMessage, fileKind } from '../../core/helply-files';
import { DraftFile } from './helply-store';

export const MAX_LENGTH = 4000;
const COUNTER_FROM = 3500;

/**
 * The message box: a prompt-kit composer with attachments. Files can be picked, pasted or dropped; each starts
 * uploading right away and shows as a chip. Sending needs text or an uploaded file and no upload still running.
 */
@Component({
  selector: 'app-composer',
  imports: [HlmSpinner, NgIcon, PkAttachmentPreview, PkComposer],
  providers: [provideIcons({ lucideCircleAlert, lucideX })],
  host: {
    class: 'block px-4 pt-2 pb-4',
    '(paste)': 'onPaste($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
      @for (message of errors(); track message) {
        <p class="text-destructive text-xs" role="alert">{{ message }}</p>
      }
      <pk-composer
        #pk
        class="bg-background rounded-3xl border shadow-xs transition-colors"
        [class.border-ring]="dragging()"
        [class.bg-accent]="dragging()"
        [class.ring-3]="dragging()"
        [class.ring-ring]="dragging()"
        [(value)]="value"
        label="Message Helply"
        placeholder="Ask Helply something..."
        accept="{{ accept }}"
        [attachable]="true"
        [busy]="streaming()"
        [allowEmpty]="uploaded() > 0"
        [sendBlocked]="!canSend()"
        describedBy="helply-composer-hint"
        (submitted)="send.emit($event)"
        (stopped)="stop.emit()"
        (filesPicked)="attach.emit($event)"
      >
        <div pkComposerTop class="flex flex-col gap-2 empty:hidden">
          @if (dragging()) {
            <p class="text-primary text-sm font-medium">Drop files to attach them</p>
          }
          @if (ready().length) {
            <pk-attachment-preview
              [attachments]="ready()"
              (clicked)="preview.emit($event)"
              (removed)="removeDraft.emit($event)"
            />
          }
          @if (pending().length) {
            <ul class="flex flex-wrap gap-2" aria-label="Files being uploaded">
              @for (draft of pending(); track draft.key) {
                <li
                  class="bg-muted flex max-w-full items-center gap-2 rounded-lg border py-1 pr-1 pl-2.5 text-xs"
                  [class.border-destructive]="draft.status === 'error'"
                >
                  @if (draft.status === 'uploading') {
                    <hlm-spinner [attr.aria-label]="'Uploading ' + draft.name" />
                  } @else {
                    <ng-icon name="lucideCircleAlert" aria-hidden="true" class="text-destructive shrink-0 text-base" />
                  }
                  <span class="flex min-w-0 flex-col">
                    <span class="max-w-40 truncate font-medium" [attr.title]="draft.name">{{ draft.name }}</span>
                    @if (draft.status === 'error') {
                      <span class="text-destructive max-w-56 break-words">{{ draft.error }}</span>
                    } @else {
                      <span class="text-muted-foreground">{{ size(draft.size) }}</span>
                    }
                  </span>
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:ring-ring/50 rounded-md p-1 outline-none focus-visible:ring-3"
                    [attr.aria-label]="'Remove ' + draft.name"
                    (click)="removeDraft.emit(draft.key)"
                  >
                    <ng-icon name="lucideX" aria-hidden="true" />
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      </pk-composer>
      <div class="flex min-h-4 justify-between gap-2 px-2 text-xs">
        <span id="helply-composer-hint" class="text-muted-foreground">Enter to send, Shift+Enter for a new line.</span>
        @if (showCounter()) {
          <span [class]="tooLong() ? 'text-destructive font-medium' : 'text-muted-foreground'">
            {{ value().length }} / {{ max }}
            @if (tooLong()) {
              <span class="sr-only"> Message is too long</span>
            }
          </span>
        }
      </div>
    </div>
  `,
})
export class Composer {
  private readonly pk = viewChild.required<PkComposer>('pk');

  readonly streaming = input(false);
  readonly drafts = input<DraftFile[]>([]);
  readonly errors = input<string[]>([]);
  readonly send = output<string>();
  readonly stop = output();
  readonly attach = output<File[]>();
  readonly removeDraft = output<string>();
  /** A chip of an uploaded file was clicked (its draft key). */
  readonly preview = output<string>();

  protected readonly accept = ACCEPT_ATTR;
  protected readonly max = MAX_LENGTH;
  protected readonly value = signal('');
  protected readonly dragging = signal(false);
  protected readonly tooLong = computed(() => this.value().length > MAX_LENGTH);
  protected readonly showCounter = computed(() => this.value().length >= COUNTER_FROM);
  protected readonly uploaded = computed(() => this.drafts().filter((d) => d.status === 'done').length);

  protected readonly canSend = computed(() =>
    canSendMessage({
      text: this.value(),
      uploaded: this.uploaded(),
      uploading: this.drafts().filter((d) => d.status === 'uploading').length,
      tooLong: this.tooLong(),
    }),
  );

  /** Uploaded files, as prompt-kit attachments. */
  protected readonly ready = computed<Attachment[]>(() =>
    this.drafts()
      .filter((d) => d.status === 'done')
      .map((d) => ({ id: d.key, name: d.name, size: d.size, type: fileKind(d.name) === 'image' ? 'image' : 'file' })),
  );
  /** Files still uploading or that failed. */
  protected readonly pending = computed(() => this.drafts().filter((d) => d.status !== 'done'));

  focus(): void {
    this.pk().focus();
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  protected onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    this.attach.emit(files);
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []);
    this.dragging.set(false);
    if (!files.length) return;
    event.preventDefault();
    this.attach.emit(files);
  }
}
