import { TranslatePipe } from '@ngx-translate/core';
import { Component, ElementRef, computed, effect, input, output, viewChild } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';

const SCROLLABLE = /auto|scroll|overlay/;

/** The nearest ancestor that scrolls, or null for the viewport; observing against it makes rootMargin apply to nested scrollers too. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (SCROLLABLE.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/**
 * Infinite-scroll helper: emits `more` when its sentinel nears the visible area of the scroll container.
 * A subtle button is always rendered after the sentinel for keyboard and screen-reader users and when
 * IntersectionObserver is unavailable. A polite live region announces how many items arrived.
 */
@Component({
  selector: 'app-load-more',
  imports: [TranslatePipe, HlmButton, HlmSpinner],
  host: { class: 'block' },
  template: `
    <div class="sr-only" role="status" aria-live="polite">
      @for (note of announcements(); track note) {
        <span>{{ 'shared.loadedMore' | translate: { count: note.count } }}</span>
      }
    </div>
    @if (hasMore() || loading() || failed()) {
      <div #sentinel class="h-px w-full" aria-hidden="true"></div>
      <div class="flex min-h-10 items-center justify-center gap-2 py-2">
        @if (failed()) {
          <p class="text-destructive flex items-center gap-2 text-sm">
            {{ 'shared.loadMoreFailed' | translate }}
            <button type="button" class="underline underline-offset-2" (click)="more.emit()">{{ 'chat.retry' | translate }}</button>
          </p>
        } @else {
          <button
            type="button"
            hlmBtn
            size="sm"
            [variant]="supported ? 'ghost' : 'outline'"
            class="text-muted-foreground"
            [attr.aria-disabled]="loading() || null"
            (click)="request()"
          >
            @if (loading()) {
              <hlm-spinner [attr.aria-label]="'common.loading' | translate" />
            }
            {{ label() }}
          </button>
        }
      </div>
    }
  `,
})
export class LoadMore {
  /** Accessible and visible name of the button, e.g. "Load more messages". */
  readonly label = input.required<string>();
  readonly hasMore = input(false);
  readonly loading = input(false);
  readonly failed = input(false);
  /** The result of the last load; a new object each time announces it again. */
  readonly loaded = input<{ count: number } | null>(null);

  readonly more = output<void>();

  protected readonly supported = typeof IntersectionObserver !== 'undefined';
  protected readonly announcements = computed(() => {
    const loaded = this.loaded();
    return loaded && loaded.count > 0 ? [loaded] : [];
  });
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  constructor() {
    // Observing again after every load makes a sentinel that is still in view ask for the next page.
    effect((onCleanup) => {
      const element = this.sentinel()?.nativeElement;
      if (!element || !this.supported || !this.hasMore() || this.loading() || this.failed()) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) this.more.emit();
        },
        { root: scrollParent(element), rootMargin: '200px' },
      );
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }

  protected request(): void {
    if (!this.loading()) this.more.emit();
  }
}
