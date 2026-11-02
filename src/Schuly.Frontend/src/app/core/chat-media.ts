import { FileKind } from './file-kind';

export type Importance = 'normal' | 'high' | 'urgent';

export interface MessageMedia {
  kind: 'hosted' | 'gif';
  url?: string | null;
  hostedContentId?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface MessageFile {
  id: string;
  name?: string | null;
  contentUrl?: string | null;
  contentType?: string | null;
  size?: number | null;
  /** word, excel, powerpoint, pdf, onenote, image, video, archive, code or other. */
  kind?: string | null;
  hasThumbnail?: boolean | null;
  /** Link to open the file in the service's web app. */
  webUrl?: string | null;
}

export interface MessageCard {
  id?: string | null;
  contentType?: string | null;
  teamsAppId?: string | null;
  name?: string | null;
  content?: unknown;
  sticker?: { url?: string | null; alt?: string | null } | null;
}

/** Media to show in a bubble: fetched as a blob from `path`, or shown straight from `src`. */
export interface BubbleMedia {
  key: string;
  kind: 'hosted' | 'gif' | 'local';
  src: string | null;
  path: string | null;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface BubbleFile {
  key: string;
  name: string;
  size: number | null;
  type: string;
  /** API path of the download; null while the file is still being sent. */
  path: string | null;
  kind: FileKind;
  /** API path of the thumbnail, when the server has one. */
  thumbnailPath: string | null;
  webUrl: string | null;
}

export interface BubbleSticker {
  key: string;
  /** Allow-listed public https URL. */
  src: string | null;
  path: null;
  alt: string;
}

export type CardBlock =
  | { kind: 'text'; text: string; bold: boolean; subtle: boolean; large: boolean }
  | { kind: 'image'; url: string; alt: string; host: string; trusted: boolean }
  | { kind: 'facts'; facts: { title: string; value: string }[] };

export interface CardView {
  key: string;
  title: string | null;
  blocks: CardBlock[];
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Public image hosts that GIFs and stickers may be loaded from, matched by exact host name. Requests to them carry no credentials and no referrer. */
const MEDIA_HOSTS = new Set([
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'i.giphy.com',
  'media.tenor.com',
  'media1.tenor.com',
  'c.tenor.com',
  'stickers.newfuture.cc',
  'statics.teams.cdn.office.net',
]);

/** The URL when it is https on exactly one of the allowed media hosts, else null. */
export function allowedMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && MEDIA_HOSTS.has(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

/** Hosts card images load from without asking: Microsoft's Teams and media CDNs, matched exactly or as a subdomain of these. */
const CARD_IMAGE_HOSTS = new Set(['statics.teams.cdn.office.net', 'teams.public.onecdn.static.microsoft']);
const CARD_IMAGE_DOMAINS = ['teams.microsoft.com', 'asm.skype.com'];

/** Whether a card image on this https URL may load unprompted; anything else waits for a click, since the sender sees when it is fetched. */
export function isTrustedCardImage(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const host = u.hostname.toLowerCase();
    return CARD_IMAGE_HOSTS.has(host) || CARD_IMAGE_DOMAINS.some((d) => host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** The host a card image comes from, for the "Show image" button; empty when the URL does not parse. */
export function cardImageHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export const isHttps = (url: string | null | undefined): url is string => !!url && /^https:\/\//i.test(url);

type Node = Record<string, unknown>;
const asNode = (value: unknown): Node | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : null);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads an adaptive card (a JSON string or object) into a flat list of read-only blocks. Actions are ignored. */
export function cardView(card: MessageCard, index: number): CardView | null {
  let content: unknown = card.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      return null;
    }
  }
  const root = asNode(content);
  if (!root) return null;
  const blocks: CardBlock[] = [];
  const walk = (items: unknown, depth: number) => {
    if (!Array.isArray(items) || depth > 5 || blocks.length > 60) return;
    for (const raw of items) {
      const item = asNode(raw);
      if (!item) continue;
      switch (item['type']) {
        case 'TextBlock':
        case 'RichTextBlock': {
          const value = item['type'] === 'TextBlock' ? text(item['text']) : (Array.isArray(item['inlines']) ? item['inlines'].map((i) => text(asNode(i)?.['text'] ?? i)).join('') : '');
          if (value.trim()) {
            blocks.push({
              kind: 'text',
              text: value,
              bold: item['weight'] === 'Bolder' || item['weight'] === 'bolder',
              subtle: item['isSubtle'] === true,
              large: ['Large', 'ExtraLarge', 'Medium'].includes(text(item['size'])),
            });
          }
          break;
        }
        case 'Image': {
          const url = text(item['url']);
          // Images behind a Microsoft sign-in cannot load from a bare URL; those are left out rather than fetched without credentials.
          if (isHttps(url) && !/graph\.microsoft\.com|hostedcontents/i.test(url)) {
            blocks.push({ kind: 'image', url, alt: text(item['altText']), host: cardImageHost(url), trusted: isTrustedCardImage(url) });
          }
          break;
        }
        case 'FactSet': {
          const facts = (Array.isArray(item['facts']) ? item['facts'] : [])
            .map((f) => ({ title: text(asNode(f)?.['title']), value: text(asNode(f)?.['value']) }))
            .filter((f) => f.title || f.value);
          if (facts.length) blocks.push({ kind: 'facts', facts });
          break;
        }
        case 'Container':
        case 'Column':
          walk(item['items'], depth + 1);
          break;
        case 'ColumnSet':
          for (const col of Array.isArray(item['columns']) ? item['columns'] : []) walk([col], depth + 1);
          break;
      }
    }
  };
  walk(root['body'], 0);
  if (!blocks.length) return null;
  const first = blocks[0];
  const title = first.kind === 'text' && (first.bold || first.large) ? first.text : null;
  return { key: card.id || `card-${index}`, title, blocks: title ? blocks.slice(1) : blocks };
}
