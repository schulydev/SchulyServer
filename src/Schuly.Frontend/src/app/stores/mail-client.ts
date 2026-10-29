import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { swrCache } from '../core/swr-cache';
import { LinkedAccountsStore } from './linked-accounts.store';
import { viewerSupports } from '../shared/file-viewer/file-types';

export type FolderKind = 'inbox' | 'sent' | 'drafts' | 'archive' | 'deleted' | 'junk' | 'outbox' | 'history' | 'rss' | 'sync' | 'system' | 'other';

export interface MailFolder {
  /** Value for the list's `folder` parameter and for move: a well-known name when there is one, else the folder id. */
  key: string;
  name: string;
  kind: FolderKind;
  unread: number | null;
  /** Nesting level in the folder pane; 0 is top level. */
  depth: number;
  /** Rarely used system folders live under the collapsed "More" group. */
  group: 'main' | 'more';
}

interface GraphFolder {
  id?: string | null;
  displayName?: string | null;
  wellKnownName?: string | null;
  parentFolderId?: string | null;
  unreadItemCount?: number | null;
  childFolders?: GraphFolder[] | null;
}

interface GraphAddress {
  emailAddress?: { name?: string | null; address?: string | null } | null;
}

interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  webLink?: string | null;
  hasAttachments?: boolean | null;
  flag?: { flagStatus?: string | null } | null;
  from?: GraphAddress | null;
  toRecipients?: GraphAddress[] | null;
  ccRecipients?: GraphAddress[] | null;
  body?: { contentType?: string | null; content?: string | null } | null;
}

export interface MailPerson {
  name: string;
  address: string;
}

export interface MailDetail {
  id: string;
  subject: string;
  from: MailPerson | null;
  to: MailPerson[];
  cc: MailPerson[];
  received: string | null;
  html: boolean;
  body: string;
  hasAttachments: boolean;
  flagged: boolean;
  read: boolean;
  link: string | null;
}

export interface MailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  inline: boolean;
  /** The Content-ID a `cid:` reference in the body points at, normalised (see `normalizeCid`). */
  contentId: string | null;
}

interface GraphAttachment {
  id?: string | null;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean | null;
  contentId?: string | null;
}

/** A Content-ID or `cid:` reference in one comparable form: no `cid:` prefix, URL-decoded, no angle brackets, lower case. */
export function normalizeCid(value: string | null | undefined): string {
  let v = (value ?? '').trim().replace(/^cid:/i, '');
  try {
    v = decodeURIComponent(v);
  } catch {
    // A stray "%" stays as it is.
  }
  return v.trim().replace(/^<|>$/g, '').trim().toLowerCase();
}

/** Whether a body references inline parts. Graph reports `hasAttachments: false` for mails whose only attachments are inline images. */
export const referencesInlineParts = (body: string): boolean => /\bcid:/i.test(body);

const INLINE_IMAGE_MAX = 10 * 1024 * 1024;
const INLINE_TOTAL_MAX = 25 * 1024 * 1024;

/** The image type from the magic bytes (png, jpeg, gif, webp, bmp); anything else, svg included, is null and never inlined. */
export function imageTypeOf(bytes: Uint8Array): string | null {
  const at = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (at([0x42, 0x4d])) return 'image/bmp';
  return null;
}

const toDataUrl = (bytes: Uint8Array, type: string): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
};

export interface OutgoingMail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: { name: string; contentType: string; contentBase64: string }[];
}

/** `unavailable` means the server has no such endpoint yet (404/405/501), so the UI can degrade instead of failing. */
export type ActionResult = 'ok' | 'unavailable' | 'failed';

