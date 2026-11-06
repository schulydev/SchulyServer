import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChildren, DestroyRef } from '@angular/core';
import { keepFresh } from '../core/response-cache';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArchive,
  lucideChevronDown,
  lucideChevronRight,
  lucideFileText,
  lucideFlag,
  lucideFolder,
  lucideInbox,
  lucideMail,
  lucideMailX,
  lucideMessagesSquare,
  lucidePaperclip,
  lucidePenSquare,
  lucideRefreshCw,
  lucideRss,
  lucideSend,
  lucideTrash2,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { persistedNumber } from '../core/persisted';
import { EmptyState } from '../shared/empty-state';
import { ListTime } from '../shared/list-time';
import { LoadMore } from '../shared/load-more';
import { AccountPicker } from '../shared/account-picker';
import { AccountProblem } from '../shared/account-problem';
import { SenderPhotos } from '../core/sender-photos';
import { SearchField } from '../shared/search-field';
import { SenderAvatar } from '../shared/sender-avatar';
import { SplitHandle } from '../shared/split-handle';
import { FolderKind, MailClient } from '../stores/mail-client';
import { MailStore } from '../stores/capability-data.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { ComposeMode, MailCompose } from './mail-compose';
import { MailReader, MailSummary } from './mail-reader';

const FOLDER_ICONS: Record<FolderKind, string> = {
  inbox: 'lucideInbox',
  sent: 'lucideSend',
  drafts: 'lucideFileText',
  archive: 'lucideArchive',
  deleted: 'lucideTrash2',
  junk: 'lucideMailX',
  outbox: 'lucideSend',
  history: 'lucideMessagesSquare',
  rss: 'lucideRss',
  sync: 'lucideRefreshCw',
  system: 'lucideFolder',
  other: 'lucideFolder',
};

interface Composing {
  mode: ComposeMode;
}

