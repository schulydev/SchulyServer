export type ViewKind = 'pdf' | 'office' | 'csv' | 'markdown' | 'json' | 'text' | 'audio' | 'video' | 'image' | 'none';
export type OfficeFamily = 'word' | 'sheet' | 'slides';

export interface Detected {
  kind: ViewKind;
  /** The type the blob is re-typed to; never taken from the server's header, except plain text. */
  type: string;
  ext: string;
  /** Set for Office formats. */
  family?: OfficeFamily;
  /** Markup shown only as source text (html, xml): it is never rendered. */
  source?: boolean;
}

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const OFFICE: Record<string, OfficeFamily> = {};
for (const e of 'docx doc docm dotx odt rtf'.split(' ')) OFFICE[e] = 'word';
for (const e of 'xlsx xls xlsm ods'.split(' ')) OFFICE[e] = 'sheet';
for (const e of 'pptx ppt pptm odp'.split(' ')) OFFICE[e] = 'slides';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  weba: 'audio/webm',
};
const VIDEO_TYPES: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg' };

const MARKUP = set('html htm xhtml xml');
const CODE = set(`txt text log ini cfg conf config properties env toml py js mjs cjs ts tsx jsx java cs c cpp cc cxx h hpp go rs rb php sh bash zsh ps1 bat cmd
  yml yaml css scss sass less sql kt kts swift dart lua tex bib r pl scala gradle vue svelte diff patch gitignore dockerfile makefile`);

export function extensionOf(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').toLowerCase();
  const i = base.lastIndexOf('.');
  if (i < 0) return base === 'dockerfile' || base === 'makefile' ? base : '';
  return base.slice(i + 1);
}

const startsWith = (bytes: Uint8Array, signature: (number | null)[], offset = 0) =>
  signature.length + offset <= bytes.length && signature.every((b, i) => b === null || bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 <= head.length; i++) {
    if (startsWith(head, [0x25, 0x50, 0x44, 0x46], i)) return true;
  }
  return false;
}

/** True when the sample looks like binary rather than text. */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  // eslint-disable-next-line no-control-regex
  return sample.some((b) => b === 0) || /[\u0001-\u0008\u000e-\u001f]/.test(new TextDecoder('utf-8').decode(sample));
}

/** Whether the viewer has a dedicated renderer for this file name (used to decide if a View button is worth showing). */
export function viewerSupports(name: string): boolean {
  const ext = extensionOf(name);
  if (!ext) return false;
  return (
    ext === 'pdf' || ext in OFFICE || ext in IMAGE_TYPES || ext in AUDIO_TYPES || ext in VIDEO_TYPES ||
    ext === 'csv' || ext === 'tsv' || ext === 'md' || ext === 'markdown' || ext === 'json' || MARKUP.has(ext) || CODE.has(ext)
  );
}

/** The kind of Office document judged by file name alone, so a server-side conversion can start before the original is fetched. */
export function officeFamilyOf(name: string): OfficeFamily | null {
  return OFFICE[extensionOf(name)] ?? null;
}

function officeFromBytes(bytes: Uint8Array): { ext: string; family: OfficeFamily } | null {
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return { ext: 'rtf', family: 'word' };
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return null;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8192));
  if (head.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return { ext: 'odt', family: 'word' };
  if (head.includes('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) return { ext: 'ods', family: 'sheet' };
  if (head.includes('mimetypeapplication/vnd.oasis.opendocument.presentation')) return { ext: 'odp', family: 'slides' };
  if (head.includes('word/')) return { ext: 'docx', family: 'word' };
  if (head.includes('xl/')) return { ext: 'xlsx', family: 'sheet' };
  if (head.includes('ppt/')) return { ext: 'pptx', family: 'slides' };
  return null;
}

function mediaFromBytes(bytes: Uint8Array, ext: string): { kind: 'audio' | 'video' | 'image'; type: string } | null {
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', type: 'image/avif' };
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return { kind: 'image', type: ext === 'heif' ? 'image/heif' : 'image/heic' };
    if (brand === 'qt  ') return { kind: 'video', type: 'video/quicktime' };
    if (brand === 'M4A ' || brand === 'M4B ' || ext === 'm4a') return { kind: 'audio', type: 'audio/mp4' };
    return { kind: 'video', type: 'video/mp4' };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return ext === 'weba' ? { kind: 'audio', type: 'audio/webm' } : { kind: 'video', type: 'video/webm' };
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return ext === 'ogv' ? { kind: 'video', type: 'video/ogg' } : { kind: 'audio', type: 'audio/ogg' };
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return { kind: 'audio', type: 'audio/mpeg' };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)) return { kind: 'audio', type: 'audio/wav' };
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return { kind: 'audio', type: 'audio/flac' };
  return null;
}

