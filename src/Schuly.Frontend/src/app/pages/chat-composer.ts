import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBold,
  lucideCircleAlert,
  lucideCode,
  lucideFile,
  lucideItalic,
  lucideLink,
  lucideList,
  lucideListOrdered,
  lucidePaperclip,
  lucidePlus,
  lucideQuote,
  lucideSend,
  lucideSmile,
  lucideSquareCode,
  lucideStrikethrough,
  lucideTriangleAlert,
  lucideType,
  lucideUnderline,
  lucideVideo,
  lucideX,
  lucideCalendarClock,
  lucideCalendarPlus,
  lucideBellRing,
} from '@ng-icons/lucide';
import { BrnPopover } from '@spartan-ng/brain/popover';
import type { BrnOverlayState } from '@spartan-ng/brain/overlay';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmPopoverImports } from '@spartan-ng/helm/popover';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { Importance, formatSize } from '../core/chat-media';
import { Composed, compose } from '../core/rich-html';
import { Gif } from '../core/chat-api';
import { ChatApi } from '../core/chat-api';
import { ChatEmoji, emojiQueryAt, normalizeShortcut, searchShortcuts } from '../core/chat-emoji';
import { Outgoing, ChatStore } from '../stores/chat.store';
import { ClipDialog } from './chat-clip-dialog';
import { DeliveryDialog, MeetingDialog, ScheduleDialog } from './chat-dialogs';
import { EmojiPicker, FIRST_SCREEN_EMOJI } from './chat-emoji-picker';

export const MAX_LENGTH = 4000;
export const MAX_INLINE_BYTES = 3 * 1024 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 10;
const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

interface ComposerChat {
  id: string;
  title: string;
  mentionable: { id: string; name: string }[];
}

interface Suggestion {
  key: string;
  label: string;
  /** Member id, for mention suggestions. */
  userId?: string;
  /** Teams emoji, for suggestions from the catalogue. */
  teams?: ChatEmoji;
}

interface SuggestState {
  kind: 'emoji' | 'mention';
  items: Suggestion[];
  node: Text;
  start: number;
  end: number;
}

const EMPTY: Composed = { html: '', text: '', mentions: [], imageIds: [], plain: true, empty: true };

