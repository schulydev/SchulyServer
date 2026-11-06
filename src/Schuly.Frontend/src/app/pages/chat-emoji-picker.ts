import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, computed, inject, output, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDog, lucideHand, lucideHash, lucideLightbulb, lucidePlane, lucideSearch, lucideSmile, lucideTrophy, lucideUsers, lucideUtensils, lucideX } from '@ng-icons/lucide';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { allowedMediaUrl } from '../core/chat-media';
import { Gif, ChatApi } from '../core/chat-api';
import { Catalogue, CatalogueEmoji, SkinTone, searchCatalogue, toneEmoji } from '../core/chat-emoji';
import { CELL_PX, GridKey, LABEL_PX, layoutGrid, moveInGrid, scrollForItem, sectionAt, windowGrid } from '../core/emoji-grid';
import { persistedChoice } from '../core/persisted';
import { EmojiView } from '../shared/emoji-view';

const TONE_KEYS = ['0', '1', '2', '3', '4', '5'] as const;
type ToneKey = (typeof TONE_KEYS)[number];
const TONE_OPTIONS: { key: ToneKey; label: string; color: string }[] = [
  { key: '0', label: 'chat.tone.0', color: '#FFC83D' },
  { key: '1', label: 'chat.tone.1', color: '#FADCBC' },
  { key: '2', label: 'chat.tone.2', color: '#E0BB95' },
  { key: '3', label: 'chat.tone.3', color: '#BF8F68' },
  { key: '4', label: 'chat.tone.4', color: '#9B643D' },
  { key: '5', label: 'chat.tone.5', color: '#594539' },
];
const LONG_PRESS_MS = 500;
const HOVER_ANIMATE_MS = 120;
const VIEW_PX = 288;
const MIN_COLUMNS = 6;
const DEFAULT_COLUMNS = 9;
/** Enough pictures to fill the view when the picker opens. */
export const FIRST_SCREEN_EMOJI = 72;

/** Teams' categories: the id is the same in every language of the catalogue, the title is not. */
const CATEGORIES: Record<string, { label: string; icon: string }> = {
  '002_noname_639803c2-a011-4a08-8224-f0ac195ff373': { label: 'chat.category.smileys', icon: 'lucideSmile' },
  '002_noname_8c8001ce-84f9-4f79-bc04-5816bb919d4f': { label: 'chat.category.hands', icon: 'lucideHand' },
  '002_noname_11e79db9-ef3d-4444-8b2b-c0f0ddf82563': { label: 'chat.category.people', icon: 'lucideUsers' },
  '002_noname_b5c1e1fa-bd33-4c54-85b3-1ff3d4eba873': { label: 'chat.category.nature', icon: 'lucideDog' },
  '002_noname_482b6ec5-ef94-49b4-813a-54bd190f6bd3': { label: 'chat.category.food', icon: 'lucideUtensils' },
  '002_noname_4bb9f405-06d7-4e3f-86a5-e9371e29751e': { label: 'chat.category.travel', icon: 'lucidePlane' },
  '002_noname_b0b98c3f-db6b-46cf-b141-cdcce4b85d5a': { label: 'chat.category.objects', icon: 'lucideLightbulb' },
  '002_noname_72d64128-f20c-4c1b-b2bf-96184a804660': { label: 'chat.category.activities', icon: 'lucideTrophy' },
  '002_noname_3af9566b-f903-4a8b-b617-133bcda154e3': { label: 'chat.category.symbols', icon: 'lucideHash' },
};

/** Pictures that have loaded in this tab draw without a placeholder when scrolled back to, or on the next open. */
const loadedPictures = new Set<string>();

/**
 * Teams' emoji in one scroll area, with a GIF view when GIF search is available. Only the rows near the view exist, so a catalogue of
 * about 1650 emoji costs about a hundred nodes and pictures at a time. GIFs are asked for when their view is opened; a 503 hides it.
 */
