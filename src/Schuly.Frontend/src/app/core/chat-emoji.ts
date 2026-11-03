/** One of Teams' own emojis, in a message or in the picker: a still image, or a vertical sprite strip of `frames` square frames that animates. */
export interface ChatEmoji {
  /** Catalogue id (sent back as `<emoji id>`); the message key for emojis read from a message. */
  id: string;
  /** Accessible name, for example "hundred points". */
  label: string;
  /** The unicode character this emoji stands for; shown when an image cannot load. */
  alt: string;
  kind: 'native' | 'custom';
  documentId: string | null;
  animated: boolean;
  staticUrl: string | null;
  animatedUrl: string | null;
  /** Number of stacked frames in the animated sprite. */
  frames: number;
  frameMs: number;
  /** The idle pose, 1-based. */
  firstFrame: number;
  /** Edge of one frame in the asset, in pixels. */
  size: number;
}

/** An item of a message's `emojis[]`. */
export interface MessageEmoji {
  key?: string | null;
  id?: string | null;
  alt?: string | null;
  title?: string | null;
  kind?: string | null;
  documentId?: string | null;
  animated?: boolean | null;
  staticUrl?: string | null;
  animatedUrl?: string | null;
  frames?: number | null;
  frameMs?: number | null;
  firstFrame?: number | null;
  size?: number | null;
}

const TRUSTED_HOSTS = new Set(['statics.teams.cdn.office.net', 'teams.public.onecdn.static.microsoft']);

/** The URL when it is https on exactly one of the Teams emoji CDN hosts; anything else is not loaded. */
export function trustedEmojiUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TRUSTED_HOSTS.has(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

const count = (value: number | null | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback);

export function fromMessageEmoji(raw: MessageEmoji): ChatEmoji {
  const frames = count(raw.frames, 1);
  return {
    id: raw.key || raw.id || '',
    label: raw.title || raw.alt || '',
    alt: raw.alt || '',
    kind: raw.kind === 'custom' ? 'custom' : 'native',
    documentId: raw.documentId ?? null,
    animated: raw.animated !== false && frames > 1,
    staticUrl: trustedEmojiUrl(raw.staticUrl),
    animatedUrl: trustedEmojiUrl(raw.animatedUrl),
    frames,
    frameMs: count(raw.frameMs, 42),
    firstFrame: Math.min(count(raw.firstFrame, 1), frames),
    size: count(raw.size, 30),
  };
}

interface CatalogueEmojiRaw {
  id?: string;
  shortcuts?: string[];
  unicode?: string;
  title?: string;
  keywords?: string[];
  diverse?: boolean;
  animated?: boolean;
  staticUrl?: string;
  animatedUrl?: string;
  frames?: number;
  frameMs?: number;
  firstFrame?: number;
}

export interface CatalogueEmoji extends ChatEmoji {
  shortcuts: string[];
  keywords: string[];
  /** Has skin-tone variants, sent as `<id>-tone1` .. `<id>-tone5`. */
  diverse: boolean;
  /** Lower-cased title, keywords and shortcuts, for search. */
  haystack: string;
}

export interface CatalogueCategory {
  id: string;
  title: string;
  emojis: CatalogueEmoji[];
}

export interface Catalogue {
  categories: CatalogueCategory[];
  /** Normalized shortcut ("laugh", "smile") to emoji. */
  byShortcut: Map<string, CatalogueEmoji>;
  all: CatalogueEmoji[];
}

export const SKIN_TONES = [1, 2, 3, 4, 5] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

/** Unicode skin-tone modifiers (light to dark) for tone1 .. tone5. */
const TONE_MODIFIERS = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];

/** The character with a skin tone applied after its first code point. */
export function tonedChar(char: string, tone: SkinTone): string {
  const [first, ...rest] = Array.from(char.replace(/\uFE0F/g, ''));
  return first ? first + TONE_MODIFIERS[tone - 1] + rest.join('') : char;
}

/** The Teams picture in a skin tone: `.../30_f.png` is `.../30_f_s<tone+1>.png`, stills and sprites alike. */
function tonedUrl(url: string | null, tone: SkinTone): string | null {
  return url && url.replace(/_f(?:_s[2-6])?\.png/, `_f_s${tone + 1}.png`);
}

/** The emoji in a skin tone: id `<id>-tone<n>` as Teams expects, its picture in that tone, and the matching character as its fallback. */
export function toneEmoji<T extends ChatEmoji>(emoji: T, tone: SkinTone): T {
  return { ...emoji, id: `${emoji.id.replace(/-tone[1-5]$/, '')}-tone${tone}`, alt: tonedChar(emoji.alt, tone), staticUrl: tonedUrl(emoji.staticUrl, tone), animatedUrl: tonedUrl(emoji.animatedUrl, tone) };
}