/** The chat composer: rich editor, formatting toolbar, emoji and GIF picker, attachments, mentions, and the "+" actions. */
@Component({
  selector: 'app-chat-composer',
  imports: [NgIcon, HlmButton, HlmDropdownMenuImports, HlmPopoverImports, HlmSpinner, EmojiPicker, ScheduleDialog, DeliveryDialog, MeetingDialog, ClipDialog],
  providers: [
    provideIcons({
      lucideBold,
      lucideCircleAlert,
      lucideCode,
      lucideFile,
      lucideItalic,
      lucideLink,
      lucideList,
      lucideListOrdered,
      lucidePaperclip,
      lucidePlus,
      lucideQuote,
      lucideSend,
      lucideSmile,
      lucideSquareCode,
      lucideStrikethrough,
      lucideTriangleAlert,
      lucideType,
      lucideUnderline,
      lucideVideo,
      lucideX,
      lucideCalendarClock,
      lucideCalendarPlus,
      lucideBellRing,
    }),
  ],
  styles: `
    .editor:focus {
      outline: none;
    }
    .editor ul {
      list-style: disc;
      padding-inline-start: 1.25rem;
    }
    .editor ol {
      list-style: decimal;
      padding-inline-start: 1.25rem;
    }
    .editor blockquote {
      border-inline-start: 2px solid var(--border);
      padding-inline-start: 0.75rem;
      color: var(--muted-foreground);
    }
    .editor pre {
      font-family: var(--font-mono, monospace);
      background: var(--muted);
      border-radius: 0.375rem;
      padding: 0.25rem 0.5rem;
      white-space: pre-wrap;
    }
    .editor code {
      font-family: var(--font-mono, monospace);
      background: var(--muted);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
    }
    .editor a {
      text-decoration: underline;
      font-weight: 500;
    }
    .editor img {
      display: inline-block;
      max-height: 8rem;
      max-width: 100%;
      border-radius: 0.375rem;
      vertical-align: bottom;
    }
    .editor img[data-emoji-id] {
      height: 1.5rem;
      width: 1.5rem;
      max-height: none;
      vertical-align: middle;
    }
    .editor .mention {
      background: color-mix(in oklab, var(--primary) 15%, transparent);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
      font-weight: 500;
    }
  `,
  template: `
    @if (importance() !== 'normal' || files().length) {
      <ul class="mb-1.5 flex flex-wrap gap-1.5" aria-label="Message options and attachments">
        @if (importance() !== 'normal') {
          <li
            class="flex items-center gap-1 rounded-full border py-0.5 ps-2 pe-0.5 text-xs font-semibold"
            [class]="importance() === 'urgent' ? 'border-red-700 bg-red-100 text-red-900 dark:border-red-300 dark:bg-red-950 dark:text-red-100' : 'border-amber-700 bg-amber-100 text-amber-900 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-100'"
          >
            <ng-icon [name]="importance() === 'urgent' ? 'lucideTriangleAlert' : 'lucideCircleAlert'" aria-hidden="true" />
            {{ importance() === 'urgent' ? 'Urgent' : 'Important' }}
            <button type="button" class="hover:bg-foreground/10 focus-visible:outline-ring rounded-full p-0.5 focus-visible:outline-2" (click)="importance.set('normal')">
              <ng-icon name="lucideX" aria-hidden="true" />
              <span class="sr-only">Remove delivery option</span>
            </button>
          </li>
        }
        @for (f of files(); track f) {
          <li class="bg-muted flex max-w-full items-center gap-1.5 rounded-md py-0.5 ps-2 pe-0.5 text-xs">
            <ng-icon [name]="f.type.startsWith('video/') ? 'lucideVideo' : 'lucideFile'" class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate font-medium">{{ f.name }}</span>
            <span class="text-foreground/70 shrink-0">{{ size(f.size) }}</span>
            <button type="button" class="hover:bg-foreground/10 focus-visible:outline-ring rounded-md p-0.5 focus-visible:outline-2" (click)="removeFile(f)">
              <ng-icon name="lucideX" aria-hidden="true" />
              <span class="sr-only">Remove {{ f.name }}</span>
            </button>
          </li>
        }
      </ul>
    }

    <div class="bg-background focus-within:border-ring focus-within:ring-ring/30 relative rounded-lg border focus-within:ring-3" [class.border-dashed]="dragging()">
      @if (suggest(); as sg) {
        <ul
          id="composer-suggestions"
          role="listbox"
          [attr.aria-label]="sg.kind === 'emoji' ? 'Emoji suggestions' : 'Mention suggestions'"
          class="bg-popover text-popover-foreground absolute start-0 bottom-full z-20 mb-1 w-72 max-w-full overflow-hidden rounded-lg border p-1 shadow-md"
        >
          @for (item of sg.items; track item.key; let i = $index) {
            <li
              role="option"
              class="flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-sm"
              [class.bg-accent]="i === active()"
              [class.text-accent-foreground]="i === active()"
              [id]="'composer-option-' + i"
              [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault(); accept(item)"
            >
              @if (item.teams; as t) {
                @if (t.staticUrl) {
                  <img [src]="t.staticUrl" alt="" width="22" height="22" referrerpolicy="no-referrer" />
                }
                <span class="truncate"><span class="sr-only">{{ t.label }} </span>:{{ item.label }}:</span>
              } @else {
                <span class="truncate">{{ item.label }}</span>
              }
            </li>
          }
        </ul>
      }
      <div class="sr-only" role="status" aria-live="polite">{{ suggestionStatus() }}</div>

      @if (formatOpen()) {
        <div role="toolbar" aria-label="Formatting" class="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
          @for (f of formats; track f.id) {
            <button
              hlmBtn
              type="button"
              variant="ghost"
              size="icon-sm"
              [attr.aria-pressed]="activeFormats().has(f.id)"
              [class.bg-accent]="activeFormats().has(f.id)"
              (mousedown)="$event.preventDefault()"
              (click)="format(f.id)"
            >
              <ng-icon [name]="f.icon" aria-hidden="true" />
              <span class="sr-only">{{ f.label }}</span>
            </button>
          }
        </div>
        @if (linkOpen()) {
          <form class="flex items-center gap-2 border-b px-2 py-1.5" (submit)="applyLink($event)">
            <label class="sr-only" for="composer-link">Link address</label>
            <input
              #linkInput
              id="composer-link"
              type="url"
              inputmode="url"
              placeholder="https://"
              autocomplete="off"
              class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
              [value]="linkUrl()"
              (input)="linkUrl.set($any($event.target).value)"
              (keydown.escape)="closeLink()"
            />
            <button hlmBtn type="submit" size="sm" variant="secondary">Add link</button>
            <button hlmBtn type="button" size="sm" variant="ghost" (click)="closeLink()">Cancel</button>
          </form>
        }
      }

      <div class="relative px-3 py-2">
        @if (composed().empty) {
          <span class="text-muted-foreground pointer-events-none absolute start-3 top-2 text-sm leading-6" aria-hidden="true">Type a message</span>
        }
        <div
          #editor
          class="editor max-h-48 min-h-6 overflow-y-auto text-sm leading-6 wrap-anywhere"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          aria-autocomplete="list"
          [attr.aria-controls]="suggest() ? 'composer-suggestions' : null"
          [attr.aria-label]="'Message ' + chat().title"
          [attr.aria-activedescendant]="suggest() ? 'composer-option-' + active() : null"
          (input)="onInput()"
          (keydown)="onKeydown($event)"
          (paste)="onPaste($event)"
          (dragover)="onDragOver($event)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)"
          (blur)="closeSuggestions()"
        ></div>
      </div>

      <div role="toolbar" aria-label="Message actions" class="flex items-center gap-0.5 px-1.5 pb-1.5">
        <button hlmBtn type="button" variant="ghost" size="icon-sm" [attr.aria-pressed]="formatOpen()" [class.bg-accent]="formatOpen()" (mousedown)="$event.preventDefault()" (click)="toggleFormat()">
          <ng-icon name="lucideType" aria-hidden="true" />
          <span class="sr-only">Format</span>
        </button>

        <hlm-popover align="start" sideOffset="8" [state]="emojiState()" (stateChanged)="emojiState.set($event)">
          <button hlmBtn hlmPopoverTrigger [hlmPopoverTriggerFor]="emojiPopover()" type="button" variant="ghost" size="icon-sm" (mousedown)="$event.preventDefault()" (pointerenter)="warmEmoji()" (focus)="warmEmoji()">
            <ng-icon name="lucideSmile" aria-hidden="true" />
            <span class="sr-only">{{ api.gifsAvailable() === false ? 'Emoji' : 'Emoji and GIFs' }}</span>
          </button>
          <hlm-popover-content *hlmPopoverPortal="let ctx" class="w-88 max-w-[calc(100vw-4.5rem)] p-2">
            <app-emoji-picker (emoji)="insertEmoji($event)" (gif)="sendGif($event)" />
          </hlm-popover-content>
        </hlm-popover>

        <button hlmBtn type="button" variant="ghost" size="icon-sm" (click)="picker.click()">
          <ng-icon name="lucidePaperclip" aria-hidden="true" />
          <span class="sr-only">Attach files</span>
        </button>
        <input #picker type="file" multiple class="hidden" tabindex="-1" aria-hidden="true" (change)="onPicked($event)" />

        <button hlmBtn type="button" variant="ghost" size="icon-sm" [hlmDropdownMenuTrigger]="plusMenu" align="start">
          <ng-icon name="lucidePlus" aria-hidden="true" />
          <span class="sr-only">More actions</span>
        </button>

        <span class="flex-1"></span>
        @if (composed().text.length > maxLength - 200) {
          <span class="text-muted-foreground me-1 text-xs tabular-nums" [class.text-destructive]="composed().text.length > maxLength">{{ composed().text.length }} / {{ maxLength }}</span>
        }
        <button hlmBtn type="button" variant="ghost" size="icon-sm" [class]="canSend() ? 'text-primary' : 'text-muted-foreground'" [disabled]="!canSend()" (click)="submit()">
          @if (sending()) {
            <hlm-spinner aria-label="Sending" />
          } @else {
            <ng-icon name="lucideSend" aria-hidden="true" />
          }
          <span class="sr-only">Send</span>
        </button>
      </div>
    </div>

    <ng-template #plusMenu>
      <hlm-dropdown-menu class="w-56" aria-label="More actions">
        <button hlmDropdownMenuItem type="button" (click)="scheduleOpen.set(true)">
          <ng-icon name="lucideCalendarClock" aria-hidden="true" />
          Schedule message
        </button>
        <button hlmDropdownMenuItem type="button" (click)="deliveryOpen.set(true)">
          <ng-icon name="lucideBellRing" aria-hidden="true" />
          Delivery options
        </button>
        <button hlmDropdownMenuItem type="button" (click)="meetingOpen.set(true)">
          <ng-icon name="lucideCalendarPlus" aria-hidden="true" />
          Schedule meeting
        </button>
        <button hlmDropdownMenuItem type="button" (click)="clipOpen.set(true)">
          <ng-icon name="lucideVideo" aria-hidden="true" />
          Record video clip
        </button>
      </hlm-dropdown-menu>
    </ng-template>

    <app-schedule-dialog
      [(open)]="scheduleOpen"
      [chatId]="chat().id"
      [content]="scheduleContent()"
      [contentType]="composed().plain ? 'text' : 'html'"
      [importance]="importance()"
      [blocked]="scheduleBlocked()"
      (scheduled)="afterScheduled()"
    />
    <app-delivery-dialog [(open)]="deliveryOpen" [(importance)]="importance" />
    <app-meeting-dialog [(open)]="meetingOpen" [chatId]="chat().id" [chatTitle]="chat().title" />
    <app-clip-dialog [(open)]="clipOpen" (clip)="addFiles([$event])" />
  `,
  host: { class: 'block' },
})
export class ChatComposer {
  private readonly store = inject(ChatStore);
  protected readonly api = inject(ChatApi);
  private readonly injector = inject(Injector);

