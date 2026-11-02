import { Component, ElementRef, OnDestroy, OnInit, afterNextRender, computed, inject, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDog, lucideFlag, lucideHash, lucideLightbulb, lucidePlane, lucideSearch, lucideSmile, lucideStar, lucideTrophy, lucideUsers, lucideUtensils } from '@ng-icons/lucide';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { PickerGroup, filterPickerEmoji, loadEmojiGroups } from '../core/emoji';
import { allowedMediaUrl } from '../core/chat-media';
import { Gif, ChatApi } from '../core/chat-api';
import { Catalogue, CatalogueEmoji, EmojiRef, SkinTone, searchCatalogue, toneEmoji, tonedChar } from '../core/chat-emoji';
import { persistedChoice } from '../core/persisted';
import { EmojiView } from '../shared/emoji-view';

const TONE_KEYS = ['0', '1', '2', '3', '4', '5'] as const;
type ToneKey = (typeof TONE_KEYS)[number];
const TONE_OPTIONS: { key: ToneKey; label: string; color: string }[] = [
  { key: '0', label: 'Default skin tone', color: '#FFC83D' },
  { key: '1', label: 'Light skin tone', color: '#FADCBC' },
  { key: '2', label: 'Medium-light skin tone', color: '#E0BB95' },
  { key: '3', label: 'Medium skin tone', color: '#BF8F68' },
  { key: '4', label: 'Medium-dark skin tone', color: '#9B643D' },
  { key: '5', label: 'Dark skin tone', color: '#594539' },
];
const LONG_PRESS_MS = 500;

const GROUP_ICONS: Record<string, string> = {
  'smileys-emotion': 'lucideSmile',
  'people-body': 'lucideUsers',
  'animals-nature': 'lucideDog',
  'food-drink': 'lucideUtensils',
  'travel-places': 'lucidePlane',
  activities: 'lucideTrophy',
  objects: 'lucideLightbulb',
  symbols: 'lucideHash',
  flags: 'lucideFlag',
};

/**
 * Emoji tab and a GIF tab (only when GIF search is configured). The emoji tab shows Teams' own categories from the catalogue
 * (animated on hover) and falls back to categorized unicode when the server has no catalogue.
 */