/** Largest total attachment size the server accepts. */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/** Only these may ever be shown inline, as an img from a blob URL; everything else is download-only. */
const PREVIEWABLE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** What the server names well-known folders (`wellKnownName`), with the order Outlook shows them in. */
const WELL_KNOWN: Record<string, { kind: FolderKind; rank: number; more?: boolean }> = {
  inbox: { kind: 'inbox', rank: 0 },
  drafts: { kind: 'drafts', rank: 1 },
  sentitems: { kind: 'sent', rank: 2 },
  deleteditems: { kind: 'deleted', rank: 3 },
  junkemail: { kind: 'junk', rank: 4 },
  archive: { kind: 'archive', rank: 5 },
  outbox: { kind: 'outbox', rank: 10, more: true },
  conversationhistory: { kind: 'history', rank: 11, more: true },
  rssfeeds: { kind: 'rss', rank: 12, more: true },
  syncissues: { kind: 'sync', rank: 13, more: true },
  conflicts: { kind: 'sync', rank: 14, more: true },
  localfailures: { kind: 'sync', rank: 15, more: true },
  serverfailures: { kind: 'sync', rank: 16, more: true },
  movejob: { kind: 'system', rank: 17, more: true },
};

/** Display names (English, German, French, Italian, Spanish) per well-known folder, compared after `normalizeName`. */
const NAMES: Record<string, string[]> = {
  inbox: ['Inbox', 'Posteingang', 'Boîte de réception', 'Posta in arrivo', 'Bandeja de entrada'],
  drafts: ['Drafts', 'Entwürfe', 'Brouillons', 'Bozze', 'Borradores'],
  sentitems: ['Sent Items', 'Sent', 'Gesendete Elemente', 'Gesendet', 'Éléments envoyés', 'Posta inviata', 'Elementi inviati', 'Elementos enviados'],
  deleteditems: ['Deleted Items', 'Gelöschte Elemente', 'Éléments supprimés', 'Posta eliminata', 'Elementi eliminati', 'Elementos eliminados'],
  junkemail: ['Junk Email', 'Junk E-mail', 'Junk-E-Mail', 'Courrier indésirable', 'Posta indesiderata', 'Correo electrónico no deseado', 'Correo no deseado'],
  archive: ['Archive', 'Archiv', 'Archives', 'Archivio', 'Archivo'],
  outbox: ['Outbox', 'Postausgang', "Boîte d'envoi", 'Posta in uscita', 'Bandeja de salida'],
  conversationhistory: ['Conversation History', 'Unterhaltungsverlauf', 'Historique des conversations', 'Cronologia conversazioni', 'Historial de conversaciones'],
  rssfeeds: ['RSS Feeds', 'RSS-Feeds', 'Flux RSS', 'Feed RSS', 'Suscripciones RSS'],
  syncissues: ['Sync Issues', 'Synchronisierungsprobleme', 'Problèmes de synchronisation', 'Problemi di sincronizzazione', 'Problemas de sincronización'],
  conflicts: ['Conflicts', 'Konflikte', 'Conflits', 'Conflitti', 'Conflictos'],
  localfailures: ['Local Failures', 'Lokale Fehler', 'Échecs locaux', 'Errori locali', 'Errores locales'],
  serverfailures: ['Server Failures', 'Serverfehler', 'Échecs du serveur', 'Errori del server', 'Errores del servidor'],
  movejob: ['Umzugs-Auftrag', 'Umzugsauftrag', 'Move Job'],
};

/** Lowercase, accent-free and without spaces or punctuation, so "Gelöschte Elemente" and "geloschteelemente" match. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const NAME_LOOKUP = new Map<string, string>(Object.entries(NAMES).flatMap(([key, names]) => names.map((n): [string, string] => [normalizeName(n), key])));

const MORE_PARENTS = new Set(['syncissues']);
const ID_KEYED = new Set(['inbox', 'drafts', 'sentitems', 'deleteditems', 'junkemail', 'archive', 'outbox']);

/** Shown when the server has no folder endpoint yet. */
export const FALLBACK_FOLDERS: MailFolder[] = [
  { key: 'inbox', name: 'Inbox', kind: 'inbox', unread: null, depth: 0, group: 'main' },
  { key: 'drafts', name: 'Drafts', kind: 'drafts', unread: null, depth: 0, group: 'main' },
  { key: 'sentitems', name: 'Sent Items', kind: 'sent', unread: null, depth: 0, group: 'main' },
  { key: 'deleteditems', name: 'Deleted Items', kind: 'deleted', unread: null, depth: 0, group: 'main' },
  { key: 'archive', name: 'Archive', kind: 'archive', unread: null, depth: 0, group: 'main' },
];