  readonly chat = input.required<ComposerChat>();
  readonly sent = output<void>();

  protected readonly maxLength = MAX_LENGTH;
  protected readonly size = formatSize;
  protected readonly formats = [
    { id: 'bold', label: 'Bold', icon: 'lucideBold' },
    { id: 'italic', label: 'Italic', icon: 'lucideItalic' },
    { id: 'underline', label: 'Underline', icon: 'lucideUnderline' },
    { id: 'strike', label: 'Strikethrough', icon: 'lucideStrikethrough' },
    { id: 'ul', label: 'Bulleted list', icon: 'lucideList' },
    { id: 'ol', label: 'Numbered list', icon: 'lucideListOrdered' },
    { id: 'link', label: 'Link', icon: 'lucideLink' },
    { id: 'code', label: 'Inline code', icon: 'lucideCode' },
    { id: 'pre', label: 'Code block', icon: 'lucideSquareCode' },
    { id: 'quote', label: 'Quote', icon: 'lucideQuote' },
  ];

  private readonly editor = viewChild.required<ElementRef<HTMLElement>>('editor');
  private readonly linkInput = viewChild<ElementRef<HTMLInputElement>>('linkInput');
  protected readonly emojiPopover = viewChild.required(BrnPopover);
  private warmed = false;