@Component({
  selector: 'app-emoji-picker',
  imports: [TranslatePipe, NgIcon, HlmInput, HlmSkeletonImports, HlmSpinner, HlmTabsImports, HlmTooltip, EmojiView],
  providers: [provideIcons({ lucideDog, lucideHand, lucideHash, lucideLightbulb, lucidePlane, lucideSearch, lucideSmile, lucideTrophy, lucideUsers, lucideUtensils, lucideX })],
  styles: `
    .scroll-area {
      scrollbar-width: thin;
      scrollbar-gutter: stable;
    }
    .picture-waiting {
      border-radius: 9999px;
      background-color: var(--muted);
    }
  `,
  template: `
    <hlm-tabs [tab]="view()" class="w-full gap-2" (tabActivated)="openView($event)">
      @if (api.gifsAvailable() !== false) {
        <hlm-tabs-list [attr.aria-label]="'chat.emoji.tabs' | translate" class="w-full">
          <button hlmTabsTrigger="emoji">{{ 'chat.emoji.emoji' | translate }}</button>
          <button hlmTabsTrigger="gifs">{{ 'chat.gif.gifs' | translate }}</button>
        </hlm-tabs-list>
      }

      <div hlmTabsContent="emoji" class="flex flex-col gap-2" (keydown.escape)="toneOpen() && closeToneControl($event)">
        <div class="flex items-center gap-1.5">
          <div class="relative min-w-0 flex-1">
            <ng-icon name="lucideSearch" class="text-muted-foreground pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-sm" aria-hidden="true" />
            <label class="sr-only" for="emoji-search">{{ 'chat.emoji.search' | translate }}</label>
            <input #search hlmInput id="emoji-search" type="search" autocomplete="off" [placeholder]="'chat.emoji.search' | translate" class="h-8 w-full ps-7" [value]="query()" (input)="onQuery($any($event.target).value)" (keydown)="onSearchKey($event)" />
          </div>
          @if (hasDiverse()) {
            <div class="flex shrink-0 items-center gap-0.5" role="group" [attr.aria-label]="'chat.tone.label' | translate">
              @if (toneOpen()) {
                @for (o of toneOptions; track o.key) {
                  <button
                    type="button"
                    class="tone-option focus-visible:outline-ring flex size-6 items-center justify-center rounded-full focus-visible:outline-2"
                    [attr.aria-pressed]="tone.value() === o.key"
                    [attr.aria-label]="o.label | translate"
                    [title]="o.label | translate"
                    (click)="chooseTone(o.key)"
                  >
                    <span class="size-4 rounded-full border border-black/30" [style.background-color]="o.color" [class.ring-ring]="tone.value() === o.key" [class.ring-2]="tone.value() === o.key" [class.ring-offset-1]="tone.value() === o.key" aria-hidden="true"></span>
                  </button>
                }
              } @else {
                <button #toneButton type="button" class="hover:bg-accent focus-visible:outline-ring flex size-8 items-center justify-center rounded-md focus-visible:outline-2" aria-expanded="false" [attr.aria-label]="'chat.tone.current' | translate: { tone: (currentTone().label | translate) }" [hlmTooltip]="('chat.tone.label' | translate)" (click)="openToneControl()">
                  <span class="size-4 rounded-full border border-black/30" [style.background-color]="currentTone().color" aria-hidden="true"></span>
                </button>
              }
            </div>
          } @else if (loading()) {
            <hlm-skeleton class="m-2 size-4 shrink-0 rounded-full" />
          }
        </div>

        <div class="flex items-center justify-between" role="group" [attr.aria-label]="'chat.emoji.categories' | translate">
          @if (loading()) {
            @for (i of skeletonCategories; track i) {
              <hlm-skeleton class="m-1 size-6 rounded-md" />
            }
          } @else {
            @for (c of categories(); track c.id) {
              <button
                type="button"
                class="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:text-foreground flex size-8 items-center justify-center rounded-md focus-visible:outline-2"
                [attr.aria-pressed]="c.id === activeSection()"
                [attr.aria-label]="c.label"
                [hlmTooltip]="c.label"
                (click)="goToCategory(c.id)"
              >
                <ng-icon [name]="c.icon" aria-hidden="true" />
              </button>
            }
          }
        </div>

        <div class="relative">
          <div #scroller class="scroll-area h-72 overflow-y-auto" role="region" [attr.aria-label]="'chat.emoji.emoji' | translate" [attr.tabindex]="shownSections().length ? null : 0" (scroll)="onScroll()" (keydown)="onGridKey($event)">
            @if (loading()) {
              <div role="status" [attr.aria-label]="'chat.emoji.loading' | translate">
                <hlm-skeleton class="my-2 h-3 w-20" />
                <div class="grid" [style.grid-template-columns]="gridColumns()">
                  @for (i of skeletonCells(); track i) {
                    <span class="flex items-center justify-center" [style.height.px]="cellPx"><hlm-skeleton class="size-7 rounded-full" /></span>
                  }
                </div>
              </div>
            } @else if (failed()) {
              <div class="text-muted-foreground flex flex-col items-start gap-2 p-2 text-sm" role="alert">
                <p>{{ 'chat.emoji.loadFailed' | translate }}</p>
                <button type="button" class="hover:bg-accent focus-visible:outline-ring rounded-md border px-2 py-1 focus-visible:outline-2" (click)="retry()">{{ 'common.retry' | translate }}</button>
              </div>
            } @else if (shownSections().length) {
              @for (s of windowed(); track s.id) {
                <section [attr.aria-label]="s.title" [style.height.px]="s.height">
                  <h3 class="bg-popover text-muted-foreground sticky top-0 z-10 flex items-center text-xs font-medium" [style.height.px]="labelPx">{{ s.title }}</h3>
                  @if (s.shown.length) {
                    <ul class="grid" [style.grid-template-columns]="gridColumns()" [style.padding-top.px]="s.offset">
                      @for (t of s.shown; track t.id) {
                        @let toned = inTone(t);
                        <li>
                          <button
                            type="button"
                            class="hover:bg-accent focus-visible:outline-ring flex items-center justify-center rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2"
                            [style.width.px]="cellPx"
                            [style.height.px]="cellPx"
                            [attr.data-emoji]="t.id"
                            [attr.tabindex]="t.id === tabStop() ? 0 : -1"
                            [attr.aria-label]="t.label"
                            [title]="t.diverse ? ('chat.tone.hint' | translate: { name: t.label }) : t.label"
                            (mouseenter)="hoverStart(t)"
                            (mouseleave)="hoverEnd()"
                            (focus)="focused.set(t.id)"
                            (click)="onEmojiClick($event, t)"
                            (contextmenu)="onEmojiContext($event, t)"
                            (pointerdown)="pressStart(t)"
                            (pointerup)="pressEnd()"
                            (pointerleave)="pressEnd()"
                            (pointercancel)="pressEnd()"
                          >
                            @if (hovered() === t.id) {
                              <app-emoji [emoji]="hoverEmoji()!" [size]="28" [stillWhileLoading]="true" />
                            } @else if (toned.staticUrl && !brokenPictures().has(toned.staticUrl)) {
                              <img [src]="toned.staticUrl" alt="" width="28" height="28" referrerpolicy="no-referrer" [class.picture-waiting]="!loadedPictures.has(toned.staticUrl)" (load)="loadedPictures.add(toned.staticUrl)" (error)="onPictureError(toned.staticUrl)" />
                            } @else {
                              <span aria-hidden="true" class="text-xl">{{ toned.alt }}</span>
                            }
                          </button>
                        </li>
                      }
                    </ul>
                  }
                </section>
              }
            } @else {
              <p class="text-muted-foreground p-2 text-sm" role="status">{{ 'chat.emoji.none' | translate }}</p>
            }
          </div>

          @if (toneFor(); as target) {
            <div class="bg-popover absolute inset-x-0 bottom-0 z-20 flex items-center gap-0.5 rounded-md border p-1 shadow-md" role="group" [attr.aria-label]="'chat.tone.for' | translate: { name: target.label }" (keydown.escape)="closeEmojiTones($event)">
              @for (o of toneOptions; track o.key) {
                <button type="button" class="emoji-tone hover:bg-accent focus-visible:outline-ring flex size-9 items-center justify-center rounded-md focus-visible:outline-2" [attr.aria-label]="o.label | translate" [title]="o.label | translate" (click)="pickTone(target, o.key)">
                  <img [src]="toneOf(target, o.key).staticUrl" alt="" width="28" height="28" referrerpolicy="no-referrer" />
                </button>
              }
              <button type="button" class="hover:bg-accent focus-visible:outline-ring ms-auto flex size-8 items-center justify-center rounded-md focus-visible:outline-2" [attr.aria-label]="'chat.tone.close' | translate" (click)="toneFor.set(null)">
                <ng-icon name="lucideX" aria-hidden="true" />
              </button>
            </div>
          }
        </div>
      </div>

      @if (api.gifsAvailable() !== false) {
        <div hlmTabsContent="gifs" class="flex flex-col gap-2">
          <label class="sr-only" for="gif-search">{{ 'chat.gif.search' | translate }}</label>
          <input hlmInput id="gif-search" type="search" autocomplete="off" [placeholder]="'chat.gif.search' | translate" class="h-8" [value]="gifQuery()" (input)="onGifQuery($any($event.target).value)" />
          <div class="scroll-area h-[23.5rem] overflow-y-auto" tabindex="0" [attr.aria-label]="'chat.gif.gifs' | translate" role="region">
            @if (gifsLoading()) {
              <p class="text-muted-foreground flex items-center gap-2 p-2 text-sm" role="status"><hlm-spinner aria-hidden="true" />{{ 'chat.gif.loading' | translate }}</p>
            } @else if (gifError()) {
              <p class="text-muted-foreground p-2 text-sm" role="alert">{{ 'chat.gif.loadFailed' | translate }}</p>
            } @else if (!gifs().length) {
              <p class="text-muted-foreground p-2 text-sm" role="status">{{ 'chat.gif.none' | translate }}</p>
            } @else {
              <ul class="grid grid-cols-2 gap-1">
                @for (g of gifs(); track g.id) {
                  <li>
                    <button type="button" class="hover:ring-ring focus-visible:outline-ring block w-full overflow-hidden rounded-md hover:ring-2 focus-visible:outline-2" (click)="gif.emit(g)">
                      <img [src]="g.previewUrl || g.url" [alt]="g.title || 'GIF'" referrerpolicy="no-referrer" loading="lazy" class="h-24 w-full object-cover" />
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      }
    </hlm-tabs>
  `,
  host: { class: 'block w-full' },
})
export class EmojiPicker implements OnInit, OnDestroy {
  protected readonly api = inject(ChatApi);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly toneButton = viewChild<ElementRef<HTMLElement>>('toneButton');
  private resizeObserver: ResizeObserver | undefined;

