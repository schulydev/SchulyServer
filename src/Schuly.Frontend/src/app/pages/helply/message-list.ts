import { Component, ElementRef, Injector, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { afterNextRender } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { ChatMessage } from '../../core/helply-state';
import { ApprovalRequest } from '../../core/helply-types';
import { ApprovalCard } from './approval-card';
import { HelplyMessageView } from './message';

export const STARTER_PROMPTS = [
  'What exams do I have this week?',
  'Summarize my unread mail',
  'How are my grades in Mathematik?',
  'Do I have any unexcused absences?',
];

const STICK_THRESHOLD = 80;

@Component({
  selector: 'app-message-list',
  imports: [ApprovalCard, HelplyMessageView, HlmButton, HlmSpinner, NgIcon],
  providers: [provideIcons({ lucideArrowDown })],
  host: { class: 'relative flex min-h-0 flex-1 flex-col' },
  template: `
    <div
      #scroller
      role="log"
      aria-live="off"
      aria-label="Conversation with Helply"
      tabindex="0"
      class="focus-visible:ring-ring/50 min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 py-4 outline-none focus-visible:ring-3 motion-reduce:scroll-auto"
      (scroll)="onScroll()"
    >
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
        @if (loading()) {
          <div class="flex justify-center py-16"><hlm-spinner aria-label="Loading conversation" /></div>
        } @else if (!messages().length) {
          <div class="flex flex-col items-center gap-4 py-10 text-center">
            <img src="helply-avatar.svg" alt="" width="64" height="64" class="size-16" />
            <div>
              <h2 class="text-xl font-semibold">Hi, I'm Helply</h2>
              <p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
                Ask me about your exams, grades, absences, agenda or mail. I only use what you allow in my settings.
              </p>
            </div>
            <ul class="flex w-full max-w-md flex-col gap-2" aria-label="Suggested questions">
              @for (prompt of prompts; track prompt) {
                <li>
                  <button hlmBtn type="button" variant="outline" class="h-auto w-full justify-start py-2 text-left whitespace-normal" (click)="suggest.emit(prompt)">
                    {{ prompt }}
                  </button>
                </li>
              }
            </ul>
          </div>
        } @else {
          @for (message of messages(); track message.id; let last = $last) {
            <app-helply-message [message]="message" [isLast]="last" [retryDisabled]="busy()" (retry)="retry.emit()" />
          }
          @for (approval of approvals(); track approval.approvalId) {
            <div class="ml-0 sm:ml-11">
              <app-approval-card
                [approval]="approval"
                [decision]="decisions()[approval.approvalId]"
                [busy]="busy()"
                (decide)="decide.emit({ approvalId: approval.approvalId, approved: $event })"
              />
            </div>
          }
        }
      </div>
    </div>
    @if (!stuck()) {
      <button
        hlmBtn
        type="button"
        variant="outline"
        size="icon"
        class="bg-background absolute right-6 bottom-3 rounded-full shadow-md"
        aria-label="Scroll to latest message"
        (click)="scrollToEnd()"
      >
        <ng-icon name="lucideArrowDown" aria-hidden="true" />
      </button>
    }
  `,
})
export class MessageList {
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  readonly messages = input.required<ChatMessage[]>();
  readonly approvals = input<ApprovalRequest[]>([]);
  readonly decisions = input<Record<string, boolean>>({});
  readonly loading = input(false);
  readonly busy = input(false);
  readonly suggest = output<string>();
  readonly retry = output();
  readonly decide = output<{ approvalId: string; approved: boolean }>();

  protected readonly prompts = STARTER_PROMPTS;
  /** True while the view follows new content; false once the user scrolls up. */
  protected readonly stuck = signal(true);

  constructor() {
    effect(() => {
      this.messages();
      this.approvals();
      if (this.stuck()) afterNextRender(() => this.toEnd(), { injector: this.injector });
    });
  }

  protected onScroll(): void {
    const el = this.scroller().nativeElement;
    this.stuck.set(el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD);
  }

  protected scrollToEnd(): void {
    this.stuck.set(true);
    this.toEnd();
  }

  private toEnd(): void {
    const el = this.scroller().nativeElement;
    el.scrollTop = el.scrollHeight;
  }
}
