import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowUp, lucideSquare } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmTextarea } from '@spartan-ng/helm/textarea';

export const MAX_LENGTH = 4000;
const COUNTER_FROM = 3500;

/** Enter sends; Shift+Enter inserts a newline; Enter while an IME is composing never sends. */
export function shouldSubmit(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

@Component({
  selector: 'app-composer',
  imports: [HlmButton, HlmTextarea, NgIcon],
  providers: [provideIcons({ lucideArrowUp, lucideSquare })],
  host: { class: 'bg-background block border-t px-4 py-3' },
  template: `
    <form class="mx-auto flex w-full max-w-3xl flex-col gap-1.5" (submit)="$event.preventDefault(); submit()">
      <div class="flex items-end gap-2">
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
  readonly send = output<string>();
  readonly stop = output();

  protected readonly max = MAX_LENGTH;
  protected readonly value = signal('');
  protected readonly tooLong = computed(() => this.value().length > MAX_LENGTH);
  protected readonly showCounter = computed(() => this.value().length >= COUNTER_FROM);
  protected readonly canSend = computed(() => !!this.value().trim() && !this.tooLong());

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