  constructor() {
    afterNextRender(() => {
      // The popover overlay is a role=dialog the library leaves without a name.
      this.element.nativeElement.closest('[role="dialog"]')?.setAttribute('aria-label', t('chat.emoji.picker'));
      // The overlay moves focus to its first tabbable element once it has rendered; search goes after that.
      setTimeout(() => this.searchInput()?.nativeElement.focus());
      const scroller = this.scroller()?.nativeElement;
      if (!scroller) return;
      const measure = () => {
        if (scroller.clientWidth) this.columns.set(Math.max(MIN_COLUMNS, Math.floor(scroller.clientWidth / CELL_PX)));
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(measure);
        this.resizeObserver.observe(scroller);
      }
    });
  }

  readonly emoji = output<CatalogueEmoji>();
  readonly gif = output<Gif>();

  protected readonly cellPx = CELL_PX;
  protected readonly labelPx = LABEL_PX;
  protected readonly loadedPictures = loadedPictures;
  protected readonly skeletonCategories = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly toneOptions = TONE_OPTIONS;
  /** The chosen skin tone for diverse emojis, remembered in this browser; '0' is the default yellow. */
  protected readonly tone = persistedChoice<ToneKey>('schuly.chat.emojiTone', TONE_KEYS, '0');
  protected readonly currentTone = computed(() => TONE_OPTIONS.find((o) => o.key === this.tone.value()) ?? TONE_OPTIONS[0]);
  protected readonly toneOpen = signal(false);
  /** The emoji whose tone row is open (right-click or long-press). */
  protected readonly toneFor = signal<CatalogueEmoji | null>(null);
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressed = false;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly view = signal<'emoji' | 'gifs'>('emoji');
  protected readonly query = signal('');
  protected readonly hovered = signal<string | null>(null);
  protected readonly hoverEmoji = signal<CatalogueEmoji | null>(null);
  protected readonly focused = signal<string | null>(null);
  private readonly catalogue = signal<Catalogue | null>(this.api.catalogueNow());
  protected readonly loading = signal(!this.catalogue());
  protected readonly failed = signal(false);
  protected readonly brokenPictures = signal<ReadonlySet<string>>(new Set());
  private readonly columns = signal(DEFAULT_COLUMNS);
  private readonly scrollY = signal(0);
  /** The first row in view; it only changes when another row reaches the top, so scrolling within a row costs nothing. */
  private readonly scrollRow = computed(() => Math.floor(this.scrollY() / CELL_PX));

