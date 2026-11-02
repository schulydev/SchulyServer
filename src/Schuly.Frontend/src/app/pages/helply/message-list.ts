import { Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown } from '@ng-icons/lucide';
import { PkChatContainerContent, PkChatContainerRoot } from '@prompt-kit/chat-container';
import { PkPromptSuggestion } from '@prompt-kit/prompt-suggestion';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { ChatMessage } from '../../core/helply-state';
import { ApprovalRequest, HelplyAttachment } from '../../core/helply-types';
import { ApprovalCard } from './approval-card';
import { HelplyMessageView } from './message';

@Component({
  selector: 'app-message-list',
  imports: [ApprovalCard, HelplyMessageView, HlmButton, HlmEmptyImports, HlmSpinner, NgIcon, PkChatContainerContent, PkChatContainerRoot, PkPromptSuggestion],
  providers: [provideIcons({ lucideArrowDown })],
  host: { class: 'relative flex min-h-0 min-w-0 flex-1 flex-col' },
  template: `
    <pk-chat-container-root
      #scroller
      aria-live="off"
      aria-label="Conversation with Helply"
      tabindex="0"
      class="focus-visible:ring-ring/50 min-h-0 min-w-0 flex-1 px-4 py-4 outline-none focus-visible:ring-3"
    >
      <pk-chat-container-content class="mx-auto min-h-full min-w-0 max-w-3xl gap-6">
        @if (loading()) {
          <div class="flex justify-center py-16"><hlm-spinner aria-label="Loading conversation" /></div>
        } @else if (!messages().length) {
          <div class="flex min-h-full min-w-0 flex-1 flex-col items-center justify-center-safe gap-7 py-8">
            <hlm-empty class="max-w-md flex-none p-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
              <hlm-empty-header>
                <hlm-empty-media>
                  <img src="helply-avatar.svg" alt="" width="64" height="64" class="size-16" />
                </hlm-empty-media>
                <h2 hlmEmptyTitle class="text-xl">Hi, I'm Helply</h2>
                <p hlmEmptyDescription>
                  Ask me about your exams, grades, absences, agenda or mail. I only use what you allow in my settings.
                </p>
              </hlm-empty-header>
            </hlm-empty>
            @if (suggestions().length) {
              <ul class="flex w-full max-w-2xl min-w-0 flex-wrap justify-center gap-2" aria-label="Suggested questions">
                @for (prompt of suggestions(); track prompt) {
                  <li
                    class="max-w-full min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300"
                    [style.animation-delay.ms]="120 + $index * 50"
                  >
                    <pk-prompt-suggestion
                      size="sm"
                      class="h-auto max-w-full py-1.5 text-left whitespace-normal"
                      [content]="prompt"
                      (clicked)="suggest.emit(prompt)"
                    />
                  </li>
                }
              </ul>
            }
          </div>
        } @else {
          @for (message of messages(); track message.id; let last = $last) {
            <app-helply-message
              [message]="message"
              [isLast]="last"
              [retryDisabled]="busy()"
              (retry)="retry.emit()"
              (openFile)="openFile.emit($event)"
              (downloadFile)="downloadFile.emit($event)"
            />
          }
          @for (approval of approvals(); track approval.approvalId) {
            <div class="ml-0 min-w-0 sm:ml-11">
              <app-approval-card
                [approval]="approval"
                [decision]="decisions()[approval.approvalId]"
                [busy]="busy()"
                (decide)="decide.emit({ approvalId: approval.approvalId, approved: $event })"
              />
            </div>
          }
        }
      </pk-chat-container-content>
    </pk-chat-container-root>
    <!-- The kit's scroll-to-bottom: spartan's button calling the container's scrollToBottom(), shown while there is more below. -->
    <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <button
        hlmBtn
        type="button"
        variant="outline"
        size="icon"
        class="bg-background rounded-full shadow-md transition-[opacity,translate] duration-200 motion-reduce:transition-none"
        aria-label="Scroll to latest message"
        [class.pointer-events-auto]="scroller.canScrollDown()"
        [class.opacity-0]="!scroller.canScrollDown()"
        [class.translate-y-2]="!scroller.canScrollDown()"
        [attr.inert]="scroller.canScrollDown() ? null : ''"
        (click)="scroller.scrollToBottom()"
      >
        <ng-icon name="lucideArrowDown" aria-hidden="true" />
      </button>
    </div>
  `,
})
export class MessageList {
  readonly messages = input.required<ChatMessage[]>();
  readonly approvals = input<ApprovalRequest[]>([]);
  readonly decisions = input<Record<string, boolean>>({});
  readonly loading = input(false);
  readonly busy = input(false);
  /** Starter questions for an empty chat, matching what Helply may use. */
  readonly suggestions = input<string[]>([]);
  readonly suggest = output<string>();
  readonly retry = output();
  readonly openFile = output<HelplyAttachment>();
  readonly downloadFile = output<HelplyAttachment>();
  readonly decide = output<{ approvalId: string; approved: boolean }>();
}