  protected readonly composed = signal<Composed>(EMPTY);
  protected readonly formatOpen = signal(false);
  protected readonly activeFormats = signal<ReadonlySet<string>>(new Set());
  protected readonly importance = signal<Importance>('normal');
  protected readonly files = signal<File[]>([]);
  protected readonly dragging = signal(false);
  protected readonly emojiState = signal<BrnOverlayState>('closed');
  protected readonly linkOpen = signal(false);
  protected readonly linkUrl = signal('');
  protected readonly scheduleOpen = signal(false);
  protected readonly deliveryOpen = signal(false);
  protected readonly meetingOpen = signal(false);
  protected readonly clipOpen = signal(false);
  protected readonly suggest = signal<SuggestState | null>(null);
  protected readonly active = signal(0);

  /** Inline images by their `data-inline-id`, with the object URL shown in the editor. */
  private readonly inline = new Map<string, { file: File; url: string }>();
  private inlineCounter = 0;
  private saved: Range | null = null;

  /** Only the id: the chat object is rebuilt on every refresh and must not reset the draft. */
  private readonly chatId = computed(() => this.chat().id);
  protected readonly sending = computed(() => this.store.pending().some((p) => p.status === 'sending'));
  protected readonly canSend = computed(() => (!this.composed().empty || this.files().length > 0) && !this.sending());
  protected readonly suggestionStatus = computed(() => {
    const n = this.suggest()?.items.length ?? 0;
    return n ? `${n} ${this.suggest()?.kind === 'emoji' ? 'emoji' : 'member'} ${n === 1 ? 'suggestion' : 'suggestions'} available. Use up and down arrows, Enter to insert.` : '';
  });
  protected readonly scheduleBlocked = computed(() => {
    const c = this.composed();
    if (c.empty) return 'Write a message first, then schedule it.';
    if (this.files().length || c.imageIds.length) return 'Scheduled messages can only hold text and formatting. Remove attachments and images to schedule this one.';
    if (c.mentions.length) return 'Scheduled messages cannot contain mentions. Remove them to schedule this one.';
    return null;
  });
  protected readonly scheduleContent = computed(() => (this.composed().plain ? this.composed().text : this.composed().html));