  protected readonly gifQuery = signal('');
  protected readonly gifs = signal<Gif[]>([]);
  protected readonly gifsLoading = signal(false);
  protected readonly gifError = signal(false);
  private gifsAsked = false;
  private gifTimer: ReturnType<typeof setTimeout> | undefined;
  private gifSeq = 0;

  protected readonly hasDiverse = computed(() => this.catalogue()?.all.some((e) => e.diverse) ?? false);
  protected readonly gridColumns = computed(() => `repeat(${this.columns()}, ${CELL_PX}px)`);
  protected readonly skeletonCells = computed(() => Array.from({ length: this.columns() * 7 }, (_, i) => i));
  protected readonly categories = computed(() =>
    (this.catalogue()?.categories ?? []).map((c) => ({ id: c.id, label: CATEGORIES[c.id] ? t(CATEGORIES[c.id].label) : c.title, icon: CATEGORIES[c.id]?.icon ?? 'lucideHash' })),
  );
  private readonly sections = computed(() => {
    const catalogue = this.catalogue();
    if (!catalogue) return [];
    const q = this.query().trim();
    if (q) {
      const items = searchCatalogue(catalogue, q);
      return items.length ? [{ id: 'results', title: t('chat.emoji.results'), items }] : [];
    }
    return catalogue.categories.map((c) => ({ id: c.id, title: CATEGORIES[c.id] ? t(CATEGORIES[c.id].label) : c.title, items: c.emojis }));
  });
  protected readonly shownSections = computed(() => layoutGrid(this.sections(), this.columns()));
  protected readonly windowed = computed(() => windowGrid(this.shownSections(), this.columns(), this.scrollRow() * CELL_PX, VIEW_PX));
  protected readonly activeSection = computed(() => (this.query().trim() ? null : (sectionAt(this.shownSections(), this.scrollY())?.id ?? null)));
  private readonly flat = computed(() => this.shownSections().flatMap((s) => s.items));
  /** The grid is one tab stop: the emoji last focused if it is still rendered, else the first rendered one. */
  protected readonly tabStop = computed(() => {
    const rendered = this.windowed().flatMap((s) => s.shown);
    const focused = this.focused();
    return rendered.find((e) => e.id === focused)?.id ?? rendered[0]?.id ?? null;
  });

