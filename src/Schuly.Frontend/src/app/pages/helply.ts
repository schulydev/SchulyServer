import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePanelLeft, lucidePlus, lucideRefreshCw, lucideSettings } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HelplyAttachment } from '../core/helply-types';
import { FileViewer, ViewerFile } from '../shared/file-viewer';
import { Composer } from './helply/composer';
import { ConversationList } from './helply/conversation-list';
import { HelplySettingsSheet } from './helply/helply-settings-sheet';
import { HelplyStore } from './helply/helply-store';
import { MessageList } from './helply/message-list';

@Component({
  selector: 'app-helply',
  imports: [
    Composer,
    ConversationList,
    HelplySettingsSheet,
    FileViewer,
    HlmAlertImports,
    HlmButton,
    HlmSheetImports,
    HlmSpinner,
    MessageList,
    NgIcon,
  ],
  providers: [HelplyStore, provideIcons({ lucidePanelLeft, lucidePlus, lucideRefreshCw, lucideSettings })],
  host: { class: 'flex min-h-0 flex-1' },
  template: `
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ store.announcement() }}</div>

    @if (store.availability() === 'on') {
      <aside class="bg-sidebar hidden w-72 shrink-0 flex-col border-r md:flex" aria-label="Helply conversations">
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
    }

    <section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Helply chat">
      <div class="flex items-center gap-2 border-b px-4 py-2">
        @if (store.availability() === 'on') {
          <button hlmBtn type="button" variant="outline" size="sm" class="md:hidden" (click)="navOpen.set(true)">
            <ng-icon name="lucidePanelLeft" aria-hidden="true" />
            Conversations
          </button>
        }
        <h2 class="min-w-0 flex-1 truncate text-sm font-medium">{{ store.activeTitle() }}</h2>
        @if (store.availability() === 'on') {
          <button hlmBtn type="button" variant="outline" size="sm" class="md:hidden" (click)="newChat()">
            <ng-icon name="lucidePlus" aria-hidden="true" />
            <span class="sr-only">New chat</span>
          </button>
          <button hlmBtn type="button" variant="outline" size="sm" (click)="settingsOpen.set(true)">
            <ng-icon name="lucideSettings" aria-hidden="true" />
            Helply settings
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
          <div class="flex flex-1 items-center justify-center"><hlm-spinner aria-label="Loading Helply" /></div>
        }
        @case ('off') {
          <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <img src="helply-avatar.svg" alt="" width="64" height="64" class="size-16 opacity-70" />
            <h2 class="text-xl font-semibold">Helply is turned off</h2>
            <p class="text-muted-foreground max-w-md text-sm">
              Helply isn't available on this Schuly server right now. Everything else in Schuly keeps working as usual.
              Check back later, or ask whoever runs this server to turn it on.
            </p>
          </div>
        }
        @case ('error') {
          <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <h2 class="text-xl font-semibold">Helply couldn't load</h2>
            <p class="text-muted-foreground max-w-md text-sm">Something went wrong while opening Helply.</p>
            <button hlmBtn type="button" variant="outline" (click)="store.init()">
              <ng-icon name="lucideRefreshCw" aria-hidden="true" />
              Try again
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
          />
        }
      }
    </section>

    <hlm-sheet side="left" [state]="navOpen() ? 'open' : 'closed'" (closed)="navOpen.set(false)">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-80 max-w-[90vw] gap-0 p-0">
        <hlm-sheet-header class="border-b">
          <h2 hlmSheetTitle>Conversations</h2>
          <p hlmSheetDescription class="sr-only">Pick a conversation or start a new chat.</p>
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

    <app-helply-settings-sheet [(open)]="settingsOpen" />
    <app-file-viewer [file]="viewing()" [files]="viewerFiles()" (closed)="viewing.set(null)" />
  `,
})
export class Helply implements OnInit {
  protected readonly store = inject(HelplyStore);
  protected readonly navOpen = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly viewing = signal<ViewerFile | null>(null);

  /** Every file in the open conversation, in message order, so the viewer can step through them. */
  protected readonly viewerFiles = computed<ViewerFile[]>(() => {
    const seen = new Set<string>();
    const files: ViewerFile[] = [];
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
      this.store.notice.set("Couldn't download that file.");
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
