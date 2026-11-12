import { TranslatePipe } from '@ngx-translate/core';
import { Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideRotateCw } from '@ng-icons/lucide';
import { PkAssistantTurn, PkUserTurn } from '@prompt-kit/chat-turn';
import { PkMarkdown } from '@prompt-kit/markdown';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { ChatMessage } from '../../core/helply-state';
import { HelplyAttachment } from '../../core/helply-types';
import { AttachmentCards } from './attachment-cards';
import { buildTimeline, chainBlocks } from './helply-timeline';
import { ReplyChain } from './reply-chain';

/**
 * Typography for Helply's answers. Fenced code is rendered by pk-markdown as the kit's code block (a
 * header with the language and a Copy button, highlighted by shiki); only its plain fallback, before
 * highlighting, is styled here.
 */
const MARKDOWN =
  'break-words ' +
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 ' +
  '[&_h1]:mt-4 [&_h1]:mb-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold ' +
  '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_:is(h1,h2,h3):first-child]:mt-0 ' +
  '[&_a]:text-primary [&_a]:underline [&_a+span]:text-muted-foreground [&_a]:underline-offset-2 [&_a]:rounded-sm [&_a:focus-visible]:ring-ring/50 [&_a:focus-visible]:ring-3 [&_a]:outline-none ' +
  '[&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_code]:font-mono [&_:not(pre)>code]:text-xs ' +
  '[&_.pk-code-container>pre]:bg-muted [&_.pk-code-container>pre]:my-3 [&_.pk-code-container>pre]:overflow-x-auto [&_.pk-code-container>pre]:rounded-md [&_.pk-code-container>pre]:border [&_.pk-code-container>pre]:p-3 [&_.pk-code-container>pre]:text-[13px] ' +
  '[&_.pk-code-block]:bg-card [&_.pk-code-copy]:rounded-sm [&_.pk-code-copy]:outline-none [&_.pk-code-copy:focus-visible]:ring-ring/50 [&_.pk-code-copy:focus-visible]:ring-3 ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground ' +
  '[&_table]:my-2 [&_table]:block [&_table]:w-fit [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:rounded-lg [&_table]:border ' +
  '[&_table]:w-full [&_table]:text-xs [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_hr]:my-3';

@Component({
  selector: 'app-helply-message',
  imports: [TranslatePipe, AttachmentCards, HlmAlertImports, HlmButton, NgIcon, PkAssistantTurn, PkMarkdown, PkUserTurn, ReplyChain],
  providers: [provideIcons({ lucideCircleAlert, lucideRotateCw })],
  host: { class: 'flex min-w-0' },
  template: `
    @if (isUser()) {
      <article [attr.aria-label]="'chat.you' | translate" class="flex w-full min-w-0 justify-end">
        <pk-user-turn class="w-full min-w-0">
          <app-attachment-cards pkUserTurnTop [attachments]="message().attachments" (open)="openFile.emit($event)" (download)="downloadFile.emit($event)" />
          @if (message().text) {<span>{{ message().text }}</span>}
        </pk-user-turn>
      </article>
    } @else {
      <article aria-label="Helply" class="flex w-full min-w-0 gap-3">
        <img src="helply-avatar.svg" alt="" width="32" height="32" class="mt-0.5 size-8 shrink-0" />
        <pk-assistant-turn class="min-w-0 flex-1" [copyText]="copyText()" [streaming]="message().streaming">
          <div class="flex min-w-0 flex-col gap-4">
            <!-- Text and runs of steps in the order they happened; a run is open while it is being taken. -->
            @for (block of blocks(); track block.key; let last = $last) {
              @if (block.kind === 'steps') {
                <app-reply-chain [steps]="block.steps" [active]="message().streaming && last && !timeline().answer" />
              } @else {
                <pk-markdown externalImages="none" rawHtml="escape" linkPolicy="strict" [class]="markdownClass" [content]="block.text" />
              }
            }
            @if (timeline().answer) {
              <pk-markdown externalImages="none" rawHtml="escape" linkPolicy="strict" [class]="markdownClass" [content]="timeline().answer" />
            } @else if (thinking()) {
              <!-- The page's live region already says that Helply is typing. -->
              <p class="text-sm" aria-hidden="true">
                <span class="shimmer text-muted-foreground motion-reduce:shimmer-none [--shimmer-color:var(--foreground)]">{{ 'helply.thinking' | translate }}</span>
              </p>
            }
            @if (message().attachments.length) {
              <app-attachment-cards [attachments]="message().attachments" (open)="openFile.emit($event)" (download)="downloadFile.emit($event)" />
            }
            @if (message().error) {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" aria-hidden="true" />
                <!-- Spartan's destructive text on the card misses 4.5:1; mixed toward the foreground it passes in both themes. -->
                <p hlmAlertDescription class="text-[color-mix(in_oklch,var(--destructive)_70%,var(--foreground))]!">{{ message().error }}</p>
              </div>
            }
          </div>
          @if (canRetry()) {
            <button pkAssistantTurnActions hlmBtn type="button" variant="ghost" size="sm" (click)="retry.emit()">
              <ng-icon name="lucideRotateCw" aria-hidden="true" />
              {{ 'chat.retry' | translate }}
            </button>
          }
        </pk-assistant-turn>
      </article>
    }
  `,
})
export class HelplyMessageView {
  readonly message = input.required<ChatMessage>();
  /** Only the last message may be retried. */
  readonly isLast = input(false);
  readonly retryDisabled = input(false);
  readonly retry = output();
  readonly openFile = output<HelplyAttachment>();
  readonly downloadFile = output<HelplyAttachment>();

  protected readonly markdownClass = MARKDOWN;
  protected readonly isUser = computed(() => this.message().role === 'user');
  /** The steps Helply took, with the text it wrote between them, and its answer after the last one. */
  protected readonly timeline = computed(() => buildTimeline(this.message().text, this.message().tools));
  protected readonly blocks = computed(() => chainBlocks(this.timeline().chain));
  /** Copy takes the answer; a reply that is all steps copies its whole text. */
  protected readonly copyText = computed(() => this.timeline().answer || this.message().text);
  /** Waiting for the model: nothing written yet after the last step and no step running. */
  protected readonly thinking = computed(
    () => this.message().streaming && !this.timeline().answer && !this.message().tools.some((t) => t.status === 'running'),
  );
  protected readonly canRetry = computed(
    () => this.isLast() && this.message().retryable && !this.message().streaming && !this.retryDisabled(),
  );
}