@Component({
  selector: 'app-mail',
  imports: [
    TranslatePipe,
    SenderAvatar,
    HlmButton,
    HlmSkeletonImports,
    NgIcon,
    NgTemplateOutlet,
    EmptyState,
    ListTime,
    LoadMore,
    MailCompose,
    MailReader,
    AccountPicker,
    AccountProblem,
    SearchField,
    SplitHandle,
  ],
  providers: [
    provideIcons({
      lucideArchive,
      lucideChevronDown,
      lucideChevronRight,
      lucideFileText,
      lucideFlag,
      lucideFolder,
      lucideInbox,
      lucideMail,
      lucideMailX,
      lucideMessagesSquare,
      lucidePaperclip,
      lucidePenSquare,
      lucideRefreshCw,
      lucideRss,
      lucideSend,
      lucideTrash2,
    }),
    MailStore,
    MailClient,
    SenderPhotos,
  ],
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', '(keydown.escape)': 'onEscape($event)' },
  template: `
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div class="px-4 has-[label]:pt-4 lg:px-6"><app-account-picker kind="mail" /></div>
      <p class="bg-muted mx-4 mt-2 truncate rounded-md px-3 py-1.5 text-sm empty:hidden lg:mx-6" role="status" aria-live="polite">{{ sent() }}</p>

      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row"
        [style.--folders-w.px]="foldersWidth.value()"
        [style.--list-w.px]="listWidth.value()"
      >
        <nav
          class="flex shrink-0 items-center gap-1 overflow-x-auto border-b p-2 lg:w-(--folders-w) lg:flex-col lg:items-stretch lg:overflow-x-hidden lg:overflow-y-auto lg:border-b-0 lg:p-3"
          [class.max-lg:hidden]="selected() || composing()"
          [attr.aria-label]="'mail.folders' | translate"
        >
          <button hlmBtn type="button" class="shrink-0 lg:mb-2 lg:w-full" (click)="startCompose('new')">
            <ng-icon name="lucidePenSquare" aria-hidden="true" />
            {{ 'mail.newMessage' | translate }}
          </button>
          @for (f of client.mainFolders(); track f.key) {
            <ng-container *ngTemplateOutlet="folderButton; context: { $implicit: f }" />
          }
          @if (client.moreFolders().length) {
            <button
              type="button"
              class="hover:bg-muted/60 focus-visible:outline-ring text-muted-foreground flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2"
              aria-controls="mail-more-folders"
              [attr.aria-expanded]="moreOpen()"
              (click)="moreOpen.set(!moreOpen())"
            >
              <ng-icon [name]="moreOpen() ? 'lucideChevronDown' : 'lucideChevronRight'" class="shrink-0 text-base" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-left">{{ 'common.more' | translate }}</span>
            </button>
            <div id="mail-more-folders" class="contents" [hidden]="!moreOpen()">
              @if (moreOpen()) {
                @for (f of client.moreFolders(); track f.key) {
                  <ng-container *ngTemplateOutlet="folderButton; context: { $implicit: f }" />
                }
              }
            </div>
          }
          <ng-template #folderButton let-f>
            <button
              type="button"
              class="hover:bg-muted/60 aria-[current=true]:bg-muted aria-[current=true]:font-semibold focus-visible:outline-ring relative flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2"
              [style.margin-inline-start.rem]="f.depth * 1.25"
              [attr.aria-current]="f.key === mail.folder() ? 'true' : null"
              (click)="chooseFolder(f.key)"
              (pointerenter)="mail.prefetch({ folder: f.key })"
              (focus)="mail.prefetch({ folder: f.key })"
            >
              @if (f.key === mail.folder()) {
                <span class="bg-primary absolute inset-y-1.5 start-0 w-0.75 rounded-e-full max-lg:hidden" aria-hidden="true"></span>
              }
              <ng-icon [name]="iconOf(f.kind)" class="shrink-0 text-base" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-left">{{ f.name }}</span>
              @if (f.unread) {
                <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {{ f.unread }}<span class="sr-only"> {{ 'mail.unreadCount' | translate }}</span>
                </span>
              }
            </button>
          </ng-template>
        </nav>
        <app-split-handle
          [label]="'mail.resizeFolders' | translate"
          [width]="foldersWidth.value()"
          [min]="160"
          [max]="360"
          [initial]="224"
          (widthChange)="foldersWidth.set($event)"
        />

        <section
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:w-(--list-w) lg:flex-none lg:shrink-0"
          [class.max-lg:hidden]="selected() || composing()"
          [attr.aria-label]="folderLabel()"
        >
          @if (!mail.problem()) {
            <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-4">
              <h2 class="min-w-0 truncate text-base font-semibold">{{ folderLabel() }}</h2>
                <button
                  hlmBtn
                  type="button"
                  size="sm"
                  [variant]="mail.unreadOnly() ? 'secondary' : 'ghost'"
                  [attr.aria-pressed]="mail.unreadOnly()"
                  (click)="mail.setUnreadOnly(!mail.unreadOnly())"
                >
                  {{ 'chat.unread' | translate }}
                </button>
            </div>
            <div class="flex flex-col gap-2 px-4 py-2">
              <app-search-field class="[&_hlm-input-group]:w-full" [(value)]="query" [label]="'mail.search' | translate" [placeholder]="'mail.search' | translate" />
              @if (query().trim() && mail.hasMore()) {
                <p class="text-muted-foreground text-xs">{{ 'chat.searchLoaded' | translate }}</p>
              }
            </div>
          }

          <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            @if (mail.waiting() || mail.loading()) {
              <div class="flex flex-col gap-1 p-3" aria-busy="true">
                @for (i of [1, 2, 3, 4, 5]; track i) {
                  <div class="flex items-center gap-3 py-2">
                    <hlm-skeleton class="size-10 shrink-0 rounded-full" />
                    <div class="flex flex-1 flex-col gap-2">
                      <hlm-skeleton class="h-3.5 w-1/2" />
                      <hlm-skeleton class="h-3 w-4/5" />
                    </div>
                  </div>
                }
              </div>
            } @else if (mail.problem(); as problem) {
              <div class="p-3"><app-account-problem [problem]="problem" /></div>
            } @else if (filtered().length) {
              <ul [attr.aria-busy]="mail.loadingMore()">
                @for (message of filtered(); track message.id) {
                  <li class="min-w-0">
                    <button
                      #row
                      type="button"
                      class="hover:bg-muted/60 aria-[current=true]:bg-muted focus-visible:outline-ring relative flex w-full min-w-0 items-start gap-3 overflow-hidden border-b py-3 ps-4 pe-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
                      [attr.data-id]="message.id"
                      [attr.aria-current]="message.id === selectedId() ? 'true' : null"
                      (click)="open(message.id)"
                      (pointerenter)="client.prefetch(message.id)"
                      (focus)="client.prefetch(message.id)"
                    >
                      @if (message.unread) {
                        <span class="bg-primary absolute inset-y-0 start-0 w-1" aria-hidden="true"></span>
                      }
                      <app-sender-avatar [email]="message.avatarEmail" [name]="message.listName" />
                      <span class="block min-w-0 flex-1 overflow-hidden">
                        <span class="flex min-w-0 items-baseline gap-2">
                          <span class="min-w-0 flex-1 truncate text-sm" [class]="message.unread ? 'text-foreground font-bold' : 'font-medium'">
                            {{ message.listName }}
                          </span>
                          <span class="text-foreground/70 shrink-0 text-xs"><app-list-time [value]="message.received" [weekday]="true" /></span>
                        </span>
                        <span class="flex min-w-0 items-center gap-1.5">
                          <span class="min-w-0 flex-1 truncate text-sm" [class]="message.unread ? 'text-foreground font-semibold' : ''">
                            {{ message.subject }}
                            @if (message.unread) {
                              <span class="sr-only">{{ 'mail.unreadMarker' | translate }}</span>
                            }
                          </span>
                          @if (message.flagged) {
                            <ng-icon name="lucideFlag" class="text-destructive shrink-0 text-xs" aria-hidden="true" />
                            <span class="sr-only">{{ 'mail.flagged' | translate }}</span>
                          }
                          @if (message.hasAttachments) {
                            <ng-icon name="lucidePaperclip" class="text-muted-foreground shrink-0 text-xs" aria-hidden="true" />
                            <span class="sr-only">{{ 'mail.hasAttachments' | translate }}</span>
                          }
                        </span>
                        @if (message.preview) {
                          <span class="text-foreground/70 block min-w-0 truncate text-xs">{{ message.preview }}</span>
                        }
                      </span>
                    </button>
                  </li>
                }
              </ul>
            } @else if (mail.messages().length) {
              <app-empty-state icon="lucideMail" [title]="'mail.noMatch' | translate" [description]="'chat.tryDifferent' | translate" />
            } @else {
              <app-empty-state
                icon="lucideMail"
                [title]="mail.unreadOnly() ? ('mail.noUnread' | translate) : ('mail.noMessages' | translate)"
                [description]="mail.unreadOnly() ? ('mail.caughtUp' | translate) : ('mail.folderEmpty' | translate)"
              />
            }
            <app-load-more
              [label]="'mail.loadMore' | translate"
              [hasMore]="mail.hasMore()"
              [loading]="mail.loadingMore()"
              [failed]="mail.moreFailed()"
              [loaded]="mail.loadedMore()"
              (more)="mail.loadMore()"
            />
          </div>
        </section>
        <app-split-handle
          [label]="'mail.resizeMessages' | translate"
          [width]="listWidth.value()"
          [min]="280"
          [max]="720"
          [initial]="384"
          (widthChange)="listWidth.set($event)"
        />

        <section
          class="min-w-0 flex-1 flex-col overflow-hidden"
          [class]="selected() || composing() ? 'flex' : 'hidden lg:flex'"
          [attr.aria-label]="'mail.message' | translate"
        >
          @if (composing(); as c) {
            <app-mail-compose [mode]="c.mode" [source]="client.detail()" (cancel)="endCompose()" (done)="composed($event)" />
          } @else if (selected(); as message) {
            <app-mail-reader [summary]="message" (back)="close()" (compose)="startCompose($event)" (removed)="afterRemoved()" />
          } @else {
            <div class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
              <ng-icon name="lucideMail" class="text-2xl" aria-hidden="true" />
              {{ 'mail.select' | translate }}
            </div>
          }
        </section>
      </div>
    </div>
  `,
})
export class Mail {
  protected readonly mail = inject(MailStore);
  protected readonly client = inject(MailClient);
  private readonly accounts = inject(LinkedAccountsStore);
  private readonly injector = inject(Injector);