  constructor() {
    // Ready before the picker or a shortcut needs it: from this browser after the first visit.
    afterNextRender(() => void this.api.catalogue());
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const onSelection = () => this.onSelectionChange();
      document.addEventListener('selectionchange', onSelection);
      destroy.onDestroy(() => document.removeEventListener('selectionchange', onSelection));
    });
    destroy.onDestroy(() => this.revokeInline());

    // A different chat starts empty with the editor focused.
    effect(() => {
      this.chatId();
      untracked(() =>
        afterNextRender(
          () => {
            this.reset();
            this.focus();
          },
          { injector: this.injector },
        ),
      );
    });
  }

  focus(): void {
    this.editor().nativeElement.focus();
  }

  // --- selection --------------------------------------------------------------

  private selectionInEditor(): Range | null {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return this.editor().nativeElement.contains(range.commonAncestorContainer) ? range : null;
  }

  private onSelectionChange(): void {
    const range = this.selectionInEditor();
    if (!range) return;
    this.saved = range.cloneRange();
    if (!this.formatOpen()) return;
    const on = new Set<string>();
    const query = (cmd: string) => {
      try {
        return document.queryCommandState(cmd);
      } catch {
        return false;
      }
    };
    if (query('bold')) on.add('bold');
    if (query('italic')) on.add('italic');
    if (query('underline')) on.add('underline');
    if (query('strikeThrough')) on.add('strike');
    if (query('insertUnorderedList')) on.add('ul');
    if (query('insertOrderedList')) on.add('ol');
    const el = this.elementAt(range);
    if (el?.closest('code')) on.add('code');
    if (el?.closest('pre')) on.add('pre');
    if (el?.closest('blockquote')) on.add('quote');
    if (el?.closest('a')) on.add('link');
    this.activeFormats.set(on);
  }

  private elementAt(range: Range): HTMLElement | null {
    const node = range.startContainer;
    return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  }

  /** Puts the caret back where it was in the editor (or at its end) and focuses it. */
  private restore(): void {
    const el = this.editor().nativeElement;
    el.focus();
    const sel = document.getSelection();
    if (!sel) return;
    if (this.saved && el.contains(this.saved.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(this.saved);
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // --- formatting -------------------------------------------------------------

  protected toggleFormat(): void {
    this.formatOpen.update((v) => !v);
    if (!this.formatOpen()) this.linkOpen.set(false);
    else this.onSelectionChange();
  }

  protected format(id: string): void {
    if (id === 'link') return this.openLink();
    this.restore();
    const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);
    switch (id) {
      case 'bold':
        exec('bold');
        break;
      case 'italic':
        exec('italic');
        break;
      case 'underline':
        exec('underline');
        break;
      case 'strike':
        exec('strikeThrough');
        break;
      case 'ul':
        exec('insertUnorderedList');
        break;
      case 'ol':
        exec('insertOrderedList');
        break;
      case 'code':
        this.toggleCode();
        break;
      case 'pre':
        exec('formatBlock', this.elementAt(this.selectionInEditor() ?? document.createRange())?.closest('pre') ? 'div' : 'pre');
        break;
      case 'quote':
        exec('formatBlock', this.elementAt(this.selectionInEditor() ?? document.createRange())?.closest('blockquote') ? 'div' : 'blockquote');
        break;
    }
    this.onInput();
    this.onSelectionChange();
  }

  private toggleCode(): void {
    const range = this.selectionInEditor();
    if (!range) return;
    const existing = this.elementAt(range)?.closest('code');
    if (existing) {
      const parent = existing.parentNode!;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      existing.remove();
      return;
    }
    const code = document.createElement('code');
    if (range.collapsed) {
      code.textContent = '​';
      range.insertNode(code);
      const caret = document.createRange();
      caret.setStart(code.firstChild!, 1);
      caret.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(caret);
    } else {
      code.append(range.extractContents());
      range.insertNode(code);
      const after = document.createRange();
      after.selectNodeContents(code);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(after);
    }
  }

  private openLink(): void {
    this.onSelectionChange();
    this.linkUrl.set('https://');
    this.linkOpen.set(true);
    afterNextRender(() => this.linkInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.restore();
  }

  protected applyLink(event: Event): void {
    event.preventDefault();
    const url = this.linkUrl().trim();
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(url)) {
      toast.error('Enter a web address that starts with http:// or https://.');
      return;
    }
    this.linkOpen.set(false);
    this.restore();
    const range = this.selectionInEditor();
    if (range && !range.collapsed) {
      document.execCommand('createLink', false, url);
    } else {
      const safe = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      document.execCommand('insertHTML', false, `<a href="${safe}">${safe}</a>&nbsp;`);
    }
    this.onInput();
  }

  // --- input, keys, suggestions ----------------------------------------------

  protected onInput(): void {
    const el = this.editor().nativeElement;
    // A leftover <br> in an emptied editor would make it look non-empty to CSS and to screen readers.
    if (!el.textContent && !el.querySelector('img, li, pre, blockquote, [data-mention-id]')) el.innerHTML = '';
    this.composed.set(compose(el));
    void this.detectSuggestion();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const sg = this.suggest();
    if (sg?.items.length) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.active.update((i) => (i + 1) % sg.items.length);
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.active.update((i) => (i - 1 + sg.items.length) % sg.items.length);
          return;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          event.stopImmediatePropagation();
          this.accept(sg.items[this.active()]);
          return;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          this.closeSuggestions();
          return;
      }
    }
    if (event.key !== 'Enter') return;
    const here = this.elementAt(this.selectionInEditor() ?? document.createRange());
    const inList = !!here?.closest('li');
    const inCode = !!here?.closest('pre');
    if (event.shiftKey) {
      // Shift+Enter is always a line break.
      if (!inList && !inCode) {
        event.preventDefault();
        document.execCommand('insertLineBreak');
        this.onInput();
      }
      return;
    }
    // In a list Enter starts the next item, in a code block it adds a line; everywhere else it sends.
    if (inList || inCode) return;
    event.preventDefault();
    this.submit();
  }

  protected closeSuggestions(): void {
    this.suggest.set(null);
  }

  private async detectSuggestion(): Promise<void> {
    const range = this.selectionInEditor();
    const node = range?.startContainer;
    if (!range || !range.collapsed || node?.nodeType !== Node.TEXT_NODE) return this.closeSuggestions();
    const text = node as Text;
    const caret = range.startOffset;
    const before = text.data.slice(0, caret);

    const mention = /(^|[\s(])@([^\s@]{0,30})$/.exec(before);
    if (mention && this.chat().mentionable.length) {
      const q = mention[2].toLowerCase();
      const items = this.chat()
        .mentionable.filter((m) => m.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map((m) => ({ key: m.id, label: m.name, userId: m.id }));
      this.suggest.set(items.length ? { kind: 'mention', items, node: text, start: caret - mention[2].length - 1, end: caret } : null);
      this.active.set(0);
      return;
    }

    // Teams' (laugh) shortcuts complete as soon as the closing bracket is typed.
    const bracket = /(^|[\s(])(\(([a-z0-9_+-]{2,})\))$/i.exec(before);
    if (bracket) {
      const catalogue = await this.api.catalogue();
      const hit = catalogue?.byShortcut.get(normalizeShortcut(bracket[3]));
      const now = this.selectionInEditor();
      if (hit && now?.startContainer === text && now.startOffset === caret) {
        this.replaceText(text, caret - bracket[2].length, caret, [this.emojiNode(hit), document.createTextNode(' ')]);
        return this.closeSuggestions();
      }
    }

    if (!before.includes(':')) return this.closeSuggestions();
    // The catalogue loads the first time a shortcut is typed.
    const catalogue = await this.api.catalogue();
    if (!catalogue) return this.closeSuggestions();
    const now = this.selectionInEditor();
    if (!now || now.startContainer !== text || now.startOffset !== caret) return;
    const complete = /(^|[\s([{])(:([a-z0-9_+-]+):)([\s.,!?;)\]}])$/i.exec(text.data.slice(0, caret));
    const done = complete ? catalogue.byShortcut.get(normalizeShortcut(complete[3])) : undefined;
    if (complete && done) {
      this.replaceText(text, caret - complete[2].length - 1, caret - 1, [this.emojiNode(done)]);
      return this.closeSuggestions();
    }
    const at = emojiQueryAt(text.data, caret);
    const items: Suggestion[] = at ? searchShortcuts(catalogue, at.query).map((m) => ({ key: m.code, label: m.code, teams: m.emoji })) : [];
    this.suggest.set(at && items.length ? { kind: 'emoji', items, node: text, start: at.start, end: caret } : null);
    this.active.set(0);
  }

  /** The editor shows a Teams emoji as its still image; it is sent as an `<emoji id>` tag. */
  private emojiNode(e: ChatEmoji): HTMLImageElement {
    const img = document.createElement('img');
    img.setAttribute('data-emoji-id', e.id);
    img.alt = e.alt;
    img.title = e.label;
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    if (e.staticUrl) img.src = e.staticUrl;
    return img;
  }

  protected accept(item: Suggestion): void {
    const sg = this.suggest();
    if (!sg) return;
    if (sg.kind === 'emoji' && item.teams) {
      this.replaceText(sg.node, sg.start, sg.end, [this.emojiNode(item.teams), document.createTextNode(' ')]);
    } else if (item.userId) {
      const span = document.createElement('span');
      span.className = 'mention';
      span.setAttribute('data-mention-id', item.userId);
      span.contentEditable = 'false';
      span.textContent = item.label;
      this.replaceText(sg.node, sg.start, sg.end, [span, document.createTextNode(' ')]);
    }
    this.closeSuggestions();
    this.editor().nativeElement.focus();
  }

  /** Replaces part of a text node with new nodes and puts the caret after them. */
  private replaceText(node: Text, start: number, end: number, nodes: Node[]): void {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    range.deleteContents();
    let last: Node | null = null;
    for (const n of nodes.reverse()) {
      range.insertNode(n);
      last ??= n;
    }
    const caret = document.createRange();
    caret.setStartAfter(last!);
    caret.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(caret);
    this.saved = caret.cloneRange();
    this.onInput();
  }

  // --- emoji and GIFs ---------------------------------------------------------

  /** On intent to open the picker: the catalogue, then the pictures of its first screen, so it opens drawn. */
  protected warmEmoji(): void {
    if (this.warmed) return;
    this.warmed = true;
    void this.api.catalogue().then((catalogue) => {
      if (!catalogue) this.warmed = false;
      for (const e of catalogue?.all.slice(0, FIRST_SCREEN_EMOJI) ?? []) {
        if (!e.staticUrl) continue;
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = e.staticUrl;
      }
    });
  }

  protected insertEmoji(emoji: ChatEmoji): void {
    this.restore();
    const img = this.emojiNode(emoji);
    const range = this.selectionInEditor();
    if (range) {
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    } else {
      this.editor().nativeElement.append(img);
    }
    this.onInput();
  }

  protected sendGif(gif: Gif): void {
    this.emojiState.set('closed');
    this.store.send({
      content: '',
      contentType: 'text',
      importance: this.importance(),
      mentions: [],
      gif: { url: gif.url, alt: gif.title || 'GIF', width: gif.width, height: gif.height },
      images: [],
      files: [],
      preview: '',
    });
    this.importance.set('normal');
    this.sent.emit();
  }

  // --- images and files -------------------------------------------------------

  protected onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  protected addFiles(list: File[]): void {
    const next = [...this.files()];
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is larger than 100 MB.`);
      } else if (next.length >= MAX_FILES) {
        toast.error(`You can attach up to ${MAX_FILES} files at once.`);
        break;
      } else {
        next.push(file);
      }
    }
    this.files.set(next);
  }

  protected removeFile(file: File): void {
    this.files.update((list) => list.filter((f) => f !== file));
  }

  private inlineBytes(): number {
    let total = 0;
    for (const { file } of this.inline.values()) total += file.size;
    return total;
  }

  /** Puts an image into the editor at the caret; PNG, JPEG, GIF and WEBP up to 3 MB in all. */
  private insertInline(file: File): boolean {
    if (!INLINE_TYPES.includes(file.type)) {
      toast.error('Pasted images must be PNG, JPEG, GIF or WEBP.');
      return false;
    }
    if (this.inlineBytes() + file.size > MAX_INLINE_BYTES) {
      toast.error('Images in a message can be 3 MB in all. Attach larger ones as files.');
      return false;
    }
    const id = `img-${++this.inlineCounter}`;
    const url = URL.createObjectURL(file);
    this.inline.set(id, { file, url });
    const img = document.createElement('img');
    img.src = url;
    img.alt = file.name || 'Pasted image';
    img.setAttribute('data-inline-id', id);
    this.restore();
    const range = this.selectionInEditor();
    if (range) {
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    } else {
      this.editor().nativeElement.append(img);
    }
    return true;
  }

  protected onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data) return;
    const images = Array.from(data.files).filter((f) => f.type.startsWith('image/'));
    if (images.length) {
      event.preventDefault();
      for (const image of images) this.insertInline(image);
      this.onInput();
      return;
    }
    // Plain text only: pasted markup would bring styles and tags the message cannot carry.
    const text = data.getData('text/plain');
    if (text) {
      event.preventDefault();
      document.execCommand('insertText', false, text);
      this.onInput();
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    this.dragging.set(false);
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (!dropped.length) return;
    event.preventDefault();
    const others: File[] = [];
    for (const file of dropped) {
      if (file.type.startsWith('image/')) this.insertInline(file);
      else others.push(file);
    }
    this.addFiles(others);
    this.onInput();
  }

  // --- sending ----------------------------------------------------------------

  protected submit(): void {
    if (!this.canSend()) return;
    const c = compose(this.editor().nativeElement);
    if (c.text.length > MAX_LENGTH) {
      toast.error(`Messages can be ${MAX_LENGTH} characters at most.`);
      return;
    }
    const images = c.imageIds.map((id) => this.inline.get(id)?.file).filter((f): f is File => !!f);
    const html = !c.plain || c.mentions.length > 0 || images.length > 0;
    const outgoing: Outgoing = {
      content: html ? c.html : c.text,
      contentType: html ? 'html' : 'text',
      importance: this.importance(),
      mentions: c.mentions.map((m) => ({ id: m.id, mentionText: m.text, mentioned: { user: { id: m.userId, displayName: m.text } } })),
      gif: null,
      images,
      files: this.files(),
      preview: c.text,
    };
    this.store.send(outgoing);
    this.reset();
    this.sent.emit();
    this.focus();
  }

  protected afterScheduled(): void {
    this.scheduleOpen.set(false);
    this.reset();
    this.focus();
  }

  private revokeInline(): void {
    for (const { url } of this.inline.values()) URL.revokeObjectURL(url);
    this.inline.clear();
  }

  private reset(): void {
    const el = this.editor().nativeElement;
    el.innerHTML = '';
    // A pending bubble makes its own object URLs from the files, so the editor's can go.
    this.revokeInline();
    this.saved = null;
    this.composed.set(EMPTY);
    this.files.set([]);
    this.importance.set('normal');
    this.linkOpen.set(false);
    this.closeSuggestions();
  }
}
