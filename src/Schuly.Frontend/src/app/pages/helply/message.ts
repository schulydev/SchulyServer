import { Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideRotateCw } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { ChatMessage } from '../../core/helply-state';
import { renderMarkdown } from '../../core/markdown';
import { ToolChips } from './tool-chips';

const MARKDOWN =
  'text-sm leading-relaxed break-words ' +
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 ' +
  '[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold ' +
  '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold ' +
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:rounded-sm [&_a:focus-visible]:ring-ring/50 [&_a:focus-visible]:ring-3 [&_a]:outline-none ' +
  '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs ' +
  '[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-3 ' +
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground ' +
  '[&_.table-scroll]:my-2 [&_.table-scroll]:overflow-x-auto [&_.table-scroll]:rounded-lg [&_.table-scroll]:border [&_.table-scroll:focus-visible]:ring-ring/50 [&_.table-scroll:focus-visible]:ring-3 [&_.table-scroll]:outline-none ' +
  '[&_table]:w-full [&_table]:text-xs [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_hr]:my-3';

@Component({
  selector: 'app-helply-message',
  imports: [HlmButton, NgIcon, ToolChips],
  providers: [provideIcons({ lucideCircleAlert, lucideRotateCw })],
  host: { class: 'flex' , '[class.justify-end]': 'isUser()' },
  template: `
    @if (isUser()) {
      <article aria-label="You" class="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm break-words whitespace-pre-wrap">
        {{ message().text }}
      </article>
    } @else {
      <article aria-label="Helply" class="flex max-w-full min-w-0 gap-3 sm:max-w-[85%]">
        <img src="helply-avatar.svg" alt="" width="32" height="32" class="mt-0.5 size-8 shrink-0" />
        <div class="flex min-w-0 flex-col gap-2">
          <app-tool-chips [tools]="message().tools" />
          @if (message().text) {
            <div [class]="markdownClass" [innerHTML]="html()"></div>
          } @else if (message().streaming && !message().tools.length) {
            <p class="text-muted-foreground text-sm" aria-hidden="true">Thinking...</p>
          }
          @if (message().error) {
            <div class="text-destructive flex items-start gap-2 text-sm" role="alert">
              <ng-icon name="lucideCircleAlert" aria-hidden="true" class="mt-0.5 shrink-0" />
              <span>{{ message().error }}</span>
            </div>
            @if (canRetry()) {
              <div>
                <button hlmBtn type="button" variant="outline" size="sm" (click)="retry.emit()">
                  <ng-icon name="lucideRotateCw" aria-hidden="true" />
                  Retry
                </button>
              </div>
            }
          }
        </div>
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

  protected readonly markdownClass = MARKDOWN;
  protected readonly isUser = computed(() => this.message().role === 'user');
  protected readonly html = computed(() => renderMarkdown(this.message().text));
  protected readonly canRetry = computed(
    () => this.isLast() && this.message().retryable && !this.message().streaming && !this.retryDisabled(),
  );
}