interface FolderNode {
  folder: GraphFolder;
  well: string | null;
  children: FolderNode[];
}

const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Outlook's order: Inbox, Drafts, Sent, Deleted, Junk, Archive, then own folders A-Z; rare system folders go to "More". */
export function orderFolders(items: GraphFolder[]): MailFolder[] {
  const nodes = new Map<string, FolderNode>();
  const all: FolderNode[] = [];
  // Nested childFolders count even when the server did not repeat them at the top level.
  const flat: GraphFolder[] = [];
  const collect = (list: GraphFolder[]) => {
    for (const f of list) {
      if (f.id && flat.some((g) => g.id === f.id)) continue;
      flat.push(f);
      collect(f.childFolders ?? []);
    }
  };
  collect(items);
  for (const folder of flat) {
    if (!folder.id || !folder.displayName) continue;
    const given = folder.wellKnownName?.toLowerCase().replace(/\s+/g, '') ?? '';
    const well = given && WELL_KNOWN[given] ? given : (NAME_LOOKUP.get(normalizeName(folder.displayName)) ?? null);
    const node: FolderNode = { folder, well, children: [] };
    all.push(node);
    nodes.set(folder.id, node);
  }
  const attached = new Set<FolderNode>();
  const adopt = (parent: FolderNode, child: FolderNode) => {
    if (attached.has(child) || child === parent) return;
    attached.add(child);
    parent.children.push(child);
  };
  for (const node of all) {
    for (const c of node.folder.childFolders ?? []) {
      const child = c.id ? nodes.get(c.id) : undefined;
      if (child) adopt(node, child);
    }
  }
  for (const node of all) {
    const parent = node.folder.parentFolderId ? nodes.get(node.folder.parentFolderId) : undefined;
    if (parent && !attached.has(node)) adopt(parent, node);
  }
  const tops = all.filter((n) => !attached.has(n));

  const rank = (n: FolderNode) => (n.well ? WELL_KNOWN[n.well].rank : Number.MAX_SAFE_INTEGER);
  const sort = (list: FolderNode[]) => [...list].sort((a, b) => rank(a) - rank(b) || compareNames(a.folder.displayName!, b.folder.displayName!));
  const main: MailFolder[] = [];
  const more: MailFolder[] = [];
  const walk = (node: FolderNode, depth: number, inMore: boolean) => {
    const info = node.well ? WELL_KNOWN[node.well] : null;
    const isMore = inMore || !!info?.more;
    const key = node.well && ID_KEYED.has(node.well) ? node.well : node.folder.id!;
    (isMore ? more : main).push({
      key,
      name: node.folder.displayName!,
      kind: info?.kind ?? 'other',
      unread: node.folder.unreadItemCount ?? null,
      depth,
      group: isMore ? 'more' : 'main',
    });
    for (const child of sort(node.children)) walk(child, depth + 1, isMore || (!!node.well && MORE_PARENTS.has(node.well)));
  };
  for (const node of sort(tops)) walk(node, 0, false);
  // A system child whose parent is not in "More" still starts at the top level of that group.
  const base = more.length ? Math.min(...more.map((f) => f.depth)) : 0;
  return [...main, ...more.map((f) => ({ ...f, depth: f.depth - base }))];
}

