import { ApplicationRef, Directive, ElementRef, EnvironmentInjector, Injector, afterRenderEffect, createComponent, inject, input, untracked } from '@angular/core';
import { ChatEmoji } from '../core/chat-emoji';
import { EmojiView } from './emoji-view';

/**
 * Fills the `.emoji-slot` spans that `renderBody` leaves in a message body (one per `<emoji key>` placeholder, in order)
 * with animated emoji components. Put it on the element whose `[innerHTML]` holds the body. The slots are rebuilt only when
 * the body HTML changes; each one keeps its unicode character as the fallback.
 */
@Directive({ selector: '[appEmojiSlots]' })
export class EmojiSlots {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly node = inject(Injector);
  private readonly app = inject(ApplicationRef);

  /** The body HTML; the slots are rebuilt whenever it changes. */
  readonly appEmojiSlots = input('');
  /** Message keys in slot order. */
  readonly keys = input<string[]>([]);
  readonly emojis = input<Record<string, ChatEmoji>>({});
  readonly size = input(24);

  constructor() {
    afterRenderEffect({
      write: (onCleanup) => {
        this.appEmojiSlots();
        const keys = untracked(this.keys);
        const map = untracked(this.emojis);
        const size = untracked(this.size);
        const slots = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.emoji-slot'));
        const undo: (() => void)[] = [];
        slots.forEach((slot, i) => {
          const emoji = map[keys[i] ?? ''];
          if (!emoji) return;
          const fallback = slot.textContent ?? '';
          const holder = document.createElement('span');
          slot.textContent = '';
          slot.append(holder);
          const ref = createComponent(EmojiView, { environmentInjector: this.injector, elementInjector: this.node, hostElement: holder });
          ref.setInput('emoji', emoji);
          ref.setInput('size', size);
          this.app.attachView(ref.hostView);
          undo.push(() => {
            ref.destroy();
            slot.textContent = fallback;
          });
        });
        onCleanup(() => undo.forEach((fn) => fn()));
      },
    });
  }
}
