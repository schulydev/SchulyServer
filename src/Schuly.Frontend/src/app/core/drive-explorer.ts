import { t } from '../core/i18n';
import { FileKind, fileKindOf, fileTypeLabel } from './file-kind';

/** What the explorer needs of a drive entry; `DriveStore.entries()` items satisfy it. */
export interface ExplorerEntry {
  id: string;
  name: string;
  isFolder: boolean;
  size: number;
  modified: string | null;
  mime: string | null;
  childCount: number | null;
  /** The drive of an item outside the user's own OneDrive. */
  driveId?: string | null;
}

export type ExplorerSortKey = 'name' | 'modified' | 'type' | 'size';
export interface ExplorerSort {
  key: ExplorerSortKey;
  down: boolean;
}

export const EXPLORER_SORT_KEYS: readonly ExplorerSortKey[] = ['name', 'modified', 'type', 'size'];

/** The kind used for the icon, the Type column and the type sort. */
export function explorerKind(entry: Pick<ExplorerEntry, 'name' | 'isFolder' | 'mime'>): FileKind | 'folder' {
  return entry.isFolder ? 'folder' : fileKindOf(entry.name, entry.mime);
}

export function explorerTypeLabel(entry: Pick<ExplorerEntry, 'name' | 'isFolder' | 'mime'>): string {
  return entry.isFolder ? t('files.folder') : fileTypeLabel(entry.name, entry.mime);
}

const thumbnailKinds = new Set<FileKind>(['image', 'video', 'pdf', 'word', 'excel', 'powerpoint']);

/** Whether OneDrive is likely to render a preview image; other kinds keep their icon without asking. */
export function wantsThumbnail(entry: Pick<ExplorerEntry, 'name' | 'isFolder' | 'mime'>): boolean {
  if (entry.isFolder || /\.(svg|csv)$/i.test(entry.name)) return false;
  const kind = explorerKind(entry);
  return kind !== 'folder' && thumbnailKinds.has(kind);
}

/** Folders always lead, whichever way the column runs; ties fall back to the name. */
export function sortEntries<T extends ExplorerEntry>(entries: readonly T[], sort: ExplorerSort, locale?: string): T[] {
  const text = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const time = (e: T) => (e.modified ? Date.parse(e.modified) || 0 : 0);
  const by = (a: T, b: T): number => {
    switch (sort.key) {
      case 'modified':
        return time(a) - time(b) || text.compare(a.name, b.name);
      case 'size':
        return a.size - b.size || text.compare(a.name, b.name);
      case 'type':
        return text.compare(explorerTypeLabel(a), explorerTypeLabel(b)) || text.compare(a.name, b.name);
      default:
        return text.compare(a.name, b.name);
    }
  };
  return [...entries].sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || (sort.down ? by(b, a) : by(a, b)));
}

/** The ids from the anchor to the target, inclusive, in list order. */
export function rangeOf(ids: readonly string[], anchor: string, target: string): string[] {
  const from = ids.indexOf(anchor);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0) return [target];
  const [start, end] = from < to ? [from, to] : [to, from];
  return ids.slice(start, end + 1);
}

const units = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export { formatModified } from './date-format';