  protected readonly iconOf = (kind: FolderKind): string => FOLDER_ICONS[kind];
  protected readonly foldersWidth = persistedNumber('schuly.mail.folders', 224);
  protected readonly listWidth = persistedNumber('schuly.mail.list', 384);
  protected readonly moreOpen = signal(false);
  protected readonly query = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly composing = signal<Composing | null>(null);
  protected readonly sent = signal('');
  private sentTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly rows = viewChildren<ElementRef<HTMLElement>>('row');

  protected readonly folderLabel = computed(() => this.client.folders().find((f) => f.key === this.mail.folder())?.name ?? t('nav.mail'));

  /** Sent items and drafts list who the message went to, like Outlook; other folders list the sender. */
  protected readonly items = computed(() => {
    const outgoing = this.mail.folder() === 'sentitems' || this.mail.folder() === 'drafts';
    return this.mail.messages().map((m) => ({ ...m, listName: outgoing && m.to.length ? m.to.join(', ') : m.sender, avatarEmail: outgoing && m.to.length ? null : m.address }));
  });

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((m) => [m.sender, m.address, m.subject, m.preview, ...m.to].some((field) => field?.toLowerCase().includes(q)));
  });

  protected readonly selected = computed<MailSummary | null>(() => this.filtered().find((m) => m.id === this.selectedId()) ?? null);

  constructor() {
    // Folders per account: cached ones show at once and are refreshed in the background.
    effect(() => {
      this.accounts.selectedId('mail');
      untracked(() => void this.client.loadFolders());
    });
    // Inbox is the default; fall back to it when the remembered folder is not in this mailbox.
    effect(() => {
      const folders = this.client.folders();
      const current = this.mail.folder();
      if (this.client.foldersLive() && !folders.some((f) => f.key === current)) untracked(() => this.mail.setFolder('inbox'));
    });
    // Load the top of the list ahead, once a list is on screen.
    effect(() => {
      const ids = this.mail.items().map((m) => m.id);
      if (ids.length) untracked(() => this.client.prefetchTop(ids));
    });
    inject(DestroyRef).onDestroy(
      keepFresh(() => {
        this.mail.refresh();
        void this.client.loadFolders();
      }),
    );
  }

  protected chooseFolder(key: string): void {
    this.composing.set(null);
    if (key === this.mail.folder()) return;
    this.selectedId.set(null);
    this.client.close();
    this.mail.setFolder(key);
  }

  protected open(id: string): void {
    this.composing.set(null);
    this.selectedId.set(id);
  }

  protected close(): void {
    const id = this.selectedId();
    this.selectedId.set(null);
    this.client.close();
    this.focusRow(id);
  }

  protected afterRemoved(): void {
    this.selectedId.set(null);
    this.client.close();
  }

  protected startCompose(mode: ComposeMode): void {
    this.sent.set('');
    this.composing.set({ mode });
  }

  protected endCompose(): void {
    this.composing.set(null);
  }

  protected composed(message: string): void {
    this.composing.set(null);
    this.sent.set(message);
    clearTimeout(this.sentTimer);
    this.sentTimer = setTimeout(() => this.sent.set(''), 6000);
  }

  private focusRow(id: string | null): void {
    afterNextRender(() => this.rows().find((r) => r.nativeElement.dataset['id'] === id)?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected onEscape(event: Event): void {
    if (this.composing()) return;
    if (this.selected()) {
      event.preventDefault();
      this.close();
    }
  }
}
