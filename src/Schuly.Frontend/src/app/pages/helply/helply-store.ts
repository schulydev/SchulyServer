import { Injectable, computed, inject, signal } from '@angular/core';
import { HelplyApi, HelplyHttpError } from '../../core/helply-api';
import {
  ChatState,
  GENERIC_ERROR,
  applyStreamEvent,
  beginTurn,
  emptyChat,
  prepareRetry,
  stopStreaming,
  toChatMessage,
} from '../../core/helply-state';
import { checkFiles } from '../../core/helply-files';
import { ApprovalDecision, ConversationSummary, HelplyAttachment, StreamEvent } from '../../core/helply-types';

export type Availability = 'loading' | 'on' | 'off' | 'error';

export const MAX_MESSAGE = 4000;

/** A file the user attached that has not been sent yet. */
export interface DraftFile {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  error: string | null;
  attachment: HelplyAttachment | null;
}

/** A friendly line for a failed upload; the server's detail is user-safe for 400 and 413. */
export function uploadErrorMessage(error: unknown, name: string): string {
  const e = error as { status?: number; error?: { detail?: unknown } };
  if ((e.status === 400 || e.status === 413) && typeof e.error?.detail === 'string' && e.error.detail) return e.error.detail;
  if (e.status === 413) return `${name} is too large.`;
  if (e.status === 429) return 'You are attaching files too quickly. Try again in a moment.';
  if (e.status === 404) return 'This conversation no longer exists.';
  return `${name} couldn't be uploaded.`;
}

const RATE_LIMITED = "You're sending messages too quickly. Try again in a moment.";

/** Page-level state for Helply. Provided by the page so it resets when you leave. */
@Injectable()
export class HelplyStore {
  private readonly api = inject(HelplyApi);
  private abort: AbortController | null = null;
  private counter = 0;
  private creating: Promise<string> | null = null;
  private readonly discarded = new Set<string>();

