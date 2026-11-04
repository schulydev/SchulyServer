import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, output, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideArrowDown, lucideCornerUpRight, lucideExternalLink, lucideMessagesSquare, lucidePaperclip, lucideReply, lucideTriangleAlert, lucideCircleAlert } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { dayKey } from '../core/dates';
import { renderBody } from '../core/message-html';
import { presenceView } from '../core/presence';
import { keepFresh } from '../core/response-cache';
import { EmptyState } from '../shared/empty-state';
import { BubbleFile, BubbleMedia, BubbleSticker, CardView, Importance, allowedMediaUrl, cardView, isHttps } from '../core/chat-media';
import { describeEvent } from '../core/chat-events';
import { fileKindOf } from '../core/file-kind';
import { ChatApi } from '../core/chat-api';
import { ChatEmoji, fromMessageEmoji } from '../core/chat-emoji';
import { ChatMedia } from '../shared/chat-media';
import { EmojiSlots } from '../shared/emoji-slots';
import { FileViewer, ViewerFile } from '../shared/file-viewer';
import { ChatComposer } from './chat-composer';
import { ChatAvatar } from '../shared/chat-avatar';
import { LoadMore } from '../shared/load-more';
import { AccountProblem } from '../shared/account-problem';
import { PersonAvatar } from '../shared/person-avatar';
import { ChatStore, MessageQuote, bodyText } from '../stores/chat.store';
import { AppDatePipe, relativeDayLabel } from '../core/date-format';

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PRESENCE_POLL_MS = 60_000;
const NEAR_BOTTOM_PX = 80;

interface Attachment {
  name: string;
}
interface QuoteView {
  kind: 'forward' | 'reply';
  sender: string | null;
  sentAt: string | null;
  html: string;
  text: string;
  emojiKeys: string[];
  emojiMap: Record<string, ChatEmoji>;
  emojiSize: number;
}
interface Reaction {
  label: string;
  count: number;
}
type LogItem =
  | { kind: 'day'; key: string; label: string | null; date: string; showYear: boolean }
  | { kind: 'system'; key: string; text: string }
  | {
      kind: 'msg';
      key: string;
      localId: string | null;
      mine: boolean;
      senderId: string | null;
      senderName: string;
      head: boolean;
      time: string;
      deleted: boolean;
      html: string;
      text: string;
      attachments: Attachment[];
      quotes: QuoteView[];
      importance: Importance;
      media: BubbleMedia[];
      files: BubbleFile[];
      stickers: BubbleSticker[];
      cards: CardView[];
      emojiKeys: string[];
      emojiMap: Record<string, ChatEmoji>;
      emojiSize: number;
      reactions: Reaction[];
      status: 'sent' | 'sending' | 'failed';
    };

/** A forwarded message or reply, through the same sanitizing as any message body. */
function quoteView(q: MessageQuote): QuoteView {
  const rendered = renderBody(q.content, q.contentType);
  const emojiMap: Record<string, ChatEmoji> = {};
  for (const e of q.emojis ?? []) if (e.key) emojiMap[e.key] = fromMessageEmoji(e);
  return { kind: q.kind, sender: q.senderName ?? null, sentAt: q.sentAt ?? null, html: rendered.html, text: rendered.html ? '' : rendered.text, emojiKeys: rendered.emojiKeys, emojiMap, emojiSize: 24 };
}

