import { Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBold, lucideHeading, lucideItalic, lucideLink, lucideList, lucideListOrdered, lucideStrikethrough, lucideUnderline } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { normalizeEditorHtml, sanitizeEditorHtml } from './page-html';

interface Format {
  id: string;
  label: string;
  icon: string;
  command: string;
  pressed: boolean;
}

const FORMATS: Omit<Format, 'pressed'>[] = [
  { id: 'bold', label: 'Bold', icon: 'lucideBold', command: 'bold' },
  { id: 'italic', label: 'Italic', icon: 'lucideItalic', command: 'italic' },
  { id: 'underline', label: 'Underline', icon: 'lucideUnderline', command: 'underline' },
  { id: 'strike', label: 'Strikethrough', icon: 'lucideStrikethrough', command: 'strikeThrough' },
  { id: 'ul', label: 'Bulleted list', icon: 'lucideList', command: 'insertUnorderedList' },
  { id: 'ol', label: 'Numbered list', icon: 'lucideListOrdered', command: 'insertOrderedList' },
];

const asUrl = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;
  if (/^(https?:|mailto:)/i.test(text)) return text;
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? null : `https://${text}`;
};

/** A small rich-text editor over a contenteditable div. Content goes in through a sanitised, imported copy and out through the same allowlist. */
@Component({
  selector: 'app-onenote-editor',
  imports: [HlmButton, HlmInput, NgIcon],
  providers: [provideIcons({ lucideBold, lucideHeading, lucideItalic, lucideLink, lucideList, lucideListOrdered, lucideStrikethrough, lucideUnderline })],
  host: { class: 'block min-w-0', '(document:selectionchange)': 'refresh()' },
  template: `
    <div class="bg-card min-w-0 rounded-md border">
      <div role="toolbar" [attr.aria-label]="label() + ' formatting'" class="flex flex-wrap items-center gap-0.5 border-b p-1">
        @for (f of formats(); track f.id) {
          <button
            hlmBtn
            type="button"
            variant="ghost"
            size="icon-sm"
            [attr.aria-pressed]="f.pressed"
            [class.bg-muted]="f.pressed"
            [title]="f.label"
            (mousedown)="$event.preventDefault()"
            (click)="run(f.command)"
          >
            <ng-icon [name]="f.icon" aria-hidden="true" />
            <span class="sr-only">{{ f.label }}</span>
          </button>
        }
        <button
          hlmBtn
          type="button"
          variant="ghost"
          size="icon-sm"
          [attr.aria-pressed]="heading()"
          [class.bg-muted]="heading()"
          title="Heading"
          (mousedown)="$event.preventDefault()"
          (click)="toggleHeading()"
        >
          <ng-icon name="lucideHeading" aria-hidden="true" />
          <span class="sr-only">Heading</span>
        </button>
        <button
          hlmBtn
          type="button"
          variant="ghost"
          size="icon-sm"
          [attr.aria-pressed]="link()"
          [attr.aria-expanded]="linkOpen()"
          [class.bg-muted]="link()"
          title="Link"
          (mousedown)="$event.preventDefault()"
          (click)="openLink()"
        >
          <ng-icon name="lucideLink" aria-hidden="true" />
          <span class="sr-only">Link</span>
        </button>
      </div>
      @if (linkOpen()) {
        <div class="flex items-center gap-2 border-b p-2">
          <label class="sr-only" [for]="linkId">Link address</label>
          <input
            #linkInput
            hlmInput
            [id]="linkId"
            type="text"
            inputmode="url"
            autocomplete="off"
            placeholder="https://example.com"
            (keydown.enter)="$event.preventDefault(); applyLink(linkInput.value)"
            (keydown.escape)="$event.stopPropagation(); closeLink()"
          />
          <button hlmBtn type="button" size="sm" (click)="applyLink(linkInput.value)">Apply</button>
          <button hlmBtn type="button" size="sm" variant="ghost" (click)="closeLink()">Cancel</button>
        </div>
      }
      <div
        #surface
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        spellcheck="true"
        [attr.aria-label]="label()"
        class="focus-visible:outline-ring min-h-24 p-3 text-sm leading-relaxed wrap-anywhere focus-visible:outline-2 focus-visible:-outline-offset-2 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:ps-6 [&_p]:mb-1 [&_ul]:list-disc [&_ul]:ps-6"
        (input)="emit()"
        (paste)="paste($event)"
      ></div>
    </div>
  `,
})
export class OneNoteEditor {
  private static next = 0;
  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  private readonly linkInput = viewChild<ElementRef<HTMLInputElement>>('linkInput');

  /** Initial markup; applying it replaces what the editor holds. */
  readonly html = input('');
  readonly label = input.required<string>();
  /** The editor's content as canonical markup after every edit. */
  readonly changed = output<string>();

  protected readonly linkId = `onenote-link-${OneNoteEditor.next++}`;
  protected readonly state = signal<Record<string, boolean>>({});
  protected readonly heading = signal(false);
  protected readonly link = signal(false);
  protected readonly linkOpen = signal(false);
  private saved: Range | null = null;

  protected readonly formats = (): Format[] => FORMATS.map((f) => ({ ...f, pressed: this.state()[f.id] === true }));

  constructor() {
    effect(() => {
      const html = this.html();
      const surface = this.surface().nativeElement;
      untracked(() => {
        // A sanitised copy parsed by DOMParser, imported node by node; never innerHTML.
        const clean = sanitizeEditorHtml(html);
        surface.replaceChildren(...Array.from(clean.childNodes).map((n) => document.importNode(n, true)));
      });
    });
    effect(() => {
      if (this.linkOpen()) queueMicrotask(() => this.linkInput()?.nativeElement.focus());
    });
  }

  focus(): void {
    this.surface().nativeElement.focus();
  }

  private selectionInside(): Range | null {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    return this.surface().nativeElement.contains(range.commonAncestorContainer) ? range : null;
  }

  protected refresh(): void {
    const range = this.selectionInside();
    if (!range) return;
    const next: Record<string, boolean> = {};
    for (const f of FORMATS) {
      try {
        next[f.id] = document.queryCommandState(f.command);
      } catch {
        next[f.id] = false;
      }
    }
    this.state.set(next);
    const node = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    this.heading.set(!!node?.closest('h1,h2,h3,h4,h5,h6'));
    this.link.set(!!node?.closest('a'));
  }

  protected run(command: string, value?: string): void {
    this.surface().nativeElement.focus();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command, false, value);
    this.emit();
    this.refresh();
  }

  protected toggleHeading(): void {
    this.run('formatBlock', this.heading() ? 'p' : 'h2');
  }

  protected openLink(): void {
    this.saved = this.selectionInside()?.cloneRange() ?? null;
    this.linkOpen.set(true);
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.surface().nativeElement.focus();
  }

  protected applyLink(value: string): void {
    const url = asUrl(value);
    this.linkOpen.set(false);
    const surface = this.surface().nativeElement;
    surface.focus();
    if (this.saved) {
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(this.saved);
    }
    if (url) this.run('createLink', url);
    else if (!value.trim()) this.run('unlink');
  }

  protected paste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) document.execCommand('insertText', false, text);
    this.emit();
  }

  protected emit(): void {
    this.changed.emit(normalizeEditorHtml(this.surface().nativeElement.innerHTML));
  }
}