  readonly availability = signal<Availability>('loading');
  readonly conversations = signal<ConversationSummary[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly chat = signal<ChatState>(emptyChat());
  readonly streaming = signal(false);
  readonly loadingConversation = signal(false);
  /** Short status for the screen-reader live region. */
  readonly announcement = signal('');
  /** Errors that are not tied to an assistant message (list/rename/delete failures). */
  readonly notice = signal<string | null>(null);
  /** Decisions made on pending approvals, waiting until every card is answered. */
  readonly decisions = signal<Record<string, boolean>>({});
  /** Files attached to the message being written. */
  readonly drafts = signal<DraftFile[]>([]);
  /** Inline problems with the files the user just tried to attach. */
  readonly attachErrors = signal<string[]>([]);

  readonly messages = computed(() => this.chat().messages);
  readonly approvals = computed(() => this.chat().approvals);
  readonly uploading = computed(() => this.drafts().filter((d) => d.status === 'uploading').length);
  readonly uploaded = computed(() => this.drafts().filter((d) => d.status === 'done').length);
  readonly activeTitle = computed(() => this.conversations().find((c) => c.id === this.activeId())?.title ?? 'New chat');

  async init(): Promise<void> {
    this.availability.set('loading');
    try {
      const status = await this.api.status();
      if (!status.enabled) {
        this.availability.set('off');
        return;
      }
      this.conversations.set(await this.api.conversations());
      this.availability.set('on');
    } catch (error) {
      this.availability.set(this.offOrError(error));
    }
  }

  async select(id: string): Promise<void> {
    if (id === this.activeId() && !this.loadingConversation()) return;
    this.cancel();
    this.activeId.set(id);
    this.chat.set(emptyChat());
    this.decisions.set({});
    this.clearDrafts();
    this.loadingConversation.set(true);
    try {
      const conversation = await this.api.conversation(id);
      if (this.activeId() !== id) return;
      this.chat.set({
        messages: conversation.messages.map(toChatMessage),
        approvals: conversation.pendingApprovals ?? [],
        title: conversation.title,
        awaitingApproval: (conversation.pendingApprovals ?? []).length > 0,
      });
      if ((conversation.pendingApprovals ?? []).length) this.announcement.set('Helply needs your approval');
    } catch (error) {
      if (this.activeId() !== id) return;
      if (this.isDisabled(error)) return;
      this.notice.set(
        (error as { status?: number }).status === 404 ? 'That conversation no longer exists.' : "Couldn't open that conversation.",
      );
      this.activeId.set(null);
      await this.refreshList();
    } finally {
      if (this.activeId() === id || this.activeId() === null) this.loadingConversation.set(false);
    }
  }

  newChat(): void {
    this.cancel();
    this.activeId.set(null);
    this.chat.set(emptyChat());
    this.decisions.set({});
    this.clearDrafts();
    this.notice.set(null);
  }

  async send(rawText: string): Promise<void> {
    const text = rawText.trim();
    const files = this.drafts().filter((d) => d.status === 'done' && d.attachment);
    if ((!text && !files.length) || text.length > MAX_MESSAGE || this.streaming() || this.uploading()) return;
    const attachments = files.map((d) => d.attachment as HelplyAttachment);
    this.notice.set(null);
    this.chat.update((s) => beginTurn(s, text, new Date().toISOString(), String(++this.counter), attachments));
    this.decisions.set({});
    this.drafts.set(this.drafts().filter((d) => d.status === 'error'));
    this.attachErrors.set([]);
    const controller = this.begin();
    try {
      const id = await this.ensureConversation();
      await this.consume(
        this.api.sendMessage(id, text, attachments.map((a) => a.id), controller.signal),
        controller,
      );
    } catch (error) {
      this.fail(error, controller);
    } finally {
      this.end(controller);
    }
  }

  /** Starts uploading files the user picked, pasted or dropped. Invalid files are reported inline. */
  async attach(files: File[]): Promise<void> {
    if (!files.length) return;
    const waiting = this.drafts().filter((d) => d.status !== 'error').length;
    const { accepted, errors } = checkFiles(files, waiting);
    this.attachErrors.set(errors);
    if (errors.length) this.announcement.set(errors[0]);
    const entries = accepted.map((file): [DraftFile, File] => [
      { key: `draft-${++this.counter}`, name: file.name, size: file.size, status: 'uploading', error: null, attachment: null },
      file,
    ]);
    if (!entries.length) return;
    this.drafts.update((list) => [...list, ...entries.map(([d]) => d)]);
    await Promise.all(entries.map(([draft, file]) => this.upload(draft.key, file)));
  }

  async removeDraft(key: string): Promise<void> {
    const draft = this.drafts().find((d) => d.key === key);
    if (!draft) return;
    this.drafts.update((list) => list.filter((d) => d.key !== key));
    this.attachErrors.set([]);
    this.announcement.set(`Removed ${draft.name}`);
    if (draft.status === 'uploading') this.discarded.add(key);
    else if (draft.attachment) await this.discard(draft.attachment.id);
  }

  /** The bytes of an attachment of the open conversation, for the viewer and for download. */
  attachmentBlob(attachmentId: string): Promise<Blob> {
    const id = this.activeId();
    if (!id) return Promise.reject(new Error('No open conversation'));
    return this.api.attachmentBlob(id, attachmentId);
  }

  async retry(): Promise<void> {
    const id = this.activeId();
    if (!id || this.streaming()) return;
    this.chat.update(prepareRetry);
    const controller = this.begin();
    try {
      await this.consume(this.api.retry(id, controller.signal), controller);
    } catch (error) {
      this.fail(error, controller);
    } finally {
      this.end(controller);
    }
  }

  stop(): void {
    this.abort?.abort();
  }

  /** Records a decision; once every pending card is answered the decisions are posted and the turn continues. */
  async decide(approvalId: string, approved: boolean): Promise<void> {
    const id = this.activeId();
    if (!id || this.streaming()) return;
    const decisions = { ...this.decisions(), [approvalId]: approved };
    this.decisions.set(decisions);
    const pending = this.approvals();
    if (!pending.every((a) => a.approvalId in decisions)) return;

    const payload: ApprovalDecision[] = pending.map((a) => ({ approvalId: a.approvalId, approved: decisions[a.approvalId] }));
    const controller = this.begin();
    try {
      await this.consume(this.api.decide(id, payload, controller.signal), controller);
    } catch (error) {
      this.fail(error, controller);
    } finally {
      this.decisions.set({});
      this.end(controller);
    }
  }

  async rename(id: string, title: string): Promise<boolean> {
    try {
      const updated = await this.api.renameConversation(id, title.trim());
      this.conversations.update((list) => list.map((c) => (c.id === id ? updated : c)));
      return true;
    } catch (error) {
      if (!this.isDisabled(error)) this.notice.set("Couldn't rename that conversation.");
      return false;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.api.deleteConversation(id);
      this.conversations.update((list) => list.filter((c) => c.id !== id));
      if (this.activeId() === id) this.newChat();
      this.announcement.set('Conversation deleted');
    } catch (error) {
      if (!this.isDisabled(error)) this.notice.set("Couldn't delete that conversation.");
    }
  }

  async removeAll(): Promise<void> {
    try {
      await this.api.deleteAllConversations();
      this.conversations.set([]);
      this.newChat();
      this.announcement.set('All conversations deleted');
    } catch (error) {
      if (!this.isDisabled(error)) this.notice.set("Couldn't delete your conversations.");
    }
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.streaming.set(false);
  }

  /** The open conversation, created first when this is a brand-new chat. Concurrent callers share one request. */
  private ensureConversation(): Promise<string> {
    const id = this.activeId();
    if (id) return Promise.resolve(id);
    this.creating ??= this.api
      .createConversation()
      .then((created) => {
        this.conversations.update((list) => [created, ...list]);
        this.activeId.set(created.id);
        return created.id;
      })
      .finally(() => {
        this.creating = null;
      });
    return this.creating;
  }

  private async upload(key: string, file: File): Promise<void> {
    const patch = (change: Partial<DraftFile>) =>
      this.drafts.update((list) => list.map((d) => (d.key === key ? { ...d, ...change } : d)));
    try {
      const id = await this.ensureConversation();
      const attachment = await this.api.uploadAttachment(id, file);
      if (this.discarded.delete(key)) {
        await this.discard(attachment.id, id);
      } else if (this.activeId() === id) {
        patch({ status: 'done', attachment });
        this.announcement.set(`Attached ${file.name}`);
      }
    } catch (error) {
      if (this.discarded.delete(key)) return;
      if (this.isDisabled(error)) return;
      const message = uploadErrorMessage(error, file.name);
      patch({ status: 'error', error: message });
      this.announcement.set(message);
    }
  }

  private async discard(attachmentId: string, conversationId = this.activeId()): Promise<void> {
    if (!conversationId) return;
    try {
      await this.api.deleteAttachment(conversationId, attachmentId);
    } catch {
      /* the server wipes unsent files with the conversation */
    }
  }

  private clearDrafts(): void {
    this.drafts.set([]);
    this.attachErrors.set([]);
    this.discarded.clear();
  }

  private begin(): AbortController {
    const controller = new AbortController();
    this.abort = controller;
    this.streaming.set(true);
    this.announcement.set('Helply is typing');
    return controller;
  }

  private end(controller: AbortController): void {
    if (this.abort !== controller) return;
    this.abort = null;
    this.streaming.set(false);
  }

  private async consume(events: AsyncGenerator<StreamEvent>, controller: AbortController): Promise<void> {
    let finished = false;
    for await (const event of events) {
      if (this.abort !== controller) return;
      this.chat.update((s) => applyStreamEvent(s, event, new Date().toISOString()));
      if (event.type === 'approval_required') this.announcement.set('Helply needs your approval');
      if (event.type === 'error') {
        finished = true;
        this.announcement.set(event.message);
        if (event.code === 'disabled') this.availability.set('off');
      }
      if (event.type === 'done') {
        finished = true;
        this.onDone(event);
      }
    }
    if (!finished && this.abort === controller) {
      this.chat.update((s) => applyStreamEvent(s, { type: 'error', message: GENERIC_ERROR, code: 'unavailable', retryable: true }));
      this.announcement.set(GENERIC_ERROR);
    }
  }

  private onDone(event: Extract<StreamEvent, { type: 'done' }>): void {
    this.announcement.set(event.awaitingApproval ? 'Helply needs your approval' : 'Helply answered');
    const id = this.activeId();
    if (!id) return;
    const now = new Date().toISOString();
    this.conversations.update((list) => {
      const current = list.find((c) => c.id === id);
      if (!current) return list;
      return [{ ...current, title: event.title || current.title, updatedAt: now }, ...list.filter((c) => c.id !== id)];
    });
  }

  private fail(error: unknown, controller: AbortController): void {
    if (this.abort !== controller) return;
    if (controller.signal.aborted) {
      this.chat.update(stopStreaming);
      this.announcement.set('Stopped');
      return;
    }
    let message = GENERIC_ERROR;
    let retryable = true;
    if (error instanceof HelplyHttpError) {
      if (error.status === 503) {
        this.availability.set('off');
        return;
      }
      if (error.status === 429) message = RATE_LIMITED;
      else if (error.status === 409) {
        message = 'Helply is still working on the previous message. Try again in a moment.';
        retryable = false;
      } else if (error.status === 400) {
        message = "That message couldn't be sent. Check its length and try again.";
        retryable = false;
      } else if (error.status === 404) {
        message = 'This conversation no longer exists.';
        retryable = false;
        void this.refreshList();
      }
    }
    this.chat.update((s) => applyStreamEvent(s, { type: 'error', message, code: null, retryable }));
    this.announcement.set(message);
  }

  private isDisabled(error: unknown): boolean {
    if ((error as { status?: number }).status === 503) {
      this.availability.set('off');
      return true;
    }
    return false;
  }

  private offOrError(error: unknown): Availability {
    return (error as { status?: number }).status === 503 ? 'off' : 'error';
  }

  private async refreshList(): Promise<void> {
    try {
      this.conversations.set(await this.api.conversations());
    } catch {
      /* the list stays as it was */
    }
  }
}
