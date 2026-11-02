import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods } from '@ngrx/signals';
import { cleanPreview } from '../core/preview-text';
import { withAccountResource } from './account-resource';
import { LinkedAccountsStore } from './linked-accounts.store';

/** A mail message as the mail capability returns it from `<basePath>/{id}/mail`. */
export interface MailMessage {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  webLink?: string | null;
  hasAttachments?: boolean | null;
  flag?: { flagStatus?: string | null } | null;
  toRecipients?: { emailAddress?: { name?: string | null; address?: string | null } | null }[] | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } | null } | null;
}


/**
 * A drive item as the drive capability returns it from `<basePath>/{id}/files`. Folders carry `folder`, files carry `file`;
 * `@microsoft.graph.downloadUrl` is a short-lived pre-authenticated link and only present on files.
 */
export interface DriveItem {
  id: string;
  name?: string | null;
  size?: number | null;
  lastModifiedDateTime?: string | null;
  webUrl?: string | null;
  folder?: { childCount?: number | null } | null;
  file?: { mimeType?: string | null } | null;
  '@microsoft.graph.downloadUrl'?: string | null;
}

export const MailStore = signalStore(
  withAccountResource<MailMessage>('mail', 'mail', { folder: 'inbox', unread: false }, { pageSize: 25, max: 500 }),
  withComputed((store) => ({
    messages: computed(() =>
      store.items().map((m) => ({
        id: m.id,
        sender: m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown sender',
        address: m.from?.emailAddress?.address ?? null,
        subject: m.subject || '(no subject)',
        preview: cleanPreview(m.bodyPreview),
        flagged: m.flag?.flagStatus === 'flagged',
        hasAttachments: m.hasAttachments === true,
        to: (m.toRecipients ?? []).map((r) => r.emailAddress?.name || r.emailAddress?.address || '').filter(Boolean),
        received: m.receivedDateTime ?? null,
        unread: m.isRead === false,
        link: m.webLink ?? null,
      })),
    ),
    unreadOnly: computed(() => store.params()['unread'] === true),
    folder: computed(() => String(store.params()['folder'] ?? 'inbox')),
  })),
  withMethods((store) => ({
    setUnreadOnly: (unread: boolean) => store.setParam('unread', unread),
    setFolder: (folder: string) => store.setParam('folder', folder),
    /** Removes a message from the loaded list after it was deleted or moved. */
    drop: (id: string) => patchState(store, { items: store.items().filter((m) => m.id !== id) }),
    /** Applies a local change (read, flag) to a loaded message so the list matches without a reload. */
    patch: (id: string, change: Partial<MailMessage>) =>
      patchState(store, { items: store.items().map((m) => (m.id === id ? { ...m, ...change } : m)) }),
  })),
);


export type DriveKind = 'folder' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'archive' | 'file';

const extensionKinds: Record<string, DriveKind> = {
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document', txt: 'document', md: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation', key: 'presentation',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
};

const extensionOf = (name: string): string => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

const kindOf = (item: DriveItem, name: string): DriveKind => {
  if (item.folder) return 'folder';
  const mime = item.file?.mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (/zip|compressed|tar|rar/.test(mime)) return 'archive';
  if (/spreadsheet|ms-excel|csv/.test(mime)) return 'spreadsheet';
  if (/presentation|powerpoint/.test(mime)) return 'presentation';
  if (/wordprocessing|msword|opendocument\.text|rtf|^text\//.test(mime)) return 'document';
  return extensionKinds[extensionOf(name)] ?? 'file';
};

/** The `path` parameter of a folder given as the names from the drive root. */
const drivePath = (trail: string[]): string => (trail.length ? `root:/${trail.map(encodeURIComponent).join('/')}:` : 'root');

export const DriveStore = signalStore(
  withAccountResource<DriveItem>('drive', 'files', { path: 'root' }, { pageSize: 100, max: 1000 }),
  withComputed((store) => ({
    entries: computed(() =>
      store
        .items()
        .map((i) => {
          const name = i.name || 'Untitled';
          const kind = kindOf(i, name);
          return {
            id: i.id,
            name,
            kind,
            isFolder: kind === 'folder',
            size: i.size ?? 0,
            childCount: i.folder?.childCount ?? null,
            extension: extensionOf(name),
            mime: i.file?.mimeType ?? null,
            modified: i.lastModifiedDateTime ?? null,
            link: i.webUrl ?? null,
            download: i.folder ? null : (i['@microsoft.graph.downloadUrl'] ?? null),
          };
        })
        .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
    ),
  })),
  withMethods((store) => ({
    /** Opens a folder given as the names from the drive root; an empty trail is the root. */
    openFolder: (trail: string[]) => store.setParam('path', drivePath(trail)),
    /** Warms the cache for a folder (hover or focus) so opening it shows at once. */
    prefetchFolder: (trail: string[]) => store.prefetch({ path: drivePath(trail) }),
  })),
);

/** One row of `DriveStore.entries()`. */
export type DriveEntry = ReturnType<InstanceType<typeof DriveStore>['entries']>[number];