/** `:smile:`, `(laugh)` and `laugh` all become `laugh`. */
export function normalizeShortcut(shortcut: string): string {
  return shortcut.trim().toLowerCase().replace(/^[:(]+/, '').replace(/[:)]+$/, '');
}

export function parseCatalogue(raw: unknown): Catalogue | null {
  const categoriesRaw = (raw as { categories?: { id?: string; title?: string; emojis?: CatalogueEmojiRaw[] }[] } | null)?.categories;
  if (!Array.isArray(categoriesRaw)) return null;
  const byShortcut = new Map<string, CatalogueEmoji>();
  const all: CatalogueEmoji[] = [];
  const categories: CatalogueCategory[] = [];
  for (const c of categoriesRaw) {
    const emojis: CatalogueEmoji[] = [];
    for (const e of c.emojis ?? []) {
      if (!e.id) continue;
      const base = fromMessageEmoji({ id: e.id, alt: e.unicode, title: e.title, animated: e.animated, staticUrl: e.staticUrl, animatedUrl: e.animatedUrl, frames: e.frames, frameMs: e.frameMs, firstFrame: e.firstFrame });
      const shortcuts = e.shortcuts ?? [];
      const keywords = e.keywords ?? [];
      const emoji: CatalogueEmoji = { ...base, id: e.id, shortcuts, keywords, diverse: e.diverse === true, haystack: [e.title ?? '', ...keywords, ...shortcuts].join(' ').toLowerCase() };
      emojis.push(emoji);
      all.push(emoji);
      for (const s of shortcuts) {
        const key = normalizeShortcut(s);
        if (key.length > 1 && !byShortcut.has(key)) byShortcut.set(key, emoji);
      }
    }
    if (emojis.length) categories.push({ id: c.id ?? c.title ?? String(categories.length), title: c.title ?? '', emojis });
  }
  return categories.length ? { categories, byShortcut, all } : null;
}

/** Teams emojis whose shortcut starts with, then contains, the query; each emoji once, under its best shortcut; at most `limit`. */
export function searchShortcuts(catalogue: Catalogue, query: string, limit = 8): { code: string; emoji: CatalogueEmoji }[] {
  const q = normalizeShortcut(query);
  if (!q) return [];
  const starts: { code: string; emoji: CatalogueEmoji }[] = [];
  const contains: { code: string; emoji: CatalogueEmoji }[] = [];
  for (const [code, emoji] of catalogue.byShortcut) {
    if (code.startsWith(q)) starts.push({ code, emoji });
    else if (code.includes(q)) contains.push({ code, emoji });
  }
  starts.sort((a, b) => Number(b.code === q) - Number(a.code === q) || a.code.length - b.code.length || a.code.localeCompare(b.code));
  const seen = new Set<CatalogueEmoji>();
  return [...starts, ...contains].filter((m) => !seen.has(m.emoji) && seen.add(m.emoji)).slice(0, limit);
}

/** The `:query` ending at the caret, when it starts a word and has at least two letters. */
export function emojiQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|[\s([{])(:([a-z][a-z0-9_+-]+))$/i.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length, query: match[3] } : null;
}

/** Search over title, keywords and shortcuts: every word of the query must appear. */
export function searchCatalogue(catalogue: Catalogue, query: string, limit = 120): CatalogueEmoji[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: CatalogueEmoji[] = [];
  for (const e of catalogue.all) {
    if (words.every((w) => e.haystack.includes(w))) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The app is in English, so the catalogue is too; emoji stay findable by words in the browser's language. Null when that is English anyway. */
export function searchLanguage(language: string | undefined): string | null {
  const lang = (language ?? '').toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(lang) && lang !== 'en' ? lang : null;
}

/** Each emoji's title and keywords from a catalogue in another language, by id. */
export function searchTerms(raw: unknown): Record<string, string> {
  const categories = (raw as { categories?: { emojis?: CatalogueEmojiRaw[] }[] } | null)?.categories;
  const terms: Record<string, string> = {};
  for (const c of Array.isArray(categories) ? categories : []) {
    for (const e of c.emojis ?? []) if (e.id) terms[e.id] = [e.title ?? '', ...(e.keywords ?? [])].join(' ').toLowerCase();
  }
  return terms;
}

/** Adds words in another language to what search looks through. */
export function addSearchTerms(catalogue: Catalogue, terms: Record<string, string>): void {
  for (const e of catalogue.all) if (terms[e.id]) e.haystack += ` ${terms[e.id]}`;
}
