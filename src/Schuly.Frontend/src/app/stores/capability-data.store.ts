import { t } from '../core/i18n';
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods } from '@ngrx/signals';
import { DriveView, MINE_ROOT, listingOf, parseView, serializeView } from '../core/drive-location';
import { cleanPreview } from '../core/preview-text';
import { ResponseCache } from '../core/response-cache';
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
  /** Present on items of teams, shared and recent listings: the drive the item lives in. */
  parentReference?: { driveId?: string | null } | null;
  shared?: { sharedBy?: { displayName?: string | null; email?: string | null } | null } | null;
}

export const MailStore = signalStore(
  withAccountResource<MailMessage>('mail', 'mail', { folder: 'inbox', unread: false }, { pageSize: 25, max: 500 }, {
    route: (params) => ({ path: 'mail', query: params }),
    cached: (params) => ({ path: 'cached/mail', query: params }),
  }),
  withComputed((store) => ({
    messages: computed(() =>
      store.items().map((m) => ({
        id: m.id,
        sender: m.from?.emailAddress?.name || m.from?.emailAddress?.address || t('mail.unknownSender'),
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
  withMethods((store, responses = inject(ResponseCache), accounts = inject(LinkedAccountsStore)) => ({
    /** Shows a change to the list at once, here and in the saved list, and undoes both if `send` reports a failure. */
    async optimistic(change: (items: MailMessage[]) => MailMessage[], send: () => Promise<boolean>): Promise<boolean> {
      const before = store.items();
      patchState(store, { items: change(before) });
      const base = accounts.endpoint('mail');
      const undo = base ? await responses.patch<MailMessage[]>(`${base}/cached/mail`, { ...store.params(), top: store.top() }, change) : null;
      const ok = await send();
      if (!ok) {
        patchState(store, { items: before });
        await undo?.();
      }
      return ok;
    },
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

/** One drive item as a row: kind, size, links. `own` marks a listing of the user's own OneDrive, whose items download by their pre-authenticated link. */
export function toDriveEntry(i: DriveItem, own: boolean) {
  const name = i.name || t('mail.untitled');
  const kind = kindOf(i, name);
  const driveId = own ? null : (i.parentReference?.driveId ?? null);
  const download = i.folder ? null : own ? (i['@microsoft.graph.downloadUrl'] ?? null) : null;
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
    download,
    /** The drive of an item outside the user's own OneDrive; null for own files. */
    driveId,
    /** Whether the bytes can be fetched: own files by their link, others through the drive item route. */
    openable: kind !== 'folder' && (!!download || !!driveId),
    sharedBy: i.shared?.sharedBy?.displayName ?? i.shared?.sharedBy?.email ?? null,
  };
}

const byFoldersThenName = (a: { isFolder: boolean; name: string }, b: { isFolder: boolean; name: string }) =>
  Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export const DriveStore = signalStore(
  withAccountResource<DriveItem>('drive', 'files', { view: serializeView(MINE_ROOT) }, { pageSize: 100, max: 1000 }, {
    route: (params) => {
      const listing = listingOf(parseView(params['view']));
      return { path: listing.path, query: listing.query };
    },
    unwrap: (body) => {
      const list = Array.isArray(body) ? body : (body as { items?: unknown } | null)?.items;
      return Array.isArray(list) ? (list as DriveItem[]) : [];
    },
  }),
  withComputed((store) => ({
    view: computed(() => parseView(store.params()['view'])),
    entries: computed(() => {
      const view = parseView(store.params()['view']);
      const entries = store.items().map((i) => toDriveEntry(i, view.location.kind === 'mine'));
      // Recent files stay in the order the service answers (newest first) while the root of the list is shown.
      return view.location.kind === 'recent' && !view.trail.length ? entries : entries.sort(byFoldersThenName);
    }),
  })),
  withMethods((store) => ({
    /** Shows a location and the folders opened inside it. */
    openView: (view: DriveView) => {
      const next = serializeView(view);
      if (store.params()['view'] !== next) store.setParam('view', next);
    },
    /** Warms the cache for a folder (hover or focus) so opening it shows at once. */
    prefetchView: (view: DriveView) => store.prefetch({ view: serializeView(view) }),
  })),
);

/** One row of `DriveStore.entries()`. */
export type DriveEntry = ReturnType<InstanceType<typeof DriveStore>['entries']>[number];