const person = (a?: GraphAddress | null): MailPerson | null => {
  const address = a?.emailAddress?.address ?? '';
  const name = a?.emailAddress?.name || address;
  return name || address ? { name, address } : null;
};

const people = (list?: GraphAddress[] | null): MailPerson[] => (list ?? []).map(person).filter((p): p is MailPerson => !!p);

const statusOf = (error: unknown): ActionResult =>
  error instanceof HttpErrorResponse && [404, 405, 501].includes(error.status) ? 'unavailable' : 'failed';

/** File name that is safe to hand to a download link: no path parts, control characters or leading dots, bounded length. */
export function safeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/^[._\s]+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'attachment';
}

/** Everything the Mail page does against accounts/{id}/mail/...; cached per account so folders and messages show at once. */
@Injectable()
export class MailClient {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);

  readonly folders = signal<MailFolder[]>(FALLBACK_FOLDERS);
  /** False while the server only offers the built-in folder list. */
  readonly foldersLive = signal(false);

  readonly detail = signal<MailDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailProblem = signal<'unavailable' | 'failed' | null>(null);
  readonly attachments = signal<MailAttachment[]>([]);
  /** Inline images of the open message: normalised Content-ID -> data: URL (the body iframe's CSP allows data: images only). */
  readonly inlineImages = signal<Record<string, string>>({});

  readonly mainFolders = computed(() => this.folders().filter((f) => f.group === 'main'));
  readonly moreFolders = computed(() => this.folders().filter((f) => f.group === 'more'));

  readonly unreadTotal = computed(() => this.folders().find((f) => f.kind === 'inbox')?.unread ?? null);

  private openSeq = 0;

  private base(): string | null {
    const base = this.accounts.endpoint('mail');
    return base ? `${base}/mail` : null;
  }

  private key(suffix: string): string {
    return `${this.accounts.selectedId('mail')}|mail|${suffix}`;
  }

  async loadFolders(): Promise<void> {
    const base = this.base();
    if (!base) return;
    const key = this.key('folders');
    const hit = swrCache.get<MailFolder[]>(key);
    if (hit) {
      this.folders.set(hit.data);
      this.foldersLive.set(true);
    }
    try {
      const items = await firstValueFrom(this.http.get<GraphFolder[]>(`${base}/folders`));
      if (!Array.isArray(items) || !items.length) throw new Error('no folders');
      const folders = orderFolders(items);
      swrCache.set(key, folders);
      this.folders.set(folders);
      this.foldersLive.set(true);
    } catch {
      // Without the endpoint (older server) the built-in list stays.
      if (!hit) {
        this.folders.set(FALLBACK_FOLDERS);
        this.foldersLive.set(false);
      }
    }
  }

  private parse(m: GraphMessage): MailDetail {
    return {
      id: m.id,
      subject: m.subject || '(no subject)',
      from: person(m.from),
      to: people(m.toRecipients),
      cc: people(m.ccRecipients),
      received: m.receivedDateTime ?? null,
      html: (m.body?.contentType ?? '').toLowerCase() === 'html',
      body: m.body?.content ?? '',
      hasAttachments: m.hasAttachments === true,
      flagged: m.flag?.flagStatus === 'flagged',
      read: m.isRead !== false,
      link: m.webLink ?? null,
    };
  }

  /** Shows the cached message at once (if any) and refreshes it. */
  async open(id: string): Promise<void> {
    const base = this.base();
    if (!base) return;
    const seq = ++this.openSeq;
    const key = this.key(`msg|${id}`);
    const hit = swrCache.get<MailDetail>(key);
    this.detailProblem.set(null);
    this.attachments.set([]);
    this.inlineImages.set({});
    const wantsAttachments = (d: MailDetail | undefined) => !!d && (d.hasAttachments || (d.html && referencesInlineParts(d.body)));
    if (hit) {
      this.detail.set(hit.data);
      this.detailLoading.set(false);
      if (wantsAttachments(hit.data)) void this.loadAttachments(id, seq);
    } else {
      this.detail.set(null);
      this.detailLoading.set(true);
    }
    try {
      const message = await firstValueFrom(this.http.get<GraphMessage>(`${base}/${encodeURIComponent(id)}`));
      if (seq !== this.openSeq) return;
      const detail = this.parse(message);
      swrCache.set(key, detail);
      this.detail.set(detail);
      this.detailLoading.set(false);
      if (wantsAttachments(detail) && !wantsAttachments(hit?.data)) void this.loadAttachments(id, seq);
    } catch (error) {
      if (seq !== this.openSeq) return;
      this.detailLoading.set(false);
      if (!hit) this.detailProblem.set(statusOf(error) === 'unavailable' ? 'unavailable' : 'failed');
    }
  }

  close(): void {
    this.openSeq++;
    this.detail.set(null);
    this.detailLoading.set(false);
    this.detailProblem.set(null);
    this.attachments.set([]);
    this.inlineImages.set({});
  }

  /** Warms the cache for a message the user is about to open (hover or focus). */
  prefetch(id: string): void {
    const base = this.base();
    if (!base) return;
    const key = this.key(`msg|${id}`);
    const hit = swrCache.get(key);
    if (hit && hit.age < 60_000) return;
    this.http.get<GraphMessage>(`${base}/${encodeURIComponent(id)}`).subscribe({
      next: (m) => swrCache.set(key, this.parse(m)),
      error: () => undefined,
    });
  }

  private async loadAttachments(id: string, seq: number): Promise<void> {
    const base = this.base();
    if (!base) return;
    try {
      const items = await firstValueFrom(this.http.get<GraphAttachment[]>(`${base}/${encodeURIComponent(id)}/attachments`));
      if (seq !== this.openSeq || !Array.isArray(items)) return;
      const attachments = items
        .filter((a) => a.id)
        .map((a) => ({
          id: a.id!,
          name: safeFileName(a.name ?? ''),
          contentType: (a.contentType ?? '').toLowerCase(),
          size: a.size ?? 0,
          inline: a.isInline === true,
          contentId: a.contentId ? normalizeCid(a.contentId) : null,
        }));
      this.attachments.set(attachments);
      const body = this.detail()?.body ?? '';
      if (referencesInlineParts(body)) void this.loadInlineImages(id, seq, attachments, body);
    } catch {
      // The message still reads fine without its attachment list.
    }
  }

  /** Fetches the images the body references by `cid:` (verified by their magic bytes, capped) and hands them to the body as data: URLs. */
  private async loadInlineImages(id: string, seq: number, attachments: MailAttachment[], body: string): Promise<void> {
    const referenced = new Set(Array.from(body.matchAll(/cid:([^"'\s>)]+)/gi), (m) => normalizeCid(m[1])));
    const wanted = attachments.filter((a) => a.contentId && referenced.has(a.contentId) && a.size <= INLINE_IMAGE_MAX && !a.contentType.includes('svg'));
    let total = 0;
    const images: Record<string, string> = {};
    await Promise.all(
      wanted.map(async (a) => {
        try {
          const bytes = new Uint8Array(await (await this.fetchAttachment(id, a)).arrayBuffer());
          const type = imageTypeOf(bytes);
          total += bytes.length;
          if (!type || bytes.length > INLINE_IMAGE_MAX || total > INLINE_TOTAL_MAX) return;
          images[a.contentId!] = toDataUrl(bytes, type);
        } catch {
          // A missing inline image only leaves its alt text.
        }
      }),
    );
    if (seq === this.openSeq && Object.keys(images).length) this.inlineImages.set(images);
  }

  /** Images and PDFs can be viewed in the app; the viewer re-checks the bytes before rendering anything. */
  isPreviewable(attachment: MailAttachment): boolean {
    return viewerSupports(attachment.name) || PREVIEWABLE_IMAGES.has(attachment.contentType) || attachment.contentType === 'application/pdf';
  }

  /** The attachment converted to PDF by the server (Office formats). */
  fetchAttachmentPdf(messageId: string, attachment: MailAttachment): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base()}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}/pdf`, { responseType: 'blob' }),
    );
  }

  /** Stable identity of an attachment, used to cache its converted PDF. */
  attachmentKey(messageId: string, attachment: MailAttachment): string {
    return `mail:${this.accounts.selectedId('mail')}:${messageId}:${attachment.id}`;
  }

  /** The attachment's bytes, fetched with the signed-in session; the server URL is never navigated to. */
  fetchAttachment(messageId: string, attachment: MailAttachment): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base()}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`, { responseType: 'blob' }),
    );
  }

  /**
   * Fetches the attachment with the signed-in session and saves it through a temporary download link. The URL is never navigated to,
   * opened in a tab or framed, and the blob is typed as opaque bytes so the browser can never render it.
   */
  async download(messageId: string, attachment: MailAttachment): Promise<boolean> {
    try {
      const blob = new Blob([await this.fetchAttachment(messageId, attachment)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeFileName(attachment.name);
      link.rel = 'noopener';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: unknown): Promise<ActionResult> {
    const base = this.base();
    if (!base) return 'failed';
    try {
      await firstValueFrom(this.http.post(`${base}/${path}`, body));
      return 'ok';
    } catch (error) {
      return statusOf(error);
    }
  }

  private forget(id: string): void {
    swrCache.invalidate(this.key(`msg|${id}`));
  }

  /** Lists are cached per folder; after a move, delete or send they must be refetched. */
  private forgetLists(): void {
    swrCache.invalidate(this.key('['));
  }

  async setRead(id: string, read: boolean): Promise<ActionResult> {
    const result = await this.post(`${encodeURIComponent(id)}/read`, { read });
    if (result === 'ok') {
      this.detail.update((d) => (d && d.id === id ? { ...d, read } : d));
      this.forget(id);
      this.forgetLists();
      void this.loadFolders();
    }
    return result;
  }

  async setFlag(id: string, flagged: boolean): Promise<ActionResult> {
    const result = await this.post(`${encodeURIComponent(id)}/flag`, { status: flagged ? 'flagged' : 'notFlagged' });
    if (result === 'ok') {
      this.detail.update((d) => (d && d.id === id ? { ...d, flagged } : d));
      this.forget(id);
      this.forgetLists();
    }
    return result;
  }

  async move(id: string, folder: string): Promise<ActionResult> {
    const result = await this.post(`${encodeURIComponent(id)}/move`, { folder });
    if (result === 'ok') {
      this.forget(id);
      this.forgetLists();
      void this.loadFolders();
    }
    return result;
  }

  async remove(id: string): Promise<ActionResult> {
    const base = this.base();
    if (!base) return 'failed';
    try {
      await firstValueFrom(this.http.delete(`${base}/${encodeURIComponent(id)}`));
      this.forget(id);
      this.forgetLists();
      void this.loadFolders();
      return 'ok';
    } catch (error) {
      return statusOf(error);
    }
  }

  reply(id: string, comment: string, replyAll: boolean): Promise<ActionResult> {
    return this.post(`${encodeURIComponent(id)}/reply`, { comment, replyAll });
  }

  forward(id: string, to: string[], comment: string): Promise<ActionResult> {
    return this.post(`${encodeURIComponent(id)}/forward`, { to, comment });
  }

  async send(mail: OutgoingMail): Promise<ActionResult> {
    const result = await this.post('send', { ...mail, html: false });
    if (result === 'ok') this.forgetLists();
    return result;
  }

  async saveDraft(mail: OutgoingMail): Promise<ActionResult> {
    const result = await this.post('drafts', { ...mail, html: false });
    if (result === 'ok') this.forgetLists();
    return result;
  }
}
