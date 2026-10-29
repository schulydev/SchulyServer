import { Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideDownload, lucideExternalLink, lucideFileX, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { Sheet, detectDelimiter, parseCsv } from './csv';
import { Detected, canOpenInTab, detect, isPdfBytes, officeFamilyOf } from './file-types';
import { getCachedPdf, putCachedPdf } from './pdf-cache';
import { PDF_CONVERTER } from './pdf-converter';
import { ViewerFile } from './viewer-file';
import { ViewerTable } from './viewer-table';
import { ViewerText } from './viewer-text';

export type { ViewerFile } from './viewer-file';

type Rendered =
  | { kind: 'pdf'; url: string; safe: SafeResourceUrl }
  | { kind: 'image' | 'audio' | 'video'; url: string }
  | { kind: 'text'; text: string; truncated: boolean; url: string | null }
  | { kind: 'markdown'; html: SafeHtml }
  | { kind: 'table'; sheets: Sheet[]; url: string | null }
  | { kind: 'none' };

const MAX_TEXT = 1024 * 1024;
const MAX_PARSE = 5 * 1024 * 1024;

const decode = (bytes: Uint8Array, max: number) => new TextDecoder('utf-8').decode(bytes.subarray(0, max));

async function isPdfBlob(blob: Blob): Promise<boolean> {
  return blob.size > 0 && isPdfBytes(new Uint8Array(await blob.slice(0, 1024).arrayBuffer()));
}

/** Shared in-browser viewer. Nothing is ever navigated to a server URL; markup is never rendered and svg only ever as an img. */
@Component({
  selector: 'app-file-viewer',
  encapsulation: ViewEncapsulation.None,
  imports: [HlmButton, HlmDialogImports, HlmSpinner, NgIcon, ViewerTable, ViewerText],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideDownload, lucideExternalLink, lucideFileX, lucideX })],
  template: `
    <hlm-dialog [state]="current() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        [showCloseButton]="false"
        (keydown)="onKeydown($event)"
        class="h-dvh max-h-none w-screen max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-xl"
      >
        <header class="flex min-h-14 flex-wrap items-center gap-2 border-b px-4 py-2">
          @if (position(); as p) {
            <div class="flex items-center gap-1">
              <button hlmBtn variant="ghost" size="icon-sm" type="button" aria-label="Previous file" [disabled]="p.index === 0" (click)="go(-1)">
                <ng-icon name="lucideChevronLeft" class="text-base" aria-hidden="true" />
              </button>
              <span class="text-muted-foreground text-xs tabular-nums" aria-live="polite">{{ p.index + 1 }} of {{ p.total }}</span>
              <button hlmBtn variant="ghost" size="icon-sm" type="button" aria-label="Next file" [disabled]="p.index === p.total - 1" (click)="go(1)">
                <ng-icon name="lucideChevronRight" class="text-base" aria-hidden="true" />
              </button>
            </div>
          }
          <h2 hlmDialogTitle class="min-w-0 flex-1 truncate text-base font-semibold">{{ current()?.name }}</h2>
          <p hlmDialogDescription class="sr-only">File preview</p>
          <button hlmBtn variant="ghost" size="sm" type="button" [disabled]="phase() !== null || downloading()" (click)="download()">
            <ng-icon name="lucideDownload" class="text-base" aria-hidden="true" />
            <span class="max-sm:sr-only">Download</span>
          </button>
          @if (openUrl(); as url) {
            <button hlmBtn variant="ghost" size="sm" type="button" (click)="openInTab(url)">
              <ng-icon name="lucideExternalLink" class="text-base" aria-hidden="true" />
              <span class="max-sm:sr-only">Open in new tab</span>
              <span class="sr-only">(opens in a new tab)</span>
            </button>
          }
          <button hlmBtn variant="ghost" size="sm" type="button" (click)="closed.emit()">
            <ng-icon name="lucideX" class="text-base" aria-hidden="true" />
            <span class="max-sm:sr-only">Close</span>
          </button>
        </header>

        <div class="bg-muted/40 relative flex min-h-0 min-w-0 flex-col" [attr.aria-busy]="phase() !== null">
          @if (phase(); as phase) {
            <div class="text-muted-foreground m-auto flex items-center gap-2 px-4 text-center text-sm" role="status">
              <hlm-spinner aria-hidden="true" />
              @if (phase === 'converting') {
                Converting {{ current()?.name }} to PDF…
              } @else {
                Loading {{ current()?.name }}
              }
            </div>
          } @else if (failed()) {
            <p class="text-muted-foreground m-auto text-sm" role="alert">Could not load this file. Try again.</p>
          } @else {
            @switch (shownKind()) {
              @case ('pdf') {
                @if (pdf(); as safe) {
                  <iframe class="size-full border-0 bg-white" [src]="safe" [title]="'Preview of ' + current()?.name"></iframe>
                }
              }
              @case ('image') {
                <div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
                  <img [src]="mediaUrl()" [alt]="'Preview of ' + current()?.name" class="max-h-full max-w-full object-contain" (error)="mediaFailed.set(true)" />
                </div>
              }
              @case ('video') {
                <div class="flex min-h-0 flex-1 items-center justify-center p-4">
                  <video controls preload="metadata" class="max-h-full max-w-full" [src]="mediaUrl()" [attr.aria-label]="'Video: ' + current()?.name" (error)="mediaFailed.set(true)"></video>
                </div>
              }
              @case ('audio') {
                <div class="flex min-h-0 flex-1 items-center justify-center p-4">
                  <audio controls preload="metadata" class="w-full max-w-xl" [src]="mediaUrl()" [attr.aria-label]="'Audio: ' + current()?.name" (error)="mediaFailed.set(true)"></audio>
                </div>
              }
              @case ('text') {
                <app-viewer-text [text]="textOf()" [truncated]="truncatedText()" [label]="current()?.name ?? 'file'" />
              }
              @case ('table') {
                <app-viewer-table [sheets]="sheetsOf()" [label]="current()?.name ?? 'file'" />
              }
              @case ('markdown') {
                <div class="bg-background min-h-0 flex-1 overflow-auto" tabindex="0" [attr.aria-label]="'Contents of ' + current()?.name">
                  <article class="markdown mx-auto max-w-3xl p-6 text-sm leading-7" [innerHTML]="html()"></article>
                </div>
              }
              @default {
                <div class="m-auto flex flex-col items-center gap-3 p-6 text-center">
                  <ng-icon name="lucideFileX" class="text-muted-foreground text-3xl" aria-hidden="true" />
                  <p class="font-medium">Preview not available</p>
                  <p class="text-muted-foreground text-sm">This file type cannot be shown here.</p>
                  <button hlmBtn type="button" [disabled]="downloading()" (click)="download()">
                    <ng-icon name="lucideDownload" aria-hidden="true" />
                    Download
                  </button>
                </div>
              }
            }
          }
        </div>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
  styles: `
    .markdown :is(h1, h2, h3, h4) {
      font-weight: 600;
      line-height: 1.3;
      margin: 1.5em 0 0.5em;
    }
    .markdown h1 {
      font-size: 1.75rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.3em;
    }
    .markdown h2 {
      font-size: 1.4rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.3em;
    }
    .markdown h3 {
      font-size: 1.15rem;
    }
    .markdown > :first-child {
      margin-top: 0;
    }
    .markdown :is(p, ul, ol, pre, blockquote, table) {
      margin: 0.75em 0;
    }
    .markdown ul {
      list-style: disc;
      padding-inline-start: 1.5rem;
    }
    .markdown ol {
      list-style: decimal;
      padding-inline-start: 1.5rem;
    }
    .markdown a {
      color: var(--primary);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .markdown blockquote {
      border-inline-start: 4px solid var(--border);
      padding-inline-start: 1rem;
      color: var(--muted-foreground);
    }
    .markdown code {
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 0.85em;
      background: var(--muted);
      border-radius: 4px;
      padding: 0.1em 0.35em;
    }
    .markdown pre {
      background: var(--muted);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      overflow-x: auto;
    }
    .markdown pre code {
      background: none;
      padding: 0;
    }
    .markdown hr {
      border-color: var(--border);
      margin: 1.5em 0;
    }
    .markdown table {
      border-collapse: collapse;
      display: block;
      overflow-x: auto;
    }
    .markdown :is(th, td) {
      border: 1px solid var(--border);
      padding: 0.35rem 0.75rem;
    }
    .markdown th {
      background: var(--muted);
      text-align: left;
    }
  `,
})
export class FileViewer {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly converter = inject(PDF_CONVERTER, { optional: true });

  readonly file = input<ViewerFile | null>(null);
  /** The sibling files; with 2 or more that include the current one, Previous / Next appear. */
  readonly files = input<ViewerFile[]>([]);
  readonly closed = output<void>();
  /** Emitted when the user moves to another file with Previous / Next. */
  readonly navigated = output<ViewerFile>();

  protected readonly current = linkedSignal<ViewerFile | null>(() => this.file());

  protected readonly phase = signal<'loading' | 'converting' | null>(null);
  protected readonly failed = signal(false);
  protected readonly mediaFailed = signal(false);
  protected readonly downloading = signal(false);
  protected readonly rendered = signal<Rendered | null>(null);
  private readonly original = signal<Blob | null>(null);
  /** Whether the open-in-new-tab URL is allowed for what is shown. */
  private readonly openable = signal(false);

  protected readonly shownKind = computed(() => (this.mediaFailed() ? 'none' : (this.rendered()?.kind ?? 'none')));
  protected readonly pdf = computed(() => {
    const r = this.rendered();
    return r?.kind === 'pdf' ? r.safe : null;
  });
  protected readonly mediaUrl = computed(() => {
    const r = this.rendered();
    return r && (r.kind === 'image' || r.kind === 'audio' || r.kind === 'video') ? r.url : '';
  });
  protected readonly textOf = computed(() => {
    const r = this.rendered();
    return r?.kind === 'text' ? r.text : '';
  });
  protected readonly truncatedText = computed(() => {
    const r = this.rendered();
    return r?.kind === 'text' && r.truncated;
  });
  protected readonly sheetsOf = computed(() => {
    const r = this.rendered();
    return r?.kind === 'table' ? r.sheets : [];
  });
  protected readonly html = computed(() => {
    const r = this.rendered();
    return r?.kind === 'markdown' ? r.html : '';
  });
  protected readonly openUrl = computed(() => {
    const r = this.rendered();
    if (!r || this.mediaFailed() || !this.openable()) return null;
    return 'url' in r ? r.url : null;
  });

  protected readonly position = computed(() => {
    const cur = this.current();
    const list = this.files();
    if (!cur || list.length < 2) return null;
    const index = list.findIndex((f) => f === cur || (!!f.key && f.key === cur.key));
    return index < 0 ? null : { index, total: list.length };
  });

  private seq = 0;
  private readonly urls = new Set<string>();

  constructor() {
    effect(() => {
      const file = this.current();
      untracked(() => void this.show(file));
    });
    inject(DestroyRef).onDestroy(() => this.reset());
  }

  private reset(): void {
    this.seq++;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.rendered.set(null);
    this.original.set(null);
    this.openable.set(false);
    this.failed.set(false);
    this.mediaFailed.set(false);
    this.phase.set(null);
  }

  private async show(file: ViewerFile | null): Promise<void> {
    this.reset();
    if (!file) return;
    const seq = this.seq;
    this.phase.set('loading');
    try {
      if (file.pdf && officeFamilyOf(file.name)) {
        if (await this.showConverted(file, seq, file.pdf)) return;
        const raw = await file.load();
        if (seq !== this.seq) return;
        await this.showOriginal(file, raw, seq, false);
        return;
      }
      const raw = await file.load();
      if (seq !== this.seq) return;
      await this.showOriginal(file, raw, seq, true);
    } catch {
      if (seq === this.seq) this.failed.set(true);
    } finally {
      if (seq === this.seq) this.phase.set(null);
    }
  }

  private async showOriginal(file: ViewerFile, raw: Blob, seq: number, mayConvert: boolean): Promise<void> {
    const bytes = new Uint8Array(await raw.arrayBuffer());
    if (seq !== this.seq) return;
    this.original.set(raw);
    const d = detect(file.name, bytes, raw.type);
    if (d.kind === 'office' && mayConvert) {
      const converter = this.converter;
      let loader = file.pdf ?? null;
      if (!loader && converter && (await converter.available())) loader = () => converter.convert(raw, file.name);
      if (seq !== this.seq) return;
      if (loader && (await this.showConverted(file, seq, loader))) return;
    }
    if (seq !== this.seq) return;
    await this.render(file, d, bytes);
  }

  /** Shows the PDF rendering of an Office file. False when there is none, so the caller can fall back. */
  private async showConverted(file: ViewerFile, seq: number, loader: () => Promise<Blob>): Promise<boolean> {
    this.phase.set('converting');
    let pdf = getCachedPdf(file.key);
    if (!pdf) {
      try {
        const result = await loader();
        if (seq !== this.seq) return true;
        if (!(await isPdfBlob(result))) return false;
        pdf = new Blob([result], { type: 'application/pdf' });
        putCachedPdf(file.key, pdf);
      } catch {
        return seq !== this.seq;
      }
    }
    if (seq !== this.seq) return true;
    const url = this.make(pdf);
    this.rendered.set({ kind: 'pdf', url, safe: this.sanitizer.bypassSecurityTrustResourceUrl(url) });
    this.openable.set(true);
    return true;
  }

  private async render(file: ViewerFile, d: Detected, bytes: Uint8Array): Promise<void> {
    this.openable.set(canOpenInTab(d));
    switch (d.kind) {
      case 'pdf':
      case 'image':
      case 'audio':
      case 'video': {
        // Re-typed from the verified bytes, never from the server's header.
        const url = this.make(new Blob([bytes as BlobPart], { type: d.type }));
        this.rendered.set(d.kind === 'pdf' ? { kind: 'pdf', url, safe: this.sanitizer.bypassSecurityTrustResourceUrl(url) } : { kind: d.kind, url });
        return;
      }
      case 'office': {
        if (d.family === 'sheet') {
          try {
            const { readWorkbook } = await import('./sheets');
            const sheets = await readWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
            if (sheets.length) {
              this.openable.set(false);
              this.rendered.set({ kind: 'table', sheets, url: null });
              return;
            }
          } catch {
            /* falls through to "not available" */
          }
        }
        this.openable.set(false);
        this.rendered.set({ kind: 'none' });
        return;
      }
      case 'csv': {
        const text = decode(bytes, MAX_PARSE);
        const { rows, truncated } = parseCsv(text, detectDelimiter(text, d.ext), 20001);
        this.rendered.set({ kind: 'table', sheets: [{ name: file.name, rows, truncated: truncated || bytes.length > MAX_PARSE }], url: this.textUrl(bytes) });
        return;
      }
      case 'markdown': {
        const { renderMarkdown } = await import('./markdown');
        this.rendered.set({ kind: 'markdown', html: this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(decode(bytes, MAX_TEXT))) });
        return;
      }
      case 'json': {
        let text = decode(bytes, MAX_TEXT);
        if (bytes.length <= MAX_PARSE) {
          try {
            text = JSON.stringify(JSON.parse(decode(bytes, MAX_PARSE)), null, 2);
          } catch {
            /* not valid JSON: shown as it is */
          }
        }
        this.rendered.set({ kind: 'text', text, truncated: text.length >= MAX_TEXT, url: this.textUrl(bytes) });
        return;
      }
      case 'text':
        this.rendered.set({ kind: 'text', text: decode(bytes, MAX_TEXT), truncated: bytes.length > MAX_TEXT, url: d.source ? null : this.textUrl(bytes) });
        return;
      default:
        this.rendered.set({ kind: 'none' });
    }
  }

  private textUrl(bytes: Uint8Array): string {
    return this.make(new Blob([bytes as BlobPart], { type: 'text/plain' }));
  }

  private make(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  protected go(delta: number): void {
    const p = this.position();
    const next = p ? this.files()[p.index + delta] : undefined;
    if (!next) return;
    this.current.set(next);
    this.navigated.emit(next);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest('audio, video, input, select, textarea, [data-viewer-keys], [contenteditable]')) return;
    if (!this.position()) return;
    event.preventDefault();
    this.go(event.key === 'ArrowLeft' ? -1 : 1);
  }

  protected openInTab(url: string): void {
    window.open(url, '_blank', 'noopener');
  }

  /** Always the original file, saved as opaque bytes through a temporary link, so the browser never renders it. */
  protected async download(): Promise<void> {
    const file = this.current();
    if (!file || this.downloading()) return;
    this.downloading.set(true);
    try {
      const blob = this.original() ?? (await file.load());
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: file.name, rel: 'noopener', hidden: true });
      // Inside the dialog, so the click is not treated as an outside click that closes the viewer.
      (document.querySelector('[role="dialog"]') ?? document.body).append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      if (this.current() === file) this.failed.set(true);
    } finally {
      this.downloading.set(false);
    }
  }
}
