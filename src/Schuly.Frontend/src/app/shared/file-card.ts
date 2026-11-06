import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCopy,
  lucideDownload,
  lucideEllipsis,
  lucideEye,
  lucideFile,
  lucideFileArchive,
  lucideFileAudio,
  lucideFileChartPie,
  lucideFileCode,
  lucideFileImage,
  lucideFileSpreadsheet,
  lucideFileText,
  lucideFileType,
  lucideFileVideo,
  lucideNotebookPen,
  lucideExternalLink,
  lucidePlay,
} from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { BubbleFile, formatSize } from '../core/chat-media';
import { KIND_STYLES } from '../core/file-kind';
import { ChatApi } from '../core/chat-api';
import { throttleWait } from '../core/throttle';

/** Largest image file that is fetched whole to serve as its own preview when the server has no thumbnail. */
const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;

/** A file in a chat bubble, chat-style: name and actions on top, a page preview below. */
@Component({
  selector: 'app-file-card',
  imports: [TranslatePipe, NgIcon, HlmButton, HlmDropdownMenuImports],
  providers: [
    provideIcons({
      lucideCopy,
      lucideDownload,
      lucideEllipsis,
      lucideExternalLink,
      lucideEye,
      lucideFile,
      lucideFileArchive,
      lucideFileAudio,
      lucideFileChartPie,
      lucideFileCode,
      lucideFileImage,
      lucideFileSpreadsheet,
      lucideFileText,
      lucideFileType,
      lucideFileVideo,
      lucideNotebookPen,
      lucidePlay,
    }),
  ],
  template: `
    <article class="bg-background/70 w-60 max-w-full overflow-hidden rounded-lg border sm:w-64" [attr.aria-label]="file().name">
      <div class="flex h-14 items-center gap-1 ps-3 pe-1">
        <ng-icon [name]="style().icon" class="shrink-0 text-xl" [class]="style().tint" aria-hidden="true" />
        @if (file().path) {
          <button
            type="button"
            class="focus-visible:outline-ring ms-1 min-w-0 flex-1 truncate rounded-sm py-1 text-start text-sm font-medium focus-visible:outline-2"
            [title]="file().name"
            (click)="view.emit()"
          >
            {{ file().name }}<span class="sr-only">, {{ style().label | translate }}@if (sizeText()) {, {{ sizeText() }}}. {{ 'files.openPreview' | translate }}</span>
          </button>
        } @else {
          <span class="ms-1 min-w-0 flex-1 truncate text-sm font-medium" [title]="file().name">{{ file().name }}</span>
        }
        @if (file().webUrl; as url) {
          <a hlmBtn variant="ghost" size="icon-sm" [href]="url" target="_blank" rel="noopener">
            <ng-icon name="lucideExternalLink" aria-hidden="true" />
            <span class="sr-only">{{ 'files.openOnlineName' | translate: { name: file().name } }}</span>
          </a>
        }
        @if (file().path) {
          <button hlmBtn variant="ghost" size="icon-sm" type="button" [hlmDropdownMenuTrigger]="menu" align="end">
            <ng-icon name="lucideEllipsis" aria-hidden="true" />
            <span class="sr-only">{{ 'files.moreFor' | translate: { name: file().name } }}</span>
          </button>
        }
      </div>

      @if (hasPreview()) {
        <button type="button" class="focus-visible:outline-ring bg-muted relative block h-44 w-full focus-visible:outline-2 focus-visible:-outline-offset-2" tabindex="-1" aria-hidden="true" (click)="view.emit()">
          @if (image(); as src) {
            <img [src]="src" alt="" class="size-full object-cover" [class.object-top]="file().kind !== 'video'" (error)="noPreview.set(true)" />
            @if (file().kind === 'video') {
              <span class="absolute inset-0 flex items-center justify-center">
                <span class="flex size-12 items-center justify-center rounded-full bg-black/60 text-white">
                  <ng-icon name="lucidePlay" class="text-2xl" />
                </span>
              </span>
            }
          } @else {
            <span class="block size-full animate-pulse" data-preview-loading></span>
          }
        </button>
      }
    </article>

    <ng-template #menu>
      <hlm-dropdown-menu class="w-48" [attr.aria-label]="'Actions for ' + file().name">
        <button hlmDropdownMenuItem type="button" (click)="view.emit()">
          <ng-icon name="lucideEye" aria-hidden="true" />
          {{ 'files.openViewer' | translate }}
        </button>
        <button hlmDropdownMenuItem type="button" (click)="download()">
          <ng-icon name="lucideDownload" aria-hidden="true" />
          {{ 'common.download' | translate }}
        </button>
        @if (file().webUrl) {
          <button hlmDropdownMenuItem type="button" (click)="copyLink()">
            <ng-icon name="lucideCopy" aria-hidden="true" />
            {{ 'files.copyLink' | translate }}
          </button>
        }
      </hlm-dropdown-menu>
    </ng-template>
  `,
  host: { class: 'block max-w-full' },
})
export class FileCard {
  private readonly api = inject(ChatApi);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly file = input.required<BubbleFile>();
  readonly view = output<void>();

  protected readonly style = computed(() => KIND_STYLES[this.file().kind]);
  protected readonly sizeText = computed(() => formatSize(this.file().size));
  private readonly visible = signal(false);
  protected readonly image = signal<string | null>(null);
  /** No picture turned up, so the card is just its name and actions. */
  protected readonly noPreview = signal(false);
  private readonly wanted = computed(() => {
    const f = this.file();
    const own = f.kind === 'image' && f.path && (f.size ?? 0) <= MAX_IMAGE_PREVIEW_BYTES ? f.path : null;
    return { thumbnail: f.thumbnailPath, own };
  });
  protected readonly hasPreview = computed(() => !this.noPreview() && !!(this.wanted().thumbnail || this.wanted().own));

  constructor() {
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') return this.visible.set(true);
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.visible.set(true);
          observer.disconnect();
        }
      });
      observer.observe(this.element.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    // The preview is fetched only once the card scrolls into view: the server thumbnail, or for an image its own bytes.
    effect(() => {
      const { thumbnail, own } = this.wanted();
      if (!this.visible() || !(thumbnail || own)) return;
      untracked(() => void this.loadPreview(thumbnail, own));
    });
  }

  private async loadPreview(thumbnail: string | null, own: string | null): Promise<void> {
    const url = (thumbnail ? await this.api.imageUrl(thumbnail) : null) ?? (own ? await this.api.imageUrl(own) : null);
    this.image.set(url);
    this.noPreview.set(!url);
  }

  protected async download(): Promise<void> {
    const f = this.file();
    if (!f.path) return;
    try {
      const blob = await this.api.blob(f.path);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: f.name, rel: 'noopener', hidden: true });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(throttleWait(error) === null ? t('files.downloadFailed') : t('files.throttled'));
    }
  }

  protected async copyLink(): Promise<void> {
    const url = this.file().webUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('files.linkCopiedDot'));
    } catch {
      toast.error(t('files.copyFailedDot'));
    }
  }
}
