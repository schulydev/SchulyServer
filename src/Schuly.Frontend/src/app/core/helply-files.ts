import { t } from '../core/i18n';
/** Client-side checks for files attached to a Helply message. The server stays the authority. */

export const ACCEPTED_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'csv', 'md', 'markdown', 'docx', 'xlsx', 'pptx',
] as const;
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 5;

export type FileKind = 'image' | 'document' | 'spreadsheet' | 'presentation' | 'other';

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function fileKind(name: string): FileKind {
  switch (extensionOf(name)) {
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp':
      return 'image';
    case 'pdf': case 'txt': case 'md': case 'markdown': case 'docx':
      return 'document';
    case 'csv': case 'xlsx':
      return 'spreadsheet';
    case 'pptx':
      return 'presentation';
    default:
      return 'other';
  }
}

const ICONS: Record<FileKind, string> = {
  image: 'lucideImage',
  document: 'lucideFileText',
  spreadsheet: 'lucideFileSpreadsheet',
  presentation: 'lucidePresentation',
  other: 'lucideFile',
};

export const fileIcon = (name: string): string => ICONS[fileKind(name)];

export interface FileCheck {
  accepted: File[];
  /** One friendly message per rejected file or limit. */
  errors: string[];
}

/** Splits files into the ones that may be attached and friendly errors for the rest. `existing` counts files already waiting. */
export function checkFiles(files: readonly File[], existing: number): FileCheck {
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
      errors.push(t('helply.attach.type', { name: file.name }));
    } else if (file.size > MAX_FILE_BYTES) {
      errors.push(t('helply.attach.size', { name: file.name }));
    } else if (file.size === 0) {
      errors.push(t('helply.attach.empty', { name: file.name }));
    } else if (existing + accepted.length >= MAX_FILES) {
      errors.push(t('helply.attach.max', { max: MAX_FILES }));
      break;
    } else {
      accepted.push(file);
    }
  }
  return { accepted, errors };
}

/** Send is possible with text or an uploaded file, and never while an upload runs or the text is too long. */
export function canSendMessage(state: { text: string; uploaded: number; uploading: number; tooLong: boolean }): boolean {
  return (!!state.text.trim() || state.uploaded > 0) && state.uploading === 0 && !state.tooLong;
}
