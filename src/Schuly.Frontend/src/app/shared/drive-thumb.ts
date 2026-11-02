import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
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
  lucideFolder,
  lucideNotebookPen,
} from '@ng-icons/lucide';
import { ExplorerEntry, explorerKind, wantsThumbnail } from '../core/drive-explorer';
import { DriveThumbnails, ThumbnailSize } from '../core/drive-thumbnails';
import { KIND_STYLES } from '../core/file-kind';

/**
 * A drive entry's icon, covered by its OneDrive preview once that has loaded. The preview is asked
 * for only once the element is near the screen, so a folder of hundreds of files fetches the dozen
 * in view. The box keeps its size whether a picture arrives or not. Decorative: the name is beside it.
 */
@Component({
  selector: 'app-drive-thumb',
  imports: [NgIcon],
  providers: [
    provideIcons({
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
      lucideFolder,
      lucideNotebookPen,
    }),
  ],
  template: `
    <ng-icon [name]="icon()" [size]="iconSize()" [class]="tint()" aria-hidden="true" />
    @if (src(); as url) {
      <img
        [src]="url"
        alt=""
        class="absolute inset-0 size-full object-cover transition-opacity duration-200"
        [class.opacity-0]="!shown()"
        (load)="shown.set(true)"
        (error)="src.set(null)"
      />
    }
  `,
  host: { class: 'relative grid place-items-center overflow-hidden', 'aria-hidden': 'true' },
})
export class DriveThumb {
  private readonly thumbnails = inject(DriveThumbnails);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly entry = input.required<ExplorerEntry>();
  readonly size = input<ThumbnailSize>('medium');
  /** Icon size in pixels, as ng-icon takes it. */
  readonly iconSize = input('16');

  /** Has been near the screen; the request starts then and the picture stays once it has come. */
  private readonly seen = signal(false);
  /** Near the screen right now; a queued request for a tile scrolled past is skipped. */
  private near = false;
  protected readonly src = signal<string | null>(null);
  protected readonly shown = signal(false);
  private alive = true;

  /** A refreshed listing hands new objects; only a different item or version asks again. */
  private readonly version = computed(() => `${this.entry().driveId ?? ''}|${this.entry().id}|${this.entry().modified ?? ''}|${this.entry().name}`);

  protected readonly icon = computed(() => {
    const kind = explorerKind(this.entry());
    return kind === 'folder' ? 'lucideFolder' : KIND_STYLES[kind].icon;
  });
  protected readonly tint = computed(() => {
    const kind = explorerKind(this.entry());
    return kind === 'folder' ? 'text-sky-700 dark:text-sky-300' : KIND_STYLES[kind].tint;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => (this.alive = false));
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.near = true;
        return this.seen.set(true);
      }
      const observer = new IntersectionObserver(
        (entries) => {
          this.near = entries.some((e) => e.isIntersecting);
          if (this.near) this.seen.set(true);
        },
        { rootMargin: '200px' },
      );
      observer.observe(this.element.nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    effect(() => {
      const version = this.version();
      const size = this.size();
      const entry = untracked(() => this.entry());
      untracked(() => {
        this.src.set(null);
        this.shown.set(false);
      });
      if (!this.seen() || !wantsThumbnail(entry)) return;
      untracked(() => {
        void this.thumbnails
          .url(entry.id, entry.modified, size, () => this.alive && this.near, entry.driveId ?? null)
          .then((url) => {
            if (this.alive && this.version() === version) this.src.set(url);
          });
      });
    });
  }
}
