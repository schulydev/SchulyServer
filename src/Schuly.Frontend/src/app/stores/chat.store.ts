import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, untracked } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom, lastValueFrom, tap } from 'rxjs';
import { ResponseCache } from '../core/response-cache';
import { Importance, MessageCard, MessageFile, MessageMedia } from '../core/chat-media';
import { MessageEmoji } from '../core/chat-emoji';
import { NOTES_TITLE, chatPeople } from '../core/chat-people';
import { cleanPreview } from '../core/preview-text';
import { swrCache } from '../core/swr-cache';
import { AccountProblem } from './account-resource';
import { LinkedAccountsStore } from './linked-accounts.store';

export interface ChatMember {
  displayName?: string | null;
  userId?: string | null;
  email?: string | null;
}

export interface ChatBody {
  content?: string | null;
  contentType?: string | null;
}

export interface ChatSummary {
  id: string;
  topic?: string | null;
  chatType?: string | null;
  /** True for the Notes (you) self chat; set by the server, never derived from the id. */
  isSelfChat?: boolean | null;
  webUrl?: string | null;
  /** The chat's own picture, when the data carries one. */
  imageUrl?: string | null;
  /** True when the server has a picture for the chat at `chats/{chatId}/photo`. */
  hasImage?: boolean | null;
  lastUpdatedDateTime?: string | null;
  members?: ChatMember[] | null;
  viewpoint?: { lastMessageReadDateTime?: string | null } | null;
  lastMessagePreview?: {
    createdDateTime?: string | null;
    isDeleted?: boolean | null;
    body?: ChatBody | null;
    from?: { user?: { id?: string | null; displayName?: string | null } | null } | null;
  } | null;
}

export interface ChatMessage {
  id: string;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  deletedDateTime?: string | null;
  messageType?: string | null;
  from?: { user?: { id?: string | null; displayName?: string | null } | null } | null;
  body?: ChatBody | null;
  attachments?: { id?: string | null; name?: string | null; contentType?: string | null; contentUrl?: string | null }[] | null;
  mentions?: unknown[] | null;
  reactions?: { reactionType?: string | null }[] | null;
  importance?: Importance | null;
  /** What happened, for system messages (Graph's eventMessageDetail). */
  eventDetail?: Record<string, unknown> | null;
  media?: MessageMedia[] | null;
  files?: MessageFile[] | null;
  cards?: MessageCard[] | null;
  /** Teams emojis of the message, matching the `<emoji key>` placeholders in the body. */
  emojis?: MessageEmoji[] | null;
}

export interface OutgoingMention {
  id: number;
  mentionText: string;
  mentioned: { user: { id: string; displayName: string } };
}

export interface OutgoingGif {
  url: string;
  alt: string;
  width: number;
  height: number;
}

/** What the composer hands over to send. */
export interface Outgoing {
  content: string;
  contentType: 'text' | 'html';
  importance: Importance;
  mentions: OutgoingMention[];
  gif: OutgoingGif | null;
  /** Inline images, in the order of `hostedContents/N`. */
  images: File[];
  files: File[];
  /** Plain text for the bubble while it is sending. */
  preview: string;
}

/** A message of mine that the server has not confirmed yet. */
export interface PendingMessage {
  localId: string;
  chatId: string;
  text: string;
  outgoing: Outgoing;
  createdDateTime: string;
  status: 'sending' | 'failed';
}

export interface Me {
  id: string;
  displayName?: string | null;
  mail?: string | null;
}

interface ChatState {
  chats: ChatSummary[];
  chatsLoading: boolean;
  problem: AccountProblem | null;
  me: Me | null;
  openId: string | null;
  /** Oldest first. */
  messages: ChatMessage[];
  messagesLoading: boolean;
  messagesProblem: AccountProblem | null;
  pending: PendingMessage[];
  /** Requested page sizes; they grow with "load more" and the background refreshes keep them. */
  chatsTop: number;
  chatsMore: boolean;
  chatsLoadingMore: boolean;
  chatsMoreFailed: boolean;
  chatsLoadedMore: { count: number } | null;
  messagesTop: number;
  messagesMore: boolean;
  messagesLoadingMore: boolean;
  messagesMoreFailed: boolean;
  messagesLoadedMore: { count: number } | null;
  /** Object URL per `${accountId}:${userId}`; null means the user has no photo. */
  photos: Record<string, string | null>;
}