@Component({
  selector: 'app-emoji-picker',
  imports: [NgIcon, HlmInput, HlmSpinner, HlmTabsImports, EmojiView],
  providers: [provideIcons({ lucideDog, lucideFlag, lucideHash, lucideLightbulb, lucidePlane, lucideSearch, lucideSmile, lucideStar, lucideTrophy, lucideUsers, lucideUtensils })],
  template: `
    <hlm-tabs tab="emoji" class="w-full">
      <hlm-tabs-list aria-label="Emoji or GIF" class="w-full">
        <button hlmTabsTrigger="emoji">Emoji</button>
        @if (api.gifsAvailable() === true) {
          <button hlmTabsTrigger="gifs">GIFs</button>
        }
      </hlm-tabs-list>

      <div hlmTabsContent="emoji" class="mt-2 flex flex-col gap-2">
        <label class="sr-only" for="emoji-search">Search emoji</label>
        <div class="flex items-center gap-2">
          <input hlmInput id="emoji-search" type="search" autocomplete="off" placeholder="Search emoji" class="min-w-0 flex-1" [value]="query()" (input)="query.set($any($event.target).value)" />
          @if (hasDiverse()) {
            <div class="flex shrink-0 items-center gap-0.5" role="group" aria-label="Skin tone">
              @for (o of toneOptions; track o.key) {
                <button
                  type="button"
                  class="focus-visible:outline-ring flex size-6 items-center justify-center rounded-full focus-visible:outline-2"
                  [attr.aria-pressed]="tone.value() === o.key"
                  [attr.aria-label]="o.label"
                  [title]="o.label"
                  (click)="tone.set(o.key)"
                >
                  <span class="size-4 rounded-full border border-black/30" [style.background-color]="o.color" [class.ring-ring]="tone.value() === o.key" [class.ring-2]="tone.value() === o.key" [class.ring-offset-1]="tone.value() === o.key" aria-hidden="true"></span>
                </button>
              }
            </div>
          }
        </div>
        @if (toneFor(); as target) {
          <div class="bg-muted flex items-center gap-1 rounded-md px-2 py-1" role="group" [attr.aria-label]="'Skin tone for ' + target.label" (keydown.escape)="toneFor.set(null)">
            <span class="text-muted-foreground me-1 truncate text-xs">{{ target.label }}</span>
            @for (o of toneOptions; track o.key) {
              <button
                type="button"
                class="hover:bg-accent focus-visible:outline-ring flex size-8 items-center justify-center rounded-md text-xl focus-visible:outline-2"
                [attr.aria-label]="o.label"
                [title]="o.label"
                (click)="pickTone(target, o.key)"
              >
                <span aria-hidden="true">{{ glyphIn(target, o.key) }}</span>
              </button>
            }
            <button type="button" class="hover:bg-accent focus-visible:outline-ring ms-auto rounded-md px-2 py-1 text-xs focus-visible:outline-2" (click)="toneFor.set(null)">Close</button>
          </div>
        }
        @if (!query().trim() && categories().length > 1) {
          <div class="flex max-h-16 flex-wrap gap-1 overflow-y-auto" role="group" aria-label="Emoji categories">
            @for (c of categories(); track c.key) {
              <button
                type="button"
                class="hover:bg-accent focus-visible:outline-ring aria-pressed:bg-accent flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-xs focus-visible:outline-2"
                [attr.aria-pressed]="c.key === active()"
                [title]="c.label"
                (click)="active.set(c.key)"
              >
                @if (c.icon) {
                  <ng-icon [name]="c.icon" aria-hidden="true" />
                  <span class="sr-only">{{ c.label }}</span>
                } @else {
                  <span class="max-w-20 truncate">{{ c.label }}</span>
                }
              </button>
            }
          </div>
        }
        <div class="h-56 overflow-y-auto" tabindex="0" aria-label="Emoji" role="region">
          @if (loading()) {
            <p class="text-muted-foreground flex items-center gap-2 p-2 text-sm" role="status"><hlm-spinner aria-hidden="true" />Loading emoji</p>
          } @else if (failed()) {
            <p class="text-muted-foreground p-2 text-sm" role="alert">Emoji could not be loaded.</p>
          } @else if (shownTeams().length || shownUnicode().length) {
            <ul class="grid grid-cols-8 gap-0.5">
              @for (t of shownTeams(); track t.id) {
                <li>
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:outline-ring flex size-9 items-center justify-center rounded-md focus-visible:outline-2"
                    [attr.aria-label]="t.label"
                    [title]="t.diverse ? t.label + ' (right-click or long-press for skin tones)' : t.label"
                    (mouseenter)="hovered.set(t.id)"
                    (focus)="hovered.set(t.id)"
                    (click)="onTeamsClick(t)"
                    (contextmenu)="onTeamsContext($event, t)"
                    (pointerdown)="pressStart(t)"
                    (pointerup)="pressEnd()"
                    (pointerleave)="pressEnd()"
                    (pointercancel)="pressEnd()"
                  >
                    @if (t.diverse && tone.value() !== '0') {
                      <span aria-hidden="true" class="text-xl">{{ glyphIn(t, tone.value()) }}</span>
                    } @else if (hovered() === t.id) {
                      <app-emoji [emoji]="{ kind: 'native', emoji: t }" [size]="28" />
                    } @else if (t.staticUrl) {
                      <img [src]="t.staticUrl" alt="" width="28" height="28" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                    } @else {
                      <span aria-hidden="true" class="text-xl">{{ t.alt }}</span>
                    }
                  </button>
                </li>
              }
              @for (e of shownUnicode(); track e.char) {
                <li>
                  <button type="button" class="hover:bg-accent focus-visible:outline-ring flex size-9 items-center justify-center rounded-md text-xl focus-visible:outline-2" [attr.aria-label]="e.label" [title]="e.label" (click)="pickUnicode(e.char, e.label)">
                    <span aria-hidden="true">{{ e.char }}</span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="text-muted-foreground p-2 text-sm" role="status">No emoji found.</p>
          }
        </div>
      </div>

      @if (api.gifsAvailable() === true) {
        <div hlmTabsContent="gifs" class="mt-2 flex flex-col gap-2">
          <label class="sr-only" for="gif-search">Search GIFs</label>
          <input hlmInput id="gif-search" type="search" autocomplete="off" placeholder="Search GIFs" [value]="gifQuery()" (input)="onGifQuery($any($event.target).value)" />
          <div class="h-56 overflow-y-auto" tabindex="0" aria-label="GIFs" role="region">
            @if (gifsLoading()) {
              <p class="text-muted-foreground flex items-center gap-2 p-2 text-sm" role="status"><hlm-spinner aria-hidden="true" />Loading GIFs</p>
            } @else if (gifError()) {
              <p class="text-muted-foreground p-2 text-sm" role="alert">GIFs could not be loaded.</p>
            } @else if (!gifs().length) {
              <p class="text-muted-foreground p-2 text-sm" role="status">No GIFs found.</p>
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

  constructor() {
    // The popover overlay is a role=dialog the library leaves without a name.
    afterNextRender(() => this.element.nativeElement.closest('[role="dialog"]')?.setAttribute('aria-label', 'Emoji and GIF picker'));
  }

  readonly emoji = output<EmojiRef>();
  readonly gif = output<Gif>();

  protected readonly toneOptions = TONE_OPTIONS;
  /** The chosen skin tone for diverse emojis, remembered in this browser; '0' is the default yellow. */
  protected readonly tone = persistedChoice<ToneKey>('schuly.chat.emojiTone', TONE_KEYS, '0');
  /** The emoji whose tone row is open (right-click or long-press). */
  protected readonly toneFor = signal<CatalogueEmoji | null>(null);
  protected readonly hasDiverse = computed(() => this.catalogue()?.all.some((e) => e.diverse) ?? false);
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressed = false;

  protected readonly query = signal('');
  protected readonly active = signal('');
  protected readonly hovered = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  private readonly groups = signal<PickerGroup[]>([]);
  private readonly catalogue = signal<Catalogue | null>(null);

  protected readonly gifQuery = signal('');
  protected readonly gifs = signal<Gif[]>([]);
  protected readonly gifsLoading = signal(false);
  protected readonly gifError = signal(false);
  private gifTimer: ReturnType<typeof setTimeout> | undefined;
  private gifSeq = 0;

  protected readonly categories = computed(() => {
    const cat = this.catalogue();
    if (cat) return cat.categories.map((c) => ({ key: c.id, label: c.title, icon: null as string | null }));
    return this.groups().map((g) => ({ key: g.key, label: g.label, icon: GROUP_ICONS[g.key] ?? 'lucideSmile' }));
  });
  protected readonly shownTeams = computed<CatalogueEmoji[]>(() => {
    const cat = this.catalogue();
    if (!cat) return [];
    const q = this.query().trim();
    if (q) return searchCatalogue(cat, q);
    return cat.categories.find((c) => c.id === this.active())?.emojis ?? [];
  });
  protected readonly shownUnicode = computed(() => {
    if (this.catalogue()) return [];
    const q = this.query().trim();
    if (q) return filterPickerEmoji(this.groups(), q);
    return this.groups().find((g) => g.key === this.active())?.emoji ?? [];
  });

  ngOnInit(): void {
    void this.loadEmoji();
    void this.loadGifs(null);
  }

  private async loadEmoji(): Promise<void> {
    try {
      // The catalogue is optional: without it the picker is plain unicode.
      const catalogue = await this.api.catalogue();
      if (catalogue) {
        this.catalogue.set(catalogue);
        this.active.set(catalogue.categories[0].id);
      } else {
        const groups = await loadEmojiGroups();
        this.groups.set(groups);
        this.active.set(groups[0]?.key ?? '');
      }
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

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
    else this.gifError.set(result.status === 'error');
  }

  protected pickUnicode(char: string, label: string): void {
    this.emoji.emit({ kind: 'unicode', char, label });
  }

  ngOnDestroy(): void {
    clearTimeout(this.pressTimer);
    clearTimeout(this.gifTimer);
  }

  protected glyphIn(emoji: CatalogueEmoji, tone: ToneKey): string {
    return tone === '0' ? emoji.alt : tonedChar(emoji.alt, Number(tone) as SkinTone);
  }

  protected pressStart(emoji: CatalogueEmoji): void {
    clearTimeout(this.pressTimer);
    if (!emoji.diverse) return;
    this.pressTimer = setTimeout(() => {
      this.pressed = true;
      this.toneFor.set(emoji);
    }, LONG_PRESS_MS);
  }

  protected pressEnd(): void {
    clearTimeout(this.pressTimer);
  }

  protected onTeamsContext(event: Event, emoji: CatalogueEmoji): void {
    if (!emoji.diverse) return;
    event.preventDefault();
    this.pressEnd();
    this.toneFor.set(emoji);
  }

  protected onTeamsClick(emoji: CatalogueEmoji): void {
    // The click that ends a long press only opened the tone row.
    if (this.pressed) {
      this.pressed = false;
      return;
    }
    this.pickTeams(emoji);
  }

  protected pickTeams(emoji: CatalogueEmoji): void {
    this.emitTone(emoji, this.tone.value());
  }

  protected pickTone(emoji: CatalogueEmoji, tone: ToneKey): void {
    this.toneFor.set(null);
    this.emitTone(emoji, tone);
  }

  private emitTone(emoji: CatalogueEmoji, tone: ToneKey): void {
    const chosen = emoji.diverse && tone !== '0' ? toneEmoji(emoji, Number(tone) as SkinTone) : emoji;
    this.emoji.emit({ kind: 'native', emoji: chosen });
  }
}