@Component({
  selector: 'app-chat-conversation',
  imports: [AppDatePipe, NgTemplateOutlet, HlmButton, HlmSkeletonImports, NgIcon, ChatAvatar, ChatMedia, EmojiSlots, EmptyState, FileViewer, LoadMore, AccountProblem, PersonAvatar, ChatComposer],
  providers: [provideIcons({ lucideArrowLeft, lucideArrowDown, lucideCornerUpRight, lucideExternalLink, lucideMessagesSquare, lucidePaperclip, lucideReply, lucideTriangleAlert, lucideCircleAlert })],
  template: `
    @if (store.openChat(); as chat) {
      <header class="flex h-10 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <button hlmBtn variant="ghost" size="icon-sm" class="shrink-0 lg:hidden" title="Back to chats" (click)="back.emit()">
          <ng-icon name="lucideArrowLeft" aria-hidden="true" />
          <span class="sr-only">Back to chats</span>
        </button>
        <span class="relative inline-flex shrink-0">
          <app-chat-avatar [people]="chat.people" [oneOnOne]="chat.oneOnOne" [title]="chat.title" [image]="chat.image" [imageAvailable]="chat.hasImage" [chatId]="chat.id" size="compact" />
          @if (presence(); as status) {
            <span class="ring-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2" [class]="status.dot" aria-hidden="true"></span>
          }
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-sm leading-4 font-semibold">{{ chat.title }}</h2>
          @if (!chat.oneOnOne && chat.memberCount > 1) {
            <p class="text-muted-foreground truncate text-[11px] leading-3">{{ chat.memberCount }} people</p>
          } @else if (presence(); as status) {
            <p class="text-muted-foreground truncate text-[11px] leading-3">{{ status.label }}</p>
          }
        </div>
        @if (chat.link) {
          <a hlmBtn variant="ghost" size="sm" class="shrink-0" [href]="chat.link" target="_blank" rel="noopener">
            <span class="max-sm:sr-only">Open online</span>
            <ng-icon name="lucideExternalLink" class="text-base" aria-hidden="true" />
            <span class="sr-only">(opens in a new tab)</span>
          </a>
        }
      </header>

      <div class="relative min-h-0 flex-1">
        <div
          #log
          role="log"
          [attr.aria-live]="store.messagesLoadingMore() ? 'off' : 'polite'"
          aria-label="Messages"
          [attr.aria-busy]="store.messagesLoadingMore()"
          tabindex="0" class="absolute inset-0 overflow-x-hidden overflow-y-auto [overflow-anchor:none] focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2"
          (scroll)="onScroll()"
        >
          <div class="flex min-h-full w-full flex-col justify-end px-4 py-4 sm:px-6">
            <app-load-more
              label="Load older messages"
              [hasMore]="store.messagesMore()"
              [loading]="store.messagesLoadingMore()"
              [failed]="store.messagesMoreFailed()"
              [loaded]="store.messagesLoadedMore()"
              (more)="loadOlder()"
            />
            @if (store.messagesLoading()) {
              <div class="flex flex-col gap-6" aria-busy="true">
                @for (i of [1, 2, 3]; track i) {
                  <div class="flex gap-2">
                    <hlm-skeleton class="size-8 shrink-0 rounded-full" />
                    <div class="flex flex-1 flex-col gap-2">
                      <hlm-skeleton class="h-3 w-32" />
                      <hlm-skeleton class="h-10 w-3/4 rounded-lg" />
                    </div>
                  </div>
                }
              </div>
            } @else if (store.messagesProblem(); as problem) {
              <app-account-problem [problem]="problem" />
            } @else if (!items().length) {
              <app-empty-state icon="lucideMessagesSquare" title="No messages yet" description="Say hello to start the conversation." />
            } @else {
              @for (item of items(); track item.key) {
                @switch (item.kind) {
                  @case ('day') {
                    <div class="my-4 flex justify-center">
                      <time class="bg-muted text-foreground/70 rounded-full px-3 py-0.5 text-xs font-medium" [attr.datetime]="item.date">
                        {{ item.label ?? (item.date | appDate: (item.showYear ? 'weekdayDateLong' : 'weekdayDayMonthLong')) }}
                      </time>
                    </div>
                  }
                  @case ('system') {
                    <p class="text-muted-foreground my-2 text-center text-xs">{{ item.text }}</p>
                  }
                  @case ('msg') {
                    @if (item.mine) {
                      <div class="flex flex-col items-end" [class]="item.head ? 'mt-4' : 'mt-0.5'">
                        <div class="flex max-w-[85%] flex-col items-end" [class]="item.files.length ? 'sm:max-w-[95%]' : 'sm:max-w-[75%]'">
                          @if (item.head) {
                            <span class="text-muted-foreground mb-0.5 text-xs">
                              <time [attr.datetime]="item.time">{{ item.time | appDate: 'time' }}</time>
                            </span>
                          }
                          <ng-container *ngTemplateOutlet="bubble; context: { $implicit: item }" />
                          @if (item.status === 'failed') {
                            <div class="text-destructive mt-1 flex items-center gap-2 text-xs" role="alert">
                              Not sent.
                              <button type="button" class="underline underline-offset-2" (click)="store.retry(item.localId!)">Retry</button>
                              <button type="button" class="underline underline-offset-2" (click)="store.discard(item.localId!)">Discard</button>
                            </div>
                          }
                        </div>
                      </div>
                    } @else {
                      <div class="flex gap-2" [class]="item.head ? 'mt-4' : 'mt-0.5'">
                        <div class="w-8 shrink-0">
                          @if (item.head) {
                            <app-person-avatar [userId]="item.senderId" [name]="item.senderName" />
                          }
                        </div>
                        <div class="flex max-w-[85%] min-w-0 flex-col items-start" [class]="item.files.length ? 'sm:max-w-[95%]' : 'sm:max-w-[75%]'">
                          @if (item.head) {
                            <div class="mb-0.5 flex items-baseline gap-2">
                              <span class="text-sm font-semibold">{{ item.senderName }}</span>
                              <span class="text-muted-foreground text-xs"><time [attr.datetime]="item.time">{{ item.time | appDate: 'time' }}</time></span>
                            </div>
                          }
                          <ng-container *ngTemplateOutlet="bubble; context: { $implicit: item }" />
                        </div>
                      </div>
                    }
                  }
                }
              }
            }
          </div>
        </div>
        @if (newBelow()) {
          <button
            type="button"
            hlmBtn
            variant="secondary"
            size="sm"
            class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            (click)="jumpToLatest()"
          >
            <ng-icon name="lucideArrowDown" aria-hidden="true" />
            New messages
          </button>
        }
      </div>

      <app-chat-composer #composer class="w-full px-4 pt-1 pb-4 sm:px-6" [chat]="chat" (sent)="onSent()" />
    }

    <app-file-viewer [file]="viewing()" (closed)="viewing.set(null)" />

    <ng-template #bubble let-m>
      @if (m.deleted) {
        <p class="text-muted-foreground px-1 text-sm italic">This message has been deleted</p>
      } @else {
        <div
          class="min-w-0 max-w-full rounded-lg px-3 py-2 text-sm wrap-anywhere"
          [class]="m.mine ? 'bg-sky-100 text-foreground dark:bg-sky-900/45' : 'bg-muted text-foreground'"
          [class.opacity-60]="m.status === 'sending'"
        >
          @if (m.importance !== 'normal') {
            <p
              class="mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-semibold"
              [class]="m.importance === 'urgent' ? 'border-red-700 bg-red-100 text-red-900 dark:border-red-300 dark:bg-red-950 dark:text-red-100' : 'border-amber-700 bg-amber-100 text-amber-900 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-100'"
            >
              <ng-icon [name]="m.importance === 'urgent' ? 'lucideTriangleAlert' : 'lucideCircleAlert'" aria-hidden="true" />
              {{ m.importance === 'urgent' ? 'Urgent' : 'Important' }}
            </p>
          }
          @for (q of m.quotes; track $index) {
            <blockquote class="border-border bg-background/50 mb-1.5 max-w-full rounded-md border-s-2 px-2.5 py-1.5 text-sm" [attr.aria-label]="(q.kind === 'forward' ? 'Forwarded message' : 'Reply') + (q.sender ? ' from ' + q.sender : '')">
              <p class="text-foreground/70 flex flex-wrap items-center gap-x-1.5 text-xs">
                <ng-icon [name]="q.kind === 'forward' ? 'lucideCornerUpRight' : 'lucideReply'" aria-hidden="true" />
                <span class="font-medium">{{ q.sender ?? (q.kind === 'forward' ? 'Forwarded message' : 'Reply') }}</span>
                @if (q.sentAt) {
                  <time [attr.datetime]="q.sentAt">{{ q.sentAt | appDate: 'dateTime' }}</time>
                }
              </p>
              @if (q.html) {
                <div class="mt-1 wrap-anywhere" [innerHTML]="q.html" [appEmojiSlots]="q.html" [keys]="q.emojiKeys" [emojis]="q.emojiMap" [size]="q.emojiSize"></div>
              } @else if (q.text) {
                <p class="mt-1 wrap-anywhere whitespace-pre-wrap">{{ q.text }}</p>
              }
            </blockquote>
          }
          @if (m.html) {
            <div
              class="leading-relaxed wrap-anywhere [&_.mention]:bg-primary/15 [&_.mention]:rounded-sm [&_.mention]:px-1 [&_.mention]:font-medium [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_img]:max-w-full [&_img]:rounded-md [&_ol]:list-decimal [&_ol]:ps-5 [&_p+p]:mt-2 [&_pre]:overflow-x-auto [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:ps-5"
              [innerHTML]="m.html"
              [appEmojiSlots]="m.html"
              [keys]="m.emojiKeys"
              [emojis]="m.emojiMap"
              [size]="m.emojiSize"
              (click)="onBodyClick($event)"
            ></div>
          } @else if (m.text) {
            <p class="leading-relaxed wrap-anywhere whitespace-pre-wrap">{{ m.text }}</p>
          }
          <app-chat-media
            class="[&:not(:empty)]:mt-1.5"
            [media]="m.media"
            [files]="m.files"
            [stickers]="m.stickers"
            [cards]="m.cards"
            (view)="viewing.set($event)"
          />
          @if (m.attachments.length) {
            <ul class="mt-1.5 flex flex-wrap gap-2">
              @for (a of m.attachments; track $index) {
                <li class="bg-background/70 flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                  <ng-icon name="lucidePaperclip" aria-hidden="true" />
                  <span class="truncate">{{ a.name }}</span>
                  @if (store.openChat()?.link; as link) {
                    <span class="text-muted-foreground" aria-hidden="true">&middot;</span>
                    <a class="shrink-0 font-medium underline underline-offset-2" [href]="link" target="_blank" rel="noopener">
                      Open online<span class="sr-only"> (opens in a new tab)</span>
                    </a>
                  }
                </li>
              }
            </ul>
          }
        </div>
      }
      @if (m.reactions.length) {
        <ul class="relative z-10 -mt-2 flex flex-wrap gap-1 px-2" [class]="m.mine ? 'justify-end' : ''" aria-label="Reactions">
          @for (r of m.reactions; track r.label) {
            <li class="bg-background text-foreground rounded-full border px-2 py-px text-xs shadow-xs">{{ r.label }} {{ r.count }}</li>
          }
        </ul>
        <span class="mb-1 block"></span>
      }
    </ng-template>
  `,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class ChatConversation {
  private loadPresence(): void {
    const id = this.oneOnOneId();
    if (!id) return;
    void this.api.presence(id).then((availability) => {
      if (this.oneOnOneId() === id) this.availability.set(availability);
    });
  }

  protected readonly store = inject(ChatStore);
  private readonly injector = inject(Injector);

  readonly back = output<void>();

  private readonly api = inject(ChatApi);

  /** The open chat when it is 1:1: a status belongs to one person, and a list refresh must not restart this. */
  private readonly oneOnOneId = computed(() => {
    const chat = this.store.openChat();
    return chat?.oneOnOne ? chat.id : null;
  });
  private readonly availability = signal<string | null>(null);
  protected readonly presence = computed(() => presenceView(this.availability()));
  protected readonly viewing = signal<ViewerFile | null>(null);
  private readonly localUrls = new Map<File, string>();
  protected readonly newBelow = signal(false);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly composer = viewChild<ChatComposer>('composer');

  /** Scroll geometry from just before older messages were requested; restoring it keeps the same message in view. */
  private anchor: { height: number; top: number } | null = null;
  private atBottom = true;
  private forceScroll = true;
  private lastKey: string | null = null;

  protected readonly items = computed<LogItem[]>(() => {
    const chatId = this.store.openId();
    const mine = this.store.meId();
    const currentYear = new Date().getFullYear();
    const people = new Map((this.store.openChat()?.people ?? []).filter((p) => p.id).map((p) => [p.id as string, p.name]));
    if (mine) people.set(mine, 'You');

    const entries = [
      ...this.store.messages().map((m) => ({ message: m, pending: null })),
      ...this.store.pending().filter((p) => p.chatId === chatId).map((p) => ({ message: null, pending: p })),
    ];

    const out: LogItem[] = [];
    let lastDay = '';
    let prev: Extract<LogItem, { kind: 'msg' }> | null = null;
    let prevTime = 0;
    const seen = new Set<string>();

    for (const entry of entries) {
      const m = entry.message;
      const p = entry.pending;
      const id = m?.id ?? p!.localId;
      if (seen.has(id)) continue;
      seen.add(id);
      const time = m?.createdDateTime ?? p!.createdDateTime;
      const date = new Date(time);
      const key = dayKey(date);
      // System events say what happened ("Alice added Bob"); those with nothing to say are left out, along with their day label.
      let systemText: string | null = null;
      if (m && m.messageType && m.messageType !== 'message') {
        systemText = describeEvent(m.eventDetail, (uid) => people.get(uid) ?? null, mine) ?? (bodyText(m.body) || null);
        if (!systemText) continue;
      }
      if (key !== lastDay) {
        lastDay = key;
        prev = null;
        out.push({ kind: 'day', key: `day-${key}`, label: relativeDayLabel(time), date: time, showYear: date.getFullYear() !== currentYear });
      }

      if (systemText) {
        prev = null;
        out.push({ kind: 'system', key: id, text: systemText });
        continue;
      }

      const senderId = m ? (m.from?.user?.id ?? null) : mine;
      const isMine = m ? !!mine && senderId === mine : true;
      const out2 = p?.outgoing;
      const gifUrls = (m?.media ?? []).filter((x) => x.kind === 'gif' && x.url).map((x) => x.url as string);
      const rendered = m && !m.deletedDateTime ? renderBody(m.body?.content, m.body?.contentType, { gifUrls }) : out2 ? renderBody(out2.content, out2.contentType) : null;
      const hosted = (m?.media ?? []).filter((x) => x.kind === 'hosted' && x.hostedContentId);
      const media: BubbleMedia[] = [];
      (m?.media ?? []).forEach((x, i) => {
        const key = `${id}-m${i}`;
        const alt = x.alt ?? '';
        if (x.kind === 'hosted' && x.hostedContentId && m) {
          media.push({ key, kind: 'hosted', src: null, path: this.api.mediaPath(chatId ?? '', m.id, x.hostedContentId), alt, width: x.width ?? null, height: x.height ?? null });
        } else if (x.kind === 'gif' && allowedMediaUrl(x.url)) {
          media.push({ key, kind: 'gif', src: allowedMediaUrl(x.url), path: null, alt, width: x.width ?? null, height: x.height ?? null });
        }
      });
      for (const [i, file] of (out2?.images ?? []).entries()) {
        media.push({ key: `${id}-l${i}`, kind: 'local', src: this.localUrl(file), path: null, alt: file.name, width: null, height: null });
      }
      if (out2?.gif) media.push({ key: `${id}-g`, kind: 'gif', src: out2.gif.url, path: null, alt: out2.gif.alt, width: out2.gif.width, height: out2.gif.height });
      const files: BubbleFile[] = [
        ...(m?.files ?? []).map((f) => {
          const path = m ? this.api.filePath(chatId ?? '', m.id, f.id) : null;
          const name = f.name || 'File';
          return {
            key: `${id}-f${f.id}`,
            name,
            size: f.size ?? null,
            type: f.contentType ?? '',
            path,
            kind: fileKindOf(name, f.contentType, f.kind),
            thumbnailPath: path && f.hasThumbnail ? `${path}/thumbnail?size=medium` : null,
            webUrl: isHttps(f.webUrl) ? f.webUrl : null,
          };
        }),
        ...(out2?.files ?? []).map((f, i) => ({ key: `${id}-lf${i}`, name: f.name, size: f.size, type: f.type, path: null, kind: fileKindOf(f.name, f.type), thumbnailPath: null, webUrl: null })),
      ];
      const fileIds = new Set((m?.files ?? []).map((f) => f.id));
      const stickers: BubbleSticker[] = [];
      const cards: CardView[] = [];
      (m?.cards ?? []).forEach((c, i) => {
        const url = c.sticker?.url;
        if (url) {
          // Only allow-listed public hosts: a sticker URL from the server never reaches the authenticated fetch.
          const src = allowedMediaUrl(url);
          if (src) stickers.push({ key: `${id}-s${i}`, src, path: null, alt: c.sticker?.alt ?? c.name ?? 'Sticker' });
          return;
        }
        const view = cardView(c, i);
        if (view) cards.push({ ...view, key: `${id}-${view.key}` });
      });
      const emojiMap: Record<string, ChatEmoji> = {};
      for (const e of m?.emojis ?? []) if (e.key) emojiMap[e.key] = fromMessageEmoji(e);
      // Hosted images are shown from `media`; only images the server did not list still fall back to a placeholder.
      const uncovered = Math.max(0, (rendered?.removedImages ?? 0) - hosted.length);
      const attachments: Attachment[] = [
        ...(m?.attachments ?? [])
          .filter((a) => a.contentType !== 'messageReference' && a.contentType !== 'forwardedMessageReference' && !a.contentType?.startsWith('application/vnd.microsoft.card') && !(a.id && fileIds.has(a.id)))
          .map((a) => ({ name: a.name || 'Attachment' })),
        ...Array.from({ length: m?.media ? 0 : uncovered }, () => ({ name: 'Image' })),
      ];
      const counts = new Map<string, number>();
      for (const r of m?.reactions ?? []) {
        const label = r.reactionType || 'reaction';
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const senderName = m?.from?.user?.displayName || (isMine ? 'You' : 'Unknown');
      const head = !prev || prev.mine !== isMine || prev.senderId !== senderId || date.getTime() - prevTime > GROUP_WINDOW_MS;
      const item: Extract<LogItem, { kind: 'msg' }> = {
        kind: 'msg',
        key: id,
        localId: p?.localId ?? null,
        mine: isMine,
        senderId,
        senderName,
        head,
        time,
        deleted: !!m?.deletedDateTime,
        html: rendered?.html ?? '',
        text: m ? (rendered && m.body?.contentType === 'html' ? (rendered.html ? '' : rendered.text) : (m.body?.content ?? '')) : out2 && out2.contentType === 'html' ? (rendered?.html ? '' : (rendered?.text ?? '')) : p!.text,
        attachments,
        quotes: (m?.deletedDateTime ? [] : (m?.quotes ?? [])).map(quoteView),
        importance: m?.importance ?? out2?.importance ?? 'normal',
        media,
        files,
        stickers,
        cards,
        emojiKeys: rendered?.emojiKeys ?? [],
        emojiMap,
        emojiSize: rendered?.emojiOnly ? 48 : 24,
        reactions: [...counts].map(([label, count]) => ({ label, count })),
        status: p ? p.status : 'sent',
      };
      out.push(item);
      prev = item;
      prevTime = date.getTime();
    }
    return out;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.localUrls.forEach((url) => URL.revokeObjectURL(url)));
    effect(() => {
      this.oneOnOneId();
      untracked(() => {
        this.availability.set(null);
        this.loadPresence();
      });
    });
    inject(DestroyRef).onDestroy(keepFresh(() => this.loadPresence(), PRESENCE_POLL_MS));
    // A different chat starts empty and jumps to its newest message once loaded.
    effect(() => {
      this.store.openId();
      untracked(() => {
        this.viewing.set(null);
        this.forceScroll = true;
        this.atBottom = true;
        this.lastKey = null;
        this.anchor = null;
        this.newBelow.set(false);
      });
    });

    effect(() => {
      const items = this.items();
      untracked(() => {
        // Older messages arriving at the top are not news at the bottom; the anchor restore handles the scroll.
        if (this.anchor || !items.length) return;
        const last = items[items.length - 1];
        const changed = last.key !== this.lastKey;
        this.lastKey = last.key;
        const ownLast = last.kind === 'msg' && last.mine;
        if (this.forceScroll || this.atBottom || (changed && ownLast)) {
          this.forceScroll = false;
          afterNextRender(() => this.scrollToEnd(), { injector: this.injector });
        } else if (changed) {
          this.newBelow.set(true);
        }
      });
    });

    effect(() => {
      const loading = this.store.messagesLoadingMore();
      untracked(() => {
        if (loading || !this.anchor) return;
        const anchor = this.anchor;
        afterNextRender(
          () => {
            const el = this.log()?.nativeElement;
            if (el && this.anchor === anchor) el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
            if (this.anchor === anchor) this.anchor = null;
          },
          { injector: this.injector },
        );
      });
    });
  }

  protected loadOlder(): void {
    const el = this.log()?.nativeElement;
    if (!el || !this.store.messagesMore() || this.store.messagesLoadingMore()) return;
    this.anchor = { height: el.scrollHeight, top: el.scrollTop };
    this.store.loadOlderMessages();
  }

  private scrollToEnd(): void {
    const el = this.log()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
    this.atBottom = true;
    this.newBelow.set(false);
  }

  protected jumpToLatest(): void {
    this.scrollToEnd();
    this.composer()?.focus();
  }

  protected onScroll(): void {
    const el = this.log()?.nativeElement;
    if (!el) return;
    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (this.atBottom) this.newBelow.set(false);
  }

  protected onSent(): void {
    this.atBottom = true;
  }

  private localUrl(file: File): string {
    let url = this.localUrls.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      this.localUrls.set(file, url);
    }
    return url;
  }

  /** Message links open in a new tab even if the sanitizer dropped the target attribute. */
  protected onBodyClick(event: Event): void {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href) return;
    event.preventDefault();
    if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  }
}