  ngOnInit(): void {
    if (this.catalogue()) return;
    void this.loadEmoji();
  }

  private async loadEmoji(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    const catalogue = await this.api.catalogue();
    this.catalogue.set(catalogue);
    this.failed.set(!catalogue);
    this.loading.set(false);
  }

  protected retry(): void {
    void this.loadEmoji();
  }

  protected openView(view: string): void {
    if (view !== 'emoji' && view !== 'gifs') return;
    this.view.set(view);
    if (view === 'gifs' && !this.gifsAsked) {
      this.gifsAsked = true;
      void this.loadGifs(null);
    }
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.scrollTo(0);
  }

  protected onScroll(): void {
    const scroller = this.scroller()?.nativeElement;
    if (scroller) this.scrollY.set(scroller.scrollTop);
  }

  private scrollTo(top: number): void {
    const scroller = this.scroller()?.nativeElement;
    if (scroller) scroller.scrollTop = top;
    this.scrollY.set(top);
  }

  protected goToCategory(id: string): void {
    this.query.set('');
    const section = layoutGrid(this.sections(), this.columns()).find((s) => s.id === id);
    if (section) this.scrollTo(section.top);
  }

  // --- skin tones -------------------------------------------------------------

  protected openToneControl(): void {
    this.toneOpen.set(true);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>('.tone-option[aria-pressed="true"]')?.focus(), { injector: this.injector });
  }

  private collapseToneControl(): void {
    this.toneOpen.set(false);
    afterNextRender(() => this.toneButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeToneControl(event: Event): void {
    // Esc folds the control back; it closes the picker only when nothing is unfolded.
    event.stopPropagation();
    this.collapseToneControl();
  }

  protected chooseTone(key: ToneKey): void {
    this.tone.set(key);
    this.collapseToneControl();
  }

  protected closeEmojiTones(event: Event): void {
    event.stopPropagation();
    const id = this.toneFor()?.id;
    this.toneFor.set(null);
    if (id) this.focusEmoji(id);
  }

  protected toneOf(emoji: CatalogueEmoji, key: ToneKey): CatalogueEmoji {
    return key === '0' ? emoji : toneEmoji(emoji, Number(key) as SkinTone);
  }

  /** The emoji as the grid shows it: in the chosen skin tone when it has them. */
  protected inTone(emoji: CatalogueEmoji): CatalogueEmoji {
    return emoji.diverse ? this.toneOf(emoji, this.tone.value()) : emoji;
  }

  protected pickTone(emoji: CatalogueEmoji, key: ToneKey): void {
    this.toneFor.set(null);
    this.emoji.emit(this.toneOf(emoji, key));
  }

  private openEmojiTones(emoji: CatalogueEmoji): void {
    this.toneFor.set(emoji);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>('.emoji-tone')?.focus(), { injector: this.injector });
  }

  protected pressStart(emoji: CatalogueEmoji): void {
    clearTimeout(this.pressTimer);
    if (!emoji.diverse) return;
    this.pressTimer = setTimeout(() => {
      this.pressed = true;
      this.openEmojiTones(emoji);
    }, LONG_PRESS_MS);
  }

  protected pressEnd(): void {
    clearTimeout(this.pressTimer);
  }

  protected onEmojiContext(event: Event, emoji: CatalogueEmoji): void {
    if (!emoji.diverse) return;
    event.preventDefault();
    this.pressEnd();
    this.openEmojiTones(emoji);
  }

  // --- picking and the keyboard -------------------------------------------------

  protected onEmojiClick(event: MouseEvent, emoji: CatalogueEmoji): void {
    // The click that ends a long press only opened the tone row.
    if (this.pressed) {
      this.pressed = false;
      return;
    }
    this.emoji.emit(this.inTone(emoji));
    // Inserting moves focus to the message; someone on the keyboard stays where they are to pick another. A key press has no click count.
    if (event.detail === 0) this.focusEmoji(emoji.id);
  }

  protected onSearchKey(event: KeyboardEvent): void {
    const first = this.flat()[0];
    if (!first) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusEmoji(this.tabStop() ?? first.id);
    } else if (event.key === 'Enter' && this.query().trim()) {
      event.preventDefault();
      this.emoji.emit(this.inTone(first));
    }
  }

  protected onGridKey(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const id = (event.target as HTMLElement).getAttribute?.('data-emoji');
    if (!id) return;
    const list = this.flat();
    const index = list.findIndex((e) => e.id === id);
    if (index < 0) return;
    event.preventDefault();
    const sizes = this.shownSections().map((s) => s.items.length);
    if (event.key === 'ArrowUp' && index < this.columns() && sizes.length === 1) return this.searchInput()?.nativeElement.focus();
    const next = list[moveInGrid(sizes, this.columns(), index, event.key as GridKey)];
    if (next) this.focusEmoji(next.id);
  }

  /** Scrolls the emoji into view, which renders it, then focuses it. */
  private focusEmoji(id: string): void {
    const scroller = this.scroller()?.nativeElement;
    if (!scroller) return;
    for (const section of this.shownSections()) {
      const index = section.items.findIndex((e) => e.id === id);
      if (index < 0) continue;
      this.scrollTo(scrollForItem(section, index, this.columns(), scroller.scrollTop, scroller.clientHeight));
      break;
    }
    this.focused.set(id);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>(`[data-emoji="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }), { injector: this.injector });
  }

  protected hoverStart(emoji: CatalogueEmoji): void {
    clearTimeout(this.hoverTimer);
    // Sweeping across the grid starts no animations; resting on an emoji does.
    this.hoverTimer = setTimeout(() => {
      this.hoverEmoji.set(this.inTone(emoji));
      this.hovered.set(emoji.id);
    }, HOVER_ANIMATE_MS);
  }

  protected hoverEnd(): void {
    clearTimeout(this.hoverTimer);
    this.hovered.set(null);
  }

  protected onPictureError(url: string): void {
    this.brokenPictures.update((broken) => new Set(broken).add(url));
  }

  // --- GIFs ---------------------------------------------------------------------

  protected onGifQuery(value: string): void {
    this.gifQuery.set(value);
    clearTimeout(this.gifTimer);
    this.gifTimer = setTimeout(() => void this.loadGifs(value.trim() || null), 300);
  }

  private async loadGifs(query: string | null): Promise<void> {
    const seq = ++this.gifSeq;
    this.gifsLoading.set(true);
    this.gifError.set(false);
    const result = await this.api.gifs(query);
    if (seq !== this.gifSeq) return;
    this.gifsLoading.set(false);
    // Only GIFs from the allow-listed public hosts are shown or sent.
    if (result.status === 'ok') this.gifs.set(result.items.filter((g) => allowedMediaUrl(g.url) && (!g.previewUrl || allowedMediaUrl(g.previewUrl))));
    else if (result.status === 'unavailable') this.view.set('emoji');
    else this.gifError.set(true);
  }

  ngOnDestroy(): void {
    clearTimeout(this.pressTimer);
    clearTimeout(this.hoverTimer);
    clearTimeout(this.gifTimer);
    this.resizeObserver?.disconnect();
  }
}
