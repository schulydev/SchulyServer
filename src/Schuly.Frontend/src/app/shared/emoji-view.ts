import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ChatApi } from '../core/chat-api';
import { ChatEmoji } from '../core/chat-emoji';

/**
 * One Teams emoji (a still image, or a vertical sprite strip of square frames).
 * Animated Teams emojis play once when first scrolled into view and again on hover; with `prefers-reduced-motion`
 * they stay on their idle frame. Any image that fails to load falls back to the unicode character.
 */
@Component({
  selector: 'app-emoji',
  styles: `
    .sprite {
      display: inline-block;
      background-repeat: no-repeat;
      background-size: 100% calc(var(--frames) * 100%);
      vertical-align: middle;
    }
    .sprite.playing {
      animation: sprite-play calc(var(--frames) * var(--frame-ms) * 1ms) steps(var(--frames), jump-none) 1 forwards;
    }
    @keyframes sprite-play {
      from {
        background-position-y: 0%;
      }
      to {
        background-position-y: 100%;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .sprite.playing {
        animation: none;
      }
    }
  `,
  template: `
    @let e = emoji();
    @if (failed() || (!shown() && !stillFirst())) {
      <span role="img" class="inline-block leading-none" [attr.aria-label]="e.label || e.alt" [style.font-size.px]="size() * 0.85">{{ e.alt }}</span>
    } @else if (sprite() && shown()) {
      <span
        class="sprite"
        role="img"
        [attr.aria-label]="e.label || e.alt"
        [class.playing]="playing()"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.--frames]="e.frames"
        [style.--frame-ms]="e.frameMs"
        [style.background-image]="'url(' + shown() + ')'"
        [style.background-position-y]="idle()"
        (animationend)="playing.set(false)"
      ></span>
    } @else {
      <img
        class="inline-block align-middle"
        [src]="shown() ?? e.staticUrl"
        [alt]="e.label || e.alt"
        [width]="size()"
        [height]="size()"
        referrerpolicy="no-referrer"
        decoding="async"
        (error)="failed.set(true)"
      />
    }
  `,
  host: { class: 'inline-block align-middle leading-none', '(mouseenter)': 'replay()' },
})
export class EmojiView {
  private readonly api = inject(ChatApi);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly emoji = input.required<ChatEmoji>();
  /** Edge of the emoji on screen, in pixels. */
  readonly size = input(24);
  /** Shows the still picture until the animation has loaded, rather than the unicode character. */
  readonly stillWhileLoading = input(false);

  protected readonly failed = signal(false);
  protected readonly playing = signal(false);
  private readonly blob = signal<string | null>(null);
  private readonly visible = signal(false);
  private readonly loadedSprite = signal(false);

  /** True when the picture is a sprite strip rather than a single image. */
  protected readonly sprite = computed(() => {
    const e = this.emoji();
    return e.kind === 'native' && e.animated && e.frames > 1 && !!e.animatedUrl;
  });
  /** The URL being drawn. */
  protected readonly shown = computed(() => {
    const e = this.emoji();
    if (e.kind === 'custom') return this.blob();
    if (this.sprite()) return this.loadedSprite() ? e.animatedUrl : null;
    return e.staticUrl;
  });
  protected readonly stillFirst = computed(() => this.stillWhileLoading() && !!this.emoji().staticUrl);
  protected readonly idle = computed(() => {
    const e = this.emoji();
    return e.frames > 1 ? `${((e.firstFrame - 1) / (e.frames - 1)) * 100}%` : '0%';
  });

  private readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private seen = false;

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
      const e = this.emoji();
      if (!this.visible()) return;
      untracked(() => {
        this.failed.set(false);
        if (e.kind === 'custom' && e.documentId) {
          void this.api.imageUrl(`emojis/custom/${encodeURIComponent(e.documentId)}?animated=false`).then((url) => (url ? this.blob.set(url) : this.failed.set(true)));
        } else if (this.sprite()) {
          // The strip is fetched once, then the first play starts.
          const img = new Image();
          img.referrerPolicy = 'no-referrer';
          img.onload = () => {
            this.loadedSprite.set(true);
            this.firstPlay();
          };
          img.onerror = () => this.failed.set(true);
          img.src = e.animatedUrl!;
        }
      });
    });
  }

  private firstPlay(): void {
    if (this.seen) return;
    this.seen = true;
    this.replay();
  }

  /** Plays the animation from its first frame; a still emoji or reduced motion does nothing. */
  protected replay(): void {
    const e = this.emoji();
    if (this.reduced || this.failed()) return;
    if (e.kind === 'custom') {
      if (!e.documentId) return;
      // A custom emoji is a GIF or WEBP: the animated file is shown while hovered, the still one otherwise.
      void this.api.imageUrl(`emojis/custom/${encodeURIComponent(e.documentId)}?animated=true`).then((url) => {
        if (!url) return;
        const idle = this.blob();
        this.blob.set(url);
        setTimeout(() => this.blob.set(idle), 2500);
      });
      return;
    }
    if (!this.sprite() || !this.loadedSprite()) return;
    this.playing.set(false);
    requestAnimationFrame(() => this.playing.set(true));
  }
}