/**
 * What the file really is. The extension picks between text-like formats and Office types; magic bytes win for binary media.
 * The declared type is only trusted for plain text; markup (html, svg, xml) is never rendered, and svg only ever becomes an img.
 */
export function detect(name: string, bytes: Uint8Array, declared = ''): Detected {
  const ext = extensionOf(name);
  const result = (kind: ViewKind, type: string, extra: Partial<Detected> = {}): Detected => ({ kind, type, ext, ...extra });

  if (isPdfBytes(bytes)) return result('pdf', 'application/pdf');
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return result('image', 'image/png');
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return result('image', 'image/jpeg');
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return result('image', 'image/gif');
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return result('image', 'image/webp');
  if (ext === 'bmp' && startsWith(bytes, [0x42, 0x4d])) return result('image', 'image/bmp');

  const family = OFFICE[ext];
  if (family) return result('office', 'application/octet-stream', { family });

  const media = mediaFromBytes(bytes, ext);
  if (media) return result(media.kind, media.type);

  if (ext === 'svg') {
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096)).toLowerCase();
    return head.includes('<svg') ? result('image', 'image/svg+xml') : result('none', 'application/octet-stream');
  }
  if (ext in IMAGE_TYPES) return result('image', IMAGE_TYPES[ext]);
  if (ext in AUDIO_TYPES) return result('audio', AUDIO_TYPES[ext]);
  if (ext in VIDEO_TYPES) return result('video', VIDEO_TYPES[ext]);

  const textual = ext === 'csv' || ext === 'tsv' || ext === 'md' || ext === 'markdown' || ext === 'json' || MARKUP.has(ext) || CODE.has(ext);
  if (!textual) {
    const sniffed = officeFromBytes(bytes);
    if (sniffed) return result('office', 'application/octet-stream', { ext: sniffed.ext, family: sniffed.family });
  }
  if (textual) {
    if (looksBinary(bytes)) return result('none', 'application/octet-stream');
    if (ext === 'csv' || ext === 'tsv') return result('csv', 'text/plain');
    if (ext === 'md' || ext === 'markdown') return result('markdown', 'text/plain');
    if (ext === 'json') return result('json', 'text/plain');
    return result('text', 'text/plain', { source: MARKUP.has(ext) });
  }

  const type = declared.split(';')[0].trim().toLowerCase();
  if ((type === 'text/plain' || type === 'application/octet-stream' || type === '') && !looksBinary(bytes)) {
    if (type === 'text/plain') return result('text', 'text/plain');
    const text = new TextDecoder('utf-8').decode(bytes.subarray(0, 8192)).trimStart();
    if (text.length && !text.startsWith('<') && !text.startsWith('�')) return result('text', 'text/plain');
  }
  return result('none', 'application/octet-stream');
}

/** Whether a blob URL of this file may be opened in a browser tab without the browser interpreting it as a document. */
export function canOpenInTab(d: Detected): boolean {
  switch (d.kind) {
    case 'pdf':
    case 'audio':
    case 'video':
    case 'json':
    case 'csv':
      return true;
    case 'image':
      return d.type !== 'image/svg+xml';
    case 'text':
      return !d.source;
    default:
      return false;
  }
}
