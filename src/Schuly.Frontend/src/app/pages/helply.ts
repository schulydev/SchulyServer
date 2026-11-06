import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePanelLeft, lucidePlus, lucideRefreshCw, lucideSettings } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HelplyAttachment } from '../core/helply-types';
import { FileViewer, ViewerFile } from '../shared/file-viewer';
import { SplitHandle } from '../shared/split-handle';
import { Composer } from './helply/composer';
import { ConversationList } from './helply/conversation-list';
import { HelplySettingsSheet } from './helply/helply-settings-sheet';
import { HelplyAiNotice, aiNoticeSeen } from './helply/ai-notice';
import { HelplyStore } from './helply/helply-store';
import { MessageList } from './helply/message-list';

const LIST_WIDTH_KEY = 'schuly.helply.listWidth';
const LIST_MIN = 200;
const LIST_MAX = 420;
const LIST_DEFAULT = 280;

function readListWidth(): number {
  try {
    const stored = Number(localStorage.getItem(LIST_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return Math.min(LIST_MAX, Math.max(LIST_MIN, stored));
  } catch {
    /* storage is optional */
  }
  return LIST_DEFAULT;
}

@Component({
  selector: 'app-helply',
  imports: [
    TranslatePipe,
    Composer,
    ConversationList,
    HelplyAiNotice,
    HelplySettingsSheet,
    FileViewer,
    HlmAlertImports,
    HlmButton,
    HlmSheetImports,
    HlmSpinner,
    MessageList,
    NgIcon,
    SplitHandle,
  ],
  providers: [HelplyStore, provideIcons({ lucidePanelLeft, lucidePlus, lucideRefreshCw, lucideSettings })],
  host: { class: 'flex min-h-0 min-w-0 flex-1' },
  template: `
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ store.announcement() }}</div>

    @if (store.availability() === 'on' && aiNotice.value() === 'no') {
      <app-helply-ai-notice class="w-full" (understood)="aiNotice.set('yes')" />
    } @else {
    @if (store.availability() === 'on') {
      @if (wide() && navOpen()) {
        <aside
          id="helply-conversations"
          class="bg-sidebar flex shrink-0 flex-col"
          [attr.aria-label]="'helply.conversations' | translate"
          [style.width.px]="listWidth()"
        >
        <app-conversation-list
          [conversations]="store.conversations()"
          [activeId]="store.activeId()"
          (select)="open($event)"
          (create)="newChat()"
          (rename)="store.rename($event.id, $event.title)"
          (remove)="store.remove($event)"
          (removeAll)="store.removeAll()"
        />
        </aside>
        <app-split-handle
          [label]="'helply.resizeList' | translate"
          [width]="listWidth()"
          [min]="listMin"
          [max]="listMax"
          [initial]="listDefault"
          (widthChange)="setListWidth($event)"
        />
      }
    }

    <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden" [attr.aria-label]="'helply.chat' | translate">
      <div class="flex items-center gap-2 border-b px-4 py-2">
        @if (store.availability() === 'on') {
          <button
            hlmBtn
            type="button"
            variant="outline"
            size="sm"
            [attr.aria-expanded]="navOpen()"
            (click)="navOpen.set(!navOpen())"
          >
            <ng-icon name="lucidePanelLeft" aria-hidden="true" />
            <span class="max-sm:sr-only">{{ 'helply.conversationsShort' | translate }}</span>
          </button>
        }
        <h2 class="min-w-0 flex-1 truncate text-sm font-medium">{{ store.activeTitle() }}</h2>
        @if (store.availability() === 'on') {
          <button hlmBtn type="button" variant="outline" size="sm" class="lg:hidden" (click)="newChat()">
            <ng-icon name="lucidePlus" aria-hidden="true" />
            <span class="sr-only">{{ 'helply.newChat' | translate }}</span>
          </button>
          <button hlmBtn type="button" variant="outline" size="sm" (click)="settingsOpen.set(true)">
            <ng-icon name="lucideSettings" aria-hidden="true" />
            <span class="max-sm:sr-only">{{ 'helply.settings' | translate }}</span>
          </button>
        }
      </div>

      @if (store.notice(); as notice) {
        <div hlmAlert variant="destructive" role="alert" class="m-3">
          <p hlmAlertDescription>{{ notice }}</p>
        </div>
      }

      @switch (store.availability()) {
        @case ('loading') {
          <div class="flex flex-1 items-center justify-center"><hlm-spinner [attr.aria-label]="'helply.loading' | translate" /></div>
        }
        @case ('off') {
          <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <img src="helply-avatar.svg" alt="" width="64" height="64" class="size-16 opacity-70" />
            <h2 class="text-xl font-semibold">{{ 'helply.off.title' | translate }}</h2>
            <p class="text-muted-foreground max-w-md text-sm">
              {{ 'helply.off.description' | translate }}
            </p>
          </div>
        }
        @case ('error') {
          <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <h2 class="text-xl font-semibold">{{ 'helply.error.title' | translate }}</h2>
            <p class="text-muted-foreground max-w-md text-sm">{{ 'helply.error.description' | translate }}</p>
            <button hlmBtn type="button" variant="outline" (click)="store.init()">
              <ng-icon name="lucideRefreshCw" aria-hidden="true" />
              {{ 'common.retry' | translate }}
            </button>
          </div>
        }
        @default {
          <app-message-list
            [messages]="store.messages()"
            [approvals]="store.approvals()"
            [decisions]="store.decisions()"
            [loading]="store.loadingConversation()"
            [busy]="store.streaming()"
            [suggestions]="store.suggestions()"
            (suggest)="send($event)"
            (retry)="store.retry()"
            (decide)="store.decide($event.approvalId, $event.approved)"
            (openFile)="view($event)"
            (downloadFile)="download($event)"
          />
          <app-composer
            [streaming]="store.streaming()"
            [drafts]="store.drafts()"
            [errors]="store.attachErrors()"
            (send)="send($event)"
            (stop)="store.stop()"
            (attach)="store.attach($event)"
            (removeDraft)="store.removeDraft($event)"
            (preview)="previewDraft($event)"
          />
        }
      }
    </section>

    <hlm-sheet side="left" [state]="!wide() && navOpen() ? 'open' : 'closed'" (closed)="closeSheet()">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-80 max-w-[90vw] gap-0 p-0">
        <hlm-sheet-header class="border-b">
          <h2 hlmSheetTitle>{{ 'helply.conversationsShort' | translate }}</h2>
          <p hlmSheetDescription class="sr-only">{{ 'helply.pick' | translate }}</p>
        </hlm-sheet-header>
        <app-conversation-list
          [conversations]="store.conversations()"
          [activeId]="store.activeId()"
          (select)="navOpen.set(false); open($event)"
          (create)="navOpen.set(false); newChat()"
          (rename)="store.rename($event.id, $event.title)"
          (remove)="store.remove($event)"
          (removeAll)="store.removeAll()"
        />
      </hlm-sheet-content>
    </hlm-sheet>

    <app-helply-settings-sheet [(open)]="settingsOpen" (saved)="store.settings.set($event)" />
    <app-file-viewer [file]="viewing()" [files]="viewerFiles()" (closed)="viewing.set(null)" />
      }
  `,
})
export class Helply implements OnInit {
  protected readonly store = inject(HelplyStore);
  protected readonly aiNotice = aiNoticeSeen();
  protected readonly listMin = LIST_MIN;
  protected readonly listMax = LIST_MAX;
  protected readonly listDefault = LIST_DEFAULT;
  private readonly query = typeof matchMedia === 'function' ? matchMedia('(min-width: 1024px)') : null;
  /** Wide screens show the list beside the chat; narrow ones open it in a sheet. */
  protected readonly wide = signal(this.query?.matches ?? true);
  /** Open by default on wide screens, closed on small ones. */
  protected readonly navOpen = signal(this.query?.matches ?? true);
  protected readonly listWidth = signal(readListWidth());
  protected readonly settingsOpen = signal(false);
  protected readonly viewing = signal<ViewerFile | null>(null);

  /** Every file in the open conversation, in message order, so the viewer can step through them. */
  protected readonly viewerFiles = computed<ViewerFile[]>(() => {
    const seen = new Set<string>();
    const files: ViewerFile[] = [];
    for (const draft of this.store.drafts()) {
      if (draft.attachment && !seen.has(draft.attachment.id)) {
        seen.add(draft.attachment.id);
        files.push(this.toViewerFile(draft.attachment));
      }
    }
    for (const message of this.store.messages()) {
      for (const a of message.attachments) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        files.push(this.toViewerFile(a));
      }
    }
    return files;
  });
  private readonly composer = viewChild(Composer);

  constructor() {
    const query = this.query;
    if (!query) return;
    const change = (event: MediaQueryListEvent) => {
      this.wide.set(event.matches);
      this.navOpen.set(event.matches);
    };
    query.addEventListener('change', change);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', change));
  }

  protected setListWidth(width: number): void {
    const clamped = Math.min(LIST_MAX, Math.max(LIST_MIN, Math.round(width)));
    this.listWidth.set(clamped);
    try {
      localStorage.setItem(LIST_WIDTH_KEY, String(clamped));
    } catch {
      /* storage is optional */
    }
  }

  protected closeSheet(): void {
    if (!this.wide()) this.navOpen.set(false);
  }

  ngOnInit(): void {
    void this.store.init();
  }

  protected async open(id: string): Promise<void> {
    await this.store.select(id);
    this.composer()?.focus();
  }

  protected newChat(): void {
    this.store.newChat();
    queueMicrotask(() => this.composer()?.focus());
  }

  protected view(attachment: HelplyAttachment): void {
    this.viewing.set(this.viewerFiles().find((f) => f.key === `helply:${attachment.id}`) ?? null);
  }

  protected previewDraft(key: string): void {
    const attachment = this.store.drafts().find((d) => d.key === key)?.attachment;
    if (attachment) this.view(attachment);
  }

  protected async download(attachment: HelplyAttachment): Promise<void> {
    try {
      const blob = await this.store.attachmentBlob(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      this.store.notice.set(t('helply.downloadFailed'));
    }
  }

  private toViewerFile(a: HelplyAttachment): ViewerFile {
    return { name: a.fileName, key: `helply:${a.id}`, load: () => this.store.attachmentBlob(a.id) };
  }

  protected send(text: string): void {
    void this.store.send(text);
    this.composer()?.focus();
  }
}