// The plugin answers an expired sign-in with 409; a 401 is the Schuly session and the auth interceptor handles it.
const problemOf = (error: unknown): AccountProblem =>
  error instanceof HttpErrorResponse && error.status === 409
    ? 'expired'
    : error instanceof HttpErrorResponse && error.status === 404
      ? 'missing'
      : 'failed';

/** Visible text of a message body; script and style contents are not text a reader sees. */
export function bodyText(body?: ChatBody | null): string {
  const content = body?.content ?? '';
  if (!content) return '';
  let text = content;
  if (body?.contentType === 'html') {
    const root = new DOMParser().parseFromString(content, 'text/html').body;
    root.querySelectorAll('script, style').forEach((element) => element.remove());
    root.querySelectorAll('emoji').forEach((e) => e.replaceWith(e.getAttribute('alt') || e.textContent || ''));
    text = root.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

const chatKinds: Record<string, string> = { oneOnOne: 'Chat', group: 'Group', meeting: 'Meeting' };
const MAX_PHOTO_REQUESTS = 4;
const CHATS_PAGE = 25;
const CHATS_MAX = 200;
const MESSAGES_PAGE = 30;
const MESSAGES_MAX = 300;

const firstPages = {
  chatsTop: CHATS_PAGE,
  chatsMore: false,
  chatsLoadingMore: false,
  chatsMoreFailed: false,
  chatsLoadedMore: null,
};
const firstMessagePages = {
  messagesTop: MESSAGES_PAGE,
  messagesMore: false,
  messagesLoadingMore: false,
  messagesMoreFailed: false,
  messagesLoadedMore: null,
};

type LoadMode = 'initial' | 'silent' | 'more';

export const ChatStore = signalStore(
  withState<ChatState>({
    chats: [],
    chatsLoading: false,
    problem: null,
    me: null,
    openId: null,
    messages: [],
    messagesLoading: false,
    messagesProblem: null,
    pending: [],
    ...firstPages,
    ...firstMessagePages,
    photos: {},
  }),
  withComputed((store, accounts = inject(LinkedAccountsStore)) => {
    const meId = computed(() => {
      const me = store.me();
      if (me?.id) return me.id;
      const own = accounts.selected('chat')?.detail?.toLowerCase();
      if (!own) return null;
      for (const chat of store.chats()) {
        const found = chat.members?.find((m) => m.email?.toLowerCase() === own && m.userId);
        if (found) return found.userId ?? null;
      }
      return null;
    });

    const chatItems = computed(() => {
      const mine = meId();
      const ownEmail = accounts.selected('chat')?.detail ?? null;
      return store.chats().map((c) => {
        const last = c.lastMessagePreview;
        const { people, memberCount, notes } = chatPeople(c, mine, ownEmail, last?.from?.user);
        const sender = last?.from?.user;
        const text = last?.isDeleted ? 'This message has been deleted' : bodyText(last?.body);
        const fromMe = !!mine && !!sender?.id && sender.id === mine;
        const read = c.viewpoint?.lastMessageReadDateTime;
        const lastAt = last?.createdDateTime ?? null;
        const unread =
          !!lastAt && !!sender?.id && sender.id !== mine && (!read || new Date(lastAt).getTime() > new Date(read).getTime());
        return {
          id: c.id,
          title: notes ? NOTES_TITLE : c.topic || people.map((m) => m.name).join(', ') || 'Chat',
          image: c.imageUrl || null,
          hasImage: !!c.hasImage,
          kind: (c.chatType && chatKinds[c.chatType]) || null,
          oneOnOne: c.chatType === 'oneOnOne',
          people,
          memberCount,
          mentionable: notes ? [] : people.filter((m) => !!m.id).map((m) => ({ id: m.id as string, name: m.name })),
          preview: cleanPreview(!text ? '' : fromMe ? `You: ${text}` : sender?.displayName && c.chatType !== 'oneOnOne' ? `${sender.displayName}: ${text}` : text),
          updated: lastAt ?? c.lastUpdatedDateTime ?? null,
          unread,
          link: c.webUrl ?? null,
        };
      });
    });

    return {
      meId,
      waiting: computed(() => !accounts.loaded()),
      chatItems,
      openChat: computed(() => chatItems().find((c) => c.id === store.openId()) ?? null),
    };
  }),
  withMethods((store, http = inject(HttpClient), accounts = inject(LinkedAccountsStore), responses = inject(ResponseCache)) => {
    const base = (_id: string) => accounts.endpoint('chat') ?? '';
    const chatUrl = (id: string, chatId: string) => `${base(id)}/chats/${encodeURIComponent(chatId)}`;
    const cachedChatUrl = (id: string, chatId: string) => `${base(id)}/cached/chats/${encodeURIComponent(chatId)}`;

    const photoQueue: (() => void)[] = [];
    let photoActive = 0;
    const photoRequested = new Set<string>();
    const pumpPhotos = () => {
      while (photoActive < MAX_PHOTO_REQUESTS && photoQueue.length) {
        photoActive++;
        photoQueue.shift()!();
      }
    };
    const queuePhoto = (key: string, url: string) => {
      if (photoRequested.has(key)) return;
      photoRequested.add(key);
      photoQueue.push(() => {
        firstValueFrom(http.get(url, { params: { size: 64 }, responseType: 'blob' }))
          .then((blob) => {
            const objectUrl = blob.size > 0 ? URL.createObjectURL(blob) : null;
            patchState(store, { photos: { ...store.photos(), [key]: objectUrl } });
          })
          .catch(() => patchState(store, { photos: { ...store.photos(), [key]: null } }))
          .finally(() => {
            photoActive--;
            pumpPhotos();
          });
      });
      pumpPhotos();
    };

    /** JSON when there is nothing to upload, multipart (mentions and gif as JSON strings) when there are images or files. */
    const bodyOf = (out: Outgoing): FormData | Record<string, unknown> => {
      const fields: Record<string, unknown> = { content: out.content, contentType: out.contentType };
      if (out.importance !== 'normal') fields['importance'] = out.importance;
      if (out.mentions.length) fields['mentions'] = out.mentions;
      if (out.gif) fields['gif'] = out.gif;
      if (!out.images.length && !out.files.length) return fields;
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.append(name, typeof value === 'string' ? value : JSON.stringify(value));
      for (const image of out.images) form.append('images', image, image.name);
      for (const file of out.files) form.append('files', file, file.name);
      return form;
    };

    let nextLocal = 0;
    // A response is dropped when a newer request for the same list started after it.
    let chatsSeq = 0;
    let messagesSeq = 0;

    async function fetchChats(mode: LoadMode): Promise<void> {
      const accountId = accounts.selectedId('chat');
      if (!accountId) return;
      const seq = ++chatsSeq;
      const top = store.chatsTop();
      const key = `${accountId}|chats`;
      if (mode === 'initial') {
        // Stale-while-revalidate: cached chats show at once, the request below refreshes them.
        const hit = swrCache.get<ChatSummary[]>(key);
        if (hit && !store.chats().length) patchState(store, { chats: hit.data, chatsLoading: false, problem: null });
        else patchState(store, { chatsLoading: !store.chats().length, problem: null });
      }
      try {
        await lastValueFrom(
          responses.swr<ChatSummary[]>(`${base(accountId)}/cached/chats`, { top }, `${base(accountId)}/chats`).pipe(
            tap((items) => {
              if (accounts.selectedId('chat') !== accountId || seq !== chatsSeq) return;
              const chats = Array.isArray(items) ? items : [];
              if (top === CHATS_PAGE) swrCache.set(key, chats);
              patchState(store, {
                chats,
                chatsLoading: false,
                problem: null,
                chatsMore: chats.length >= top && top < CHATS_MAX,
                chatsLoadingMore: false,
                chatsMoreFailed: false,
                chatsLoadedMore: mode === 'more' ? { count: Math.max(0, chats.length - store.chats().length) } : store.chatsLoadedMore(),
              });
            }),
          ),
          { defaultValue: null },
        );
        if (accounts.selectedId('chat') === accountId && seq === chatsSeq) patchState(store, { chatsLoading: false, chatsLoadingMore: false });
      } catch (error) {
        if (accounts.selectedId('chat') !== accountId || seq !== chatsSeq) return;
        if (mode === 'more' || store.chatsLoadingMore()) {
          // Keep the list and let the user retry; the page size goes back to what is shown.
          patchState(store, {
            chatsLoadingMore: false,
            chatsMoreFailed: true,
            chatsTop: Math.max(CHATS_PAGE, store.chats().length),
          });
        } else if (!store.chats().length) {
          // A failed background refresh keeps what is on screen.
          patchState(store, { chatsLoading: false, problem: problemOf(error) });
        }
      }
    }

    const loadChats = (silent = false) => fetchChats(silent ? 'silent' : 'initial');

    async function fetchMessages(mode: LoadMode): Promise<void> {
      const accountId = accounts.selectedId('chat');
      const chatId = store.openId();
      if (!accountId || !chatId) return;
      const seq = ++messagesSeq;
      const top = store.messagesTop();
      const key = `${accountId}|chat|${chatId}`;
      if (mode === 'initial') {
        const hit = swrCache.get<ChatMessage[]>(key);
        if (hit && !store.messages().length) patchState(store, { messages: hit.data, messagesLoading: false, messagesProblem: null });
        else patchState(store, { messagesLoading: !store.messages().length, messagesProblem: null });
      }
      try {
        await lastValueFrom(
          responses.swr<ChatMessage[]>(`${cachedChatUrl(accountId, chatId)}/messages`, { top }, `${chatUrl(accountId, chatId)}/messages`).pipe(
            tap((items) => {
              if (accounts.selectedId('chat') !== accountId || store.openId() !== chatId || seq !== messagesSeq) return;
              const messages = (Array.isArray(items) ? items : []).slice().reverse();
              if (top === MESSAGES_PAGE) swrCache.set(key, messages);
              patchState(store, {
                messages,
                messagesLoading: false,
                messagesProblem: null,
                messagesMore: messages.length >= top && top < MESSAGES_MAX,
                messagesLoadingMore: false,
                messagesMoreFailed: false,
                messagesLoadedMore:
                  mode === 'more' ? { count: Math.max(0, messages.length - store.messages().length) } : store.messagesLoadedMore(),
              });
            }),
          ),
          { defaultValue: null },
        );
        if (accounts.selectedId('chat') === accountId && store.openId() === chatId && seq === messagesSeq) patchState(store, { messagesLoading: false, messagesLoadingMore: false });
      } catch (error) {
        if (accounts.selectedId('chat') !== accountId || store.openId() !== chatId || seq !== messagesSeq) return;
        if (mode === 'more' || store.messagesLoadingMore()) {
          patchState(store, {
            messagesLoadingMore: false,
            messagesMoreFailed: true,
            messagesTop: Math.max(MESSAGES_PAGE, store.messages().length),
          });
        } else if (!store.messages().length) {
          patchState(store, { messagesLoading: false, messagesProblem: problemOf(error) });
        }
      }
    }

    const loadMessages = (silent: boolean) => fetchMessages(silent ? 'silent' : 'initial');

    async function markRead(): Promise<void> {
      const accountId = accounts.selectedId('chat');
      const chatId = store.openId();
      if (!accountId || !chatId) return;
      const now = new Date().toISOString();
      const read = (chats: ChatSummary[]) => chats.map((c) => (c.id === chatId ? { ...c, viewpoint: { ...c.viewpoint, lastMessageReadDateTime: now } } : c));
      const before = store.chats();
      patchState(store, { chats: read(before) });
      const undo = await responses.patch<ChatSummary[]>(`${base(accountId)}/cached/chats`, { top: store.chatsTop() }, read);
      try {
        await firstValueFrom(http.post(`${chatUrl(accountId, chatId)}/read`, {}));
      } catch {
        // Marking as read is best effort: the chat simply shows as unread again.
        patchState(store, { chats: before });
        await undo();
      }
    }

    async function post(pending: PendingMessage): Promise<void> {
      const accountId = accounts.selectedId('chat');
      if (!accountId) return;
      patchState(store, {
        pending: store.pending().map((p) => (p.localId === pending.localId ? { ...p, status: 'sending' as const } : p)),
      });
      try {
        const created = await firstValueFrom(http.post<ChatMessage>(`${chatUrl(accountId, pending.chatId)}/messages`, bodyOf(pending.outgoing)));
        const stillOpen = store.openId() === pending.chatId;
        const known = store.messages().some((m) => m.id === created?.id);
        patchState(store, {
          pending: store.pending().filter((p) => p.localId !== pending.localId),
          messages: stillOpen && created?.id && !known ? [...store.messages(), created] : store.messages(),
        });
        void loadChats(true);
      } catch {
        patchState(store, {
          pending: store.pending().map((p) => (p.localId === pending.localId ? { ...p, status: 'failed' as const } : p)),
        });
      }
    }

    return {
      loadChats,
      refreshMessages: () => loadMessages(true),
      /** Warms the cache for a chat the user is about to open (hover or focus). */
      prefetchChat(chatId: string): void {
        const accountId = accounts.selectedId('chat');
        if (!accountId || chatId === store.openId()) return;
        const key = `${accountId}|chat|${chatId}`;
        const hit = swrCache.get(key);
        if (hit && hit.age < 30_000) return;
        lastValueFrom(responses.swr<ChatMessage[]>(`${cachedChatUrl(accountId, chatId)}/messages`, { top: MESSAGES_PAGE }, `${chatUrl(accountId, chatId)}/messages`), { defaultValue: null })
          .then((items) => Array.isArray(items) && swrCache.set(key, items.slice().reverse()))
          .catch(() => undefined);
      },
      /** Asks for one more page of chats; the list on screen stays until the longer one arrives. */
      loadMoreChats(): void {
        if (!store.chatsMore() || store.chatsLoadingMore() || store.chatsLoading()) return;
        patchState(store, {
          chatsTop: Math.min(store.chatsTop() + CHATS_PAGE, CHATS_MAX),
          chatsLoadingMore: true,
          chatsMoreFailed: false,
        });
        void fetchChats('more');
      },
      /** Asks for older messages of the open chat. */
      loadOlderMessages(): void {
        if (!store.messagesMore() || store.messagesLoadingMore() || store.messagesLoading()) return;
        patchState(store, {
          messagesTop: Math.min(store.messagesTop() + MESSAGES_PAGE, MESSAGES_MAX),
          messagesLoadingMore: true,
          messagesMoreFailed: false,
        });
        void fetchMessages('more');
      },
      async open(chatId: string): Promise<void> {
        messagesSeq++;
        patchState(store, { openId: chatId, messages: [], messagesProblem: null, ...firstMessagePages });
        await loadMessages(false);
        if (store.openId() === chatId && !store.messagesProblem()) await markRead();
      },
      close: () => {
        messagesSeq++;
        patchState(store, { openId: null, messages: [], messagesProblem: null, messagesLoading: false, ...firstMessagePages });
      },
      markRead,
      send(outgoing: Outgoing): void {
        const chatId = store.openId();
        if (!chatId) return;
        const pending: PendingMessage = {
          localId: `local-${Date.now()}-${nextLocal++}`,
          chatId,
          text: outgoing.preview,
          outgoing,
          createdDateTime: new Date().toISOString(),
          status: 'sending',
        };
        patchState(store, { pending: [...store.pending(), pending] });
        void post(pending);
      },
      retry(localId: string): void {
        const pending = store.pending().find((p) => p.localId === localId);
        if (pending && pending.status === 'failed') void post(pending);
      },
      discard: (localId: string) => patchState(store, { pending: store.pending().filter((p) => p.localId !== localId) }),

      /** Asks for a profile photo once per (account, user); the result lands in `photos`. */
      requestPhoto(userId: string): void {
        const accountId = accounts.selectedId('chat');
        if (!accountId || !userId) return;
        queuePhoto(`${accountId}:${userId}`, `${base(accountId)}/photos/${encodeURIComponent(userId)}`);
      },
      /** A chat's own picture, loaded and cached exactly like member photos (same queue, same auth, same blob URLs). */
      requestChatImage(chatId: string): void {
        const accountId = accounts.selectedId('chat');
        if (!accountId || !chatId) return;
        queuePhoto(`${accountId}:chat:${chatId}`, `${base(accountId)}/chats/${encodeURIComponent(chatId)}/photo`);
      },
      chatImageFor: (chatId: string | null | undefined): string | null => {
        const accountId = accounts.selectedId('chat');
        return accountId && chatId ? (store.photos()[`${accountId}:chat:${chatId}`] ?? null) : null;
      },
      photoFor: (userId: string | null | undefined): string | null => {
        const accountId = accounts.selectedId('chat');
        return accountId && userId ? (store.photos()[`${accountId}:${userId}`] ?? null) : null;
      },
      revokePhotos(): void {
        for (const url of Object.values(store.photos())) if (url) URL.revokeObjectURL(url);
        patchState(store, { photos: {} });
      },
      async loadMe(): Promise<void> {
        const accountId = accounts.selectedId('chat');
        if (!accountId) return;
        try {
          const me = await firstValueFrom(http.get<Me>(`${base(accountId)}/me`));
          if (accounts.selectedId('chat') === accountId) patchState(store, { me: me?.id ? me : null });
        } catch {
          // Without /me, own messages are recognised through the account email.
        }
      },
      reset: () =>
        patchState(store, {
          chats: [],
          problem: null,
          me: null,
          openId: null,
          messages: [],
          messagesProblem: null,
          pending: [],
          ...firstPages,
          ...firstMessagePages,
        }),
    };
  }),
  withHooks({
    onInit: (store) => {
      const accounts = inject(LinkedAccountsStore);
      effect(() => {
        const id = accounts.selectedId('chat');
        untracked(() => {
          store.reset();
          if (id) {
            void store.loadChats();
            void store.loadMe();
          }
        });
      });
    },
    onDestroy: (store) => store.revokePhotos(),
  }),
);
