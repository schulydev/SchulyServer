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
  csv: 'CSV file',
  tsv: 'TSV file',
  md: 'Markdown file',
  markdown: 'Markdown file',
  json: 'JSON file',
  txt: 'Text file',
  log: 'Log file',
  rtf: 'Rich text document',
  odt: 'OpenDocument text',
  ods: 'OpenDocument spreadsheet',
  odp: 'OpenDocument presentation',
  heic: 'HEIC image',
  heif: 'HEIF image',
  avif: 'AVIF image',
  webm: 'WebM video',
  mov: 'QuickTime video',
  mp4: 'MP4 video',
  svg: 'SVG image',
  gif: 'GIF image',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  webp: 'WebP image',
};

const LABEL_BY_MIME: Record<string, string> = {
  'text/csv': 'CSV file',
  'text/tab-separated-values': 'TSV file',
  'text/markdown': 'Markdown file',
  'application/json': 'JSON file',
  'text/plain': 'Text file',
  'application/rtf': 'Rich text document',
  'application/vnd.oasis.opendocument.text': 'OpenDocument text',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument spreadsheet',
  'application/vnd.oasis.opendocument.presentation': 'OpenDocument presentation',
  'image/heic': 'HEIC image',
  'image/avif': 'AVIF image',
  'video/webm': 'WebM video',
  'video/quicktime': 'QuickTime video',
};

/** The label shown for a file's type: the format's own name when known (CSV file), else the kind's label (Excel workbook). */
export function fileTypeLabel(name: string, contentType?: string | null, kind?: string | null): string {
  const byName = LABEL_BY_EXTENSION[extensionOf(name)];
  if (byName) return byName;
  const byMime = LABEL_BY_MIME[(contentType ?? '').toLowerCase().split(';')[0].trim()];
  return byMime ?? KIND_STYLES[fileKindOf(name, contentType, kind)].label;
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
  word: { icon: 'lucideFileText', label: 'Word document', tint: 'text-blue-700 dark:text-blue-300', onWhite: 'text-blue-700' },
  excel: { icon: 'lucideFileSpreadsheet', label: 'Excel workbook', tint: 'text-green-700 dark:text-green-300', onWhite: 'text-green-700' },
  powerpoint: { icon: 'lucideFileChartPie', label: 'PowerPoint presentation', tint: 'text-orange-700 dark:text-orange-300', onWhite: 'text-orange-700' },
  pdf: { icon: 'lucideFileType', label: 'PDF', tint: 'text-red-700 dark:text-red-300', onWhite: 'text-red-700' },
  onenote: { icon: 'lucideNotebookPen', label: 'OneNote notebook', tint: 'text-purple-700 dark:text-purple-300', onWhite: 'text-purple-700' },
  image: { icon: 'lucideFileImage', label: 'Image', tint: 'text-teal-700 dark:text-teal-300', onWhite: 'text-teal-700' },
  video: { icon: 'lucideFileVideo', label: 'Video', tint: 'text-pink-700 dark:text-pink-300', onWhite: 'text-pink-700' },
  audio: { icon: 'lucideFileAudio', label: 'Audio', tint: 'text-cyan-700 dark:text-cyan-300', onWhite: 'text-cyan-700' },
  archive: { icon: 'lucideFileArchive', label: 'Archive', tint: 'text-amber-800 dark:text-amber-300', onWhite: 'text-amber-800' },
  code: { icon: 'lucideFileCode', label: 'Code file', tint: 'text-slate-700 dark:text-slate-300', onWhite: 'text-slate-700' },
  text: { icon: 'lucideFileText', label: 'Text file', tint: 'text-slate-700 dark:text-slate-300', onWhite: 'text-slate-700' },
  other: { icon: 'lucideFile', label: 'File', tint: 'text-slate-700 dark:text-slate-300', onWhite: 'text-slate-700' },
};
