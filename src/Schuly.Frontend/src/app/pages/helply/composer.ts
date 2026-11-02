import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowUp,
  lucideCircleAlert,
  lucideFile,
  lucideFileSpreadsheet,
  lucideFileText,
  lucideImage,
  lucidePaperclip,
  lucidePresentation,
  lucideSquare,
  lucideX,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { formatSize } from '../../core/chat-media';
import { ACCEPT_ATTR, canSendMessage, fileIcon } from '../../core/helply-files';
import { DraftFile } from './helply-store';

export const MAX_LENGTH = 4000;
const COUNTER_FROM = 3500;

/** Enter sends; Shift+Enter inserts a newline; Enter while an IME is composing never sends. */
export function shouldSubmit(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

@Component({
  selector: 'app-composer',
  imports: [HlmButton, HlmSpinner, HlmTextarea, NgIcon],
  providers: [
    provideIcons({
      lucideArrowUp,
      lucideCircleAlert,
      lucideFile,
      lucideFileSpreadsheet,
      lucideFileText,
      lucideImage,
      lucidePaperclip,
      lucidePresentation,
      lucideSquare,
      lucideX,
    }),
  ],
  host: {
    class: 'bg-background block border-t px-4 py-3',
    '[class.ring-2]': 'dragging()',
    '[class.ring-ring]': 'dragging()',
    '[class.ring-inset]': 'dragging()',
    '[class.bg-accent]': 'dragging()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    <form class="mx-auto flex w-full max-w-3xl flex-col gap-1.5" (submit)="$event.preventDefault(); submit()">
      @if (dragging()) {
        <p class="text-primary text-center text-sm font-medium">Drop files to attach them</p>
      }
      @if (drafts().length) {
        <ul class="flex flex-wrap gap-2" aria-label="Attached files">
          @for (draft of drafts(); track draft.key) {
            <li
              class="bg-muted flex max-w-full items-center gap-2 rounded-lg border py-1 pr-1 pl-2.5 text-xs"
              [class.border-destructive]="draft.status === 'error'"
            >
              @if (draft.status === 'uploading') {
                <hlm-spinner [attr.aria-label]="'Uploading ' + draft.name" />
              } @else if (draft.status === 'error') {
                <ng-icon name="lucideCircleAlert" aria-hidden="true" class="text-destructive shrink-0 text-base" />
              } @else {
                <ng-icon [name]="icon(draft.name)" aria-hidden="true" class="shrink-0 text-base" />
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
      @for (message of errors(); track message) {
        <p class="text-destructive text-xs" role="alert">{{ message }}</p>
      }
      <div class="flex items-end gap-2">
        <input
          #picker
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          [accept]="accept"
          (change)="onPicked(picker)"
        />
        <button hlmBtn type="button" variant="outline" size="icon-lg" aria-label="Attach files" (click)="picker.click()">
          <ng-icon name="lucidePaperclip" aria-hidden="true" />
        </button>
        <label for="helply-composer" class="sr-only">Message Helply</label>
        <textarea
          #box
          hlmTextarea
          id="helply-composer"
          rows="1"
          autocomplete="off"
          placeholder="Ask Helply something..."
          aria-describedby="helply-composer-hint"
          class="max-h-48 min-h-10 flex-1 resize-none py-2"
          [attr.aria-invalid]="tooLong() ? 'true' : null"
          [attr.aria-readonly]="streaming() ? 'true' : null"
          [readOnly]="streaming()"
          [value]="value()"
          (input)="onInput(box.value)"
          (keydown)="onKeydown($event)"
          (paste)="onPaste($event)"
        ></textarea>
        @if (streaming()) {
          <button hlmBtn type="button" variant="outline" size="icon-lg" aria-label="Stop generating" (click)="stop.emit()">
            <ng-icon name="lucideSquare" aria-hidden="true" />
          </button>
        } @else {
          <button hlmBtn type="submit" size="icon-lg" aria-label="Send message" [disabled]="!canSend()">
            <ng-icon name="lucideArrowUp" aria-hidden="true" />
          </button>
        }
      </div>
      <div class="flex min-h-4 justify-between gap-2 text-xs">
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
    </form>
  `,
})
export class Composer {
  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  readonly streaming = input(false);
  readonly drafts = input<DraftFile[]>([]);
  readonly errors = input<string[]>([]);
  readonly send = output<string>();
  readonly stop = output();
  readonly attach = output<File[]>();
  readonly removeDraft = output<string>();

  protected readonly accept = ACCEPT_ATTR;
  protected readonly dragging = signal(false);

  protected readonly max = MAX_LENGTH;
  protected readonly value = signal('');
  protected readonly tooLong = computed(() => this.value().length > MAX_LENGTH);
  protected readonly showCounter = computed(() => this.value().length >= COUNTER_FROM);
  protected readonly canSend = computed(() =>
    canSendMessage({
      text: this.value(),
      uploaded: this.drafts().filter((d) => d.status === 'done').length,
      uploading: this.drafts().filter((d) => d.status === 'uploading').length,
      tooLong: this.tooLong(),
    }),
  );

  protected icon(name: string): string {
    return fileIcon(name);
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  protected onPicked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.attach.emit(files);
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

  focus(): void {
    this.box().nativeElement.focus();
  }

  protected onInput(text: string): void {
    this.value.set(text);
    this.grow();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!shouldSubmit(event)) return;
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    if (this.streaming() || !this.canSend()) return;
    this.send.emit(this.value().trim());
    this.value.set('');
    this.box().nativeElement.value = '';
    this.grow();
    this.focus();
  }

  private grow(): void {
    const el = this.box().nativeElement;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
}
