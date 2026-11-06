import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImage, lucideImageOff } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { BubbleFile, BubbleMedia, BubbleSticker, CardView } from '../core/chat-media';
import { ChatApi } from '../core/chat-api';
import { FileCard } from './file-card';
import { ViewerFile } from './file-viewer';

/** An image of a bubble: a public GIF shown inline, or a hosted image fetched as an authenticated blob. */
@Component({
  selector: 'app-chat-image',
  imports: [TranslatePipe, NgIcon],
  providers: [provideIcons({ lucideImageOff })],
  template: `
    @if (item(); as m) {
      @if (isGif()) {
        <img
          [src]="m.src"
          [alt]="m.alt || ('shared.animatedGif' | translate)"
          referrerpolicy="no-referrer"
          loading="lazy"
          class="max-h-64 max-w-full rounded-md object-contain"
        />
      } @else if (failed()) {
        <span class="text-muted-foreground flex items-center gap-1.5 text-xs"><ng-icon name="lucideImageOff" aria-hidden="true" />{{ 'notes.imageUnavailable' | translate }}</span>
      } @else if (url(); as src) {
        @if (clickable()) {
          <button type="button" class="focus-visible:outline-ring block max-w-full rounded-md focus-visible:outline-2 focus-visible:outline-offset-2" (click)="open.emit()">
            <img [src]="src" [alt]="m.alt || ('chat.image' | translate)" class="max-h-64 max-w-full rounded-md object-contain" />
            <span class="sr-only">{{ 'shared.viewImage' | translate }}</span>
          </button>
        } @else {
          <img [src]="src" [alt]="m.alt || ('chat.image' | translate)" class="max-h-64 max-w-full rounded-md object-contain" />
        }
      } @else {
        <span class="bg-background/60 block h-24 w-40 max-w-full animate-pulse rounded-md" role="img" [attr.aria-label]="'shared.loadingImage' | translate"></span>
      }
    }
  `,
  host: { class: 'block max-w-full' },
})
export class ChatImage {
  private readonly api = inject(ChatApi);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly item = input.required<BubbleMedia | BubbleSticker>();
  readonly open = output<void>();

  private readonly visible = signal(false);
  protected readonly loaded = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly isGif = computed(() => {
    const m = this.item();
    return 'kind' in m && m.kind === 'gif';
  });
  protected readonly clickable = computed(() => {
    const m = this.item();
    return 'kind' in m && m.kind === 'hosted';
  });
  protected readonly url = computed(() => this.item().src ?? this.loaded());

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
    effect(() => {
      const m = this.item();
      if (!this.visible() || m.src || !m.path) return;
      const path = m.path;
      untracked(() => {
        void this.api.imageUrl(path).then((url) => {
          this.loaded.set(url);
          this.failed.set(!url);
        });
      });
    });
  }
}

/** Everything a message carries besides its text: images, GIFs, stickers, file chips, cards and Teams emojis. */
@Component({
  selector: 'app-chat-media',
  imports: [TranslatePipe, ChatImage, FileCard, HlmButton, NgIcon],
  providers: [provideIcons({ lucideImage })],
  template: `
    @for (m of media(); track m.key) {
      <app-chat-image [item]="m" (open)="viewImage(m)" />
    }
    @for (s of stickers(); track s.key) {
      <app-chat-image [item]="s" />
    }
    @for (c of cards(); track c.key) {
      <section class="bg-background/70 flex max-w-full flex-col gap-1.5 rounded-md border p-3 text-sm" [attr.aria-label]="c.title ?? ('shared.card' | translate)">
        @if (c.title) {
          <p class="font-semibold">{{ c.title }}</p>
        }
        @for (b of c.blocks; track $index) {
          @switch (b.kind) {
            @case ('text') {
              <p class="wrap-anywhere whitespace-pre-wrap" [class.font-semibold]="b.bold" [class.text-foreground/70]="b.subtle" [class.text-base]="b.large">{{ b.text }}</p>
            }
            @case ('image') {
              @if (b.trusted || revealed().has(c.key + ':' + $index)) {
                <img [src]="b.url" [alt]="b.alt" referrerpolicy="no-referrer" loading="lazy" class="max-h-48 max-w-full rounded-md object-contain" />
              } @else {
                <button hlmBtn variant="outline" size="sm" type="button" class="self-start" (click)="reveal(c.key + ':' + $index)">
                  <ng-icon name="lucideImage" aria-hidden="true" />
                  {{ 'shared.showImage' | translate }}
                  <span class="sr-only">{{ 'shared.imageFrom' | translate: { host: b.host } }}{{ b.alt ? ': ' + b.alt : '' }}</span>
                </button>
              }
            }
            @case ('facts') {
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                @for (f of b.facts; track $index) {
                  <dt class="text-foreground/70 font-medium">{{ f.title }}</dt>
                  <dd class="wrap-anywhere">{{ f.value }}</dd>
                }
              </dl>
            }
          }
        }
      </section>
    }
    @if (files().length) {
      <ul class="flex flex-wrap gap-2" [attr.aria-label]="'helply.files' | translate">
        @for (f of files(); track f.key) {
          <li class="max-w-full"><app-file-card [file]="f" (view)="viewFile(f)" /></li>
        }
      </ul>
    }
  `,
  host: { class: 'flex max-w-full flex-col items-start gap-2 empty:hidden' },
})
export class ChatMedia {
  private readonly api = inject(ChatApi);

  /** Card images from outside Microsoft that were clicked; they stay shown for this view. */
  protected readonly revealed = signal<ReadonlySet<string>>(new Set());
  protected reveal(key: string): void {
    this.revealed.update((set) => new Set(set).add(key));
  }

  readonly media = input<BubbleMedia[]>([]);
  readonly files = input<BubbleFile[]>([]);
  readonly stickers = input<BubbleSticker[]>([]);
  readonly cards = input<CardView[]>([]);
  readonly view = output<ViewerFile>();

  protected viewImage(m: BubbleMedia): void {
    const path = m.path;
    if (!path) return;
    this.view.emit({ name: m.alt || t('chat.image'), load: () => this.api.blob(path) });
  }

  protected viewFile(f: BubbleFile): void {
    const path = f.path;
    if (!path) return;
    // Office files convert to PDF where they live (SharePoint / OneDrive); the viewer only asks for that when the type needs it.
    this.view.emit({ name: f.name, load: () => this.api.blob(path), pdf: () => this.api.blob(`${path}/pdf`), stream: () => this.api.streamUrl(path), key: `chat|${path}` });
  }
}
