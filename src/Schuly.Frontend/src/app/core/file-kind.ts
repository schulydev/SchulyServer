import { t } from './i18n';
export type FileKind = 'word' | 'excel' | 'powerpoint' | 'pdf' | 'onenote' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'text' | 'other';

const KINDS: FileKind[] = ['word', 'excel', 'powerpoint', 'pdf', 'onenote', 'image', 'video', 'audio', 'archive', 'code', 'text', 'other'];

const BY_EXTENSION: Record<string, FileKind> = {
  doc: 'word', docx: 'word', docm: 'word', dot: 'word', dotx: 'word', odt: 'word', rtf: 'word',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', xlsb: 'excel', csv: 'excel', tsv: 'excel', ods: 'excel',
  ppt: 'powerpoint', pptx: 'powerpoint', pptm: 'powerpoint', pps: 'powerpoint', ppsx: 'powerpoint', odp: 'powerpoint',
  pdf: 'pdf',
  one: 'onenote', onetoc2: 'onenote',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', heic: 'image', heif: 'image', avif: 'image', tif: 'image', tiff: 'image',
  mp4: 'video', webm: 'video', mov: 'video', avi: 'video', mkv: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  js: 'code', ts: 'code', json: 'code', html: 'code', css: 'code', py: 'code', java: 'code', cs: 'code', xml: 'code', sh: 'code', sql: 'code',
  txt: 'text', log: 'text', md: 'text', markdown: 'text',
};

/** The file type shown on a card: the server's `kind` when it is one we know, else derived from the content type and the file name. */
export function fileKindOf(name: string, contentType?: string | null, kind?: string | null): FileKind {
  const given = (kind ?? '').toLowerCase();
  if ((KINDS as string[]).includes(given) && given !== 'other') return given as FileKind;
  const type = (contentType ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  const ext = extensionOf(name);
  return BY_EXTENSION[ext] ?? (type === 'application/pdf' ? 'pdf' : BY_MIME[type] ?? (type.startsWith('text/') ? 'text' : 'other'));
}

const extensionOf = (name: string): string => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

const BY_MIME: Record<string, FileKind> = {
  'text/csv': 'excel',
  'text/tab-separated-values': 'excel',
  'text/markdown': 'text',
  'application/json': 'code',
  'application/rtf': 'word',
  'application/vnd.oasis.opendocument.text': 'word',
  'application/vnd.oasis.opendocument.spreadsheet': 'excel',
  'application/vnd.oasis.opendocument.presentation': 'powerpoint',
};

/** More specific than the kind's label where a format has its own name; keyed by extension. */
const LABEL_BY_EXTENSION: Record<string, string> = {
  csv: 'files.type.csvFile',
  tsv: 'files.type.tsvFile',
  md: 'files.type.markdownFile',
  markdown: 'files.type.markdownFile',
  json: 'files.type.jsonFile',
  txt: 'files.type.textFile',
  log: 'files.type.logFile',
  rtf: 'files.type.richTextDocument',
  odt: 'files.type.opendocumentText',
  ods: 'files.type.opendocumentSpreadsheet',
  odp: 'files.type.opendocumentPresentation',
  heic: 'files.type.heicImage',
  heif: 'files.type.heifImage',
  avif: 'files.type.avifImage',
  webm: 'files.type.webmVideo',
  mov: 'files.type.quicktimeVideo',
  mp4: 'files.type.mp4Video',
  svg: 'files.type.svgImage',
  gif: 'files.type.gifImage',
  png: 'files.type.pngImage',
  jpg: 'files.type.jpegImage',
  jpeg: 'files.type.jpegImage',
  webp: 'files.type.webpImage',
};

const LABEL_BY_MIME: Record<string, string> = {
  'text/csv': 'files.type.csvFile',
  'text/tab-separated-values': 'files.type.tsvFile',
  'text/markdown': 'files.type.markdownFile',
  'application/json': 'files.type.jsonFile',
  'text/plain': 'files.type.textFile',
  'application/rtf': 'files.type.richTextDocument',
  'application/vnd.oasis.opendocument.text': 'files.type.opendocumentText',
  'application/vnd.oasis.opendocument.spreadsheet': 'files.type.opendocumentSpreadsheet',
  'application/vnd.oasis.opendocument.presentation': 'files.type.opendocumentPresentation',
  'image/heic': 'files.type.heicImage',
  'image/avif': 'files.type.avifImage',
  'video/webm': 'files.type.webmVideo',
  'video/quicktime': 'files.type.quicktimeVideo',
};

/** The label shown for a file's type: the format's own name when known (CSV file), else the kind's label (Excel workbook). */
export function fileTypeLabel(name: string, contentType?: string | null, kind?: string | null): string {
  const byName = LABEL_BY_EXTENSION[extensionOf(name)];
  if (byName) return t(byName);
  const byMime = LABEL_BY_MIME[(contentType ?? '').toLowerCase().split(';')[0].trim()];
  return t(byMime ?? KIND_STYLES[fileKindOf(name, contentType, kind)].label);
}

export interface KindStyle {
  icon: string;
  label: string;
  /** Tint on the card header (follows the theme). */
  tint: string;
  /** Tint on the white preview area (always light). */
  onWhite: string;
}

export const KIND_STYLES: Record<FileKind, KindStyle> = {
  word: { icon: 'lucideFileText', label: 'files.type.wordDocument', tint: 'text-blue-700 dark:text-blue-300', onWhite: 'text-blue-700' },
  excel: { icon: 'lucideFileSpreadsheet', label: 'files.type.excelWorkbook', tint: 'text-green-700 dark:text-green-300', onWhite: 'text-green-700' },
  powerpoint: { icon: 'lucideFileChartPie', label: 'files.type.powerpointPresentation', tint: 'text-orange-700 dark:text-orange-300', onWhite: 'text-orange-700' },
  pdf: { icon: 'lucideFileType', label: 'files.type.pdf', tint: 'text-red-700 dark:text-red-300', onWhite: 'text-red-700' },
  onenote: { icon: 'lucideNotebookPen', label: 'files.type.onenoteNotebook', tint: 'text-purple-700 dark:text-purple-300', onWhite: 'text-purple-700' },
  image: { icon: 'lucideFileImage', label: 'files.type.image', tint: 'text-teal-700 dark:text-teal-300', onWhite: 'text-teal-700' },
  video: { icon: 'lucideFileVideo', label: 'files.type.video', tint: 'text-pink-700 dark:text-pink-300', onWhite: 'text-pink-700' },
  audio: { icon: 'lucideFileAudio', label: 'files.type.audio', tint: 'text-cyan-700 dark:text-cyan-300', onWhite: 'text-cyan-700' },
  archive: { icon: 'lucideFileArchive', label: 'files.type.archive', tint: 'text-amber-800 dark:text-amber-300', onWhite: 'text-amber-800' },
  code: { icon: 'lucideFileCode', label: 'files.type.codeFile', tint: 'text-slate-700 dark:text-slate-300', onWhite: 'text-slate-700' },
  text: { icon: 'lucideFileText', label: 'files.type.textFile', tint: 'text-slate-700 dark:text-slate-300', onWhite: 'text-slate-700' },
  other: { icon: 'lucideFile', label: 'files.type.file', tint: 'text-slate-700 dark:text-slate-300', onWhite: 'text-slate-700' },
};
