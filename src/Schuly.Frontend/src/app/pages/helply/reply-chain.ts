import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBan,
  lucideCalendar,
  lucideCalendarX,
  lucideChevronDown,
  lucideCircleAlert,
  lucideFileCode,
  lucideFileText,
  lucideGraduationCap,
  lucideMail,
  lucideMessageSquareText,
  lucideMessagesSquare,
  lucideNotebookPen,
  lucideNotebookText,
  lucideSearch,
  lucideSquareTerminal,
  lucideUser,
  lucideWrench,
} from '@ng-icons/lucide';
import { PkChainOfThoughtImports } from '@prompt-kit/chain-of-thought';
import { PkCodeBlockImports } from '@prompt-kit/code-block';
import { PkMarkdown } from '@prompt-kit/markdown';
import { ToolStatus } from '../../core/helply-types';
import { ChainStep, ReplyTimeline, chainSummary } from './helply-timeline';

const STATUS_TEXT: Record<ToolStatus, string> = {
  running: 'In progress',
  done: 'Done',
  failed: "Didn't work",
  denied: 'Not allowed',
};

/**
 * What Helply did on the way to its answer, as one ordered chain of thought: the text it wrote between
 * tool calls and each step, in the order they happened. It stays open while the reply streams; a
 * finished chain of more than one entry folds into a one-line summary that opens it again.
 */
@Component({
  selector: 'app-reply-chain',
  imports: [NgIcon, NgTemplateOutlet, PkChainOfThoughtImports, PkCodeBlockImports, PkMarkdown],
  providers: [
    provideIcons({
      lucideBan,
      lucideCalendar,
      lucideCalendarX,
      lucideChevronDown,
      lucideCircleAlert,
      lucideFileCode,
      lucideFileText,
      lucideGraduationCap,
      lucideMail,
      lucideMessageSquareText,
      lucideMessagesSquare,
      lucideNotebookPen,
      lucideNotebookText,
      lucideSearch,
      lucideSquareTerminal,
      lucideUser,
      lucideWrench,
    }),
  ],
  host: { class: 'block min-w-0' },
  template: `
    @if (collapsible()) {
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 flex max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm outline-none transition-colors focus-visible:ring-3"
        [attr.aria-expanded]="shown()"
        [attr.aria-controls]="bodyId"
        (click)="open.set(!open())"
      >
        <ng-icon [name]="headerIcon()" aria-hidden="true" class="shrink-0" />
        <span class="min-w-0 truncate">{{ summary() }}</span>
        @if (failures()) {
          <ng-icon name="lucideCircleAlert" class="text-destructive shrink-0" aria-hidden="true" />
          <span class="sr-only">, {{ failures() }} {{ failures() === 1 ? 'step' : 'steps' }} didn't work</span>
        }
        <ng-icon
          name="lucideChevronDown"
          aria-hidden="true"
          class="shrink-0 transition-transform duration-200"
          [class.rotate-180]="shown()"
        />
      </button>
    }
    <!-- Height animates through the grid row, so the chain folds and opens smoothly. -->
    <div
      [id]="bodyId"
      class="grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-out motion-reduce:transition-none"
      [class.grid-rows-[1fr]]="shown()"
      [class.grid-rows-[0fr]]="!shown()"
      [class.opacity-0]="!shown()"
      [class.invisible]="!shown()"
      [attr.inert]="shown() ? null : ''"
    >
      <div class="min-h-0 overflow-hidden">
        <pk-chain-of-thought role="list" aria-label="What Helply did" class="block" [class.pt-3]="collapsible()">
          @for (entry of timeline().chain; track entry.key) {
            <pk-chain-of-thought-step role="listitem" [last]="$last">
              @if (entry.kind === 'text') {
                <div class="text-muted-foreground flex min-w-0 items-start gap-2 text-sm">
                  <span class="mt-1 inline-flex size-4 shrink-0 items-center justify-center">
                    <ng-icon name="lucideMessageSquareText" aria-hidden="true" />
                  </span>
                  <pk-markdown
                    externalImages="none"
                    rawHtml="escape"
                    linkPolicy="strict"
                    class="min-w-0 break-words [&_a]:underline [&_a]:underline-offset-2 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                    [content]="entry.text"
                  />
                </div>
              } @else if (entry.code) {
                <pk-chain-of-thought-trigger [leftIcon]="true" class="max-w-full">
                  <ng-icon leftIcon [name]="entry.icon" aria-hidden="true" />
                  <ng-container [ngTemplateOutlet]="label" [ngTemplateOutletContext]="{ $implicit: entry }" />
                </pk-chain-of-thought-trigger>
                <pk-chain-of-thought-content>
                  <pk-chain-of-thought-item class="flex min-w-0 flex-col gap-2">
                    <pk-code-block class="min-w-0">
                      <pk-code-block-group class="text-muted-foreground border-b px-3 py-1.5 text-xs">
                        <span>Command</span>
                      </pk-code-block-group>
                      <pk-code-block-code
                        class="[&_pre]:break-all [&_pre]:whitespace-pre-wrap"
                        language="bash"
                        [code]="entry.code.command"
                      />
                    </pk-code-block>
                    @if (entry.code.output !== null) {
                      <pre
                        tabindex="0"
                        role="region"
                        aria-label="Output"
                        class="bg-muted text-foreground focus-visible:ring-ring/50 max-h-72 overflow-auto rounded-lg p-3 font-mono text-xs break-all whitespace-pre-wrap outline-none focus-visible:ring-3"
                      >{{ entry.code.output || '(no output)' }}</pre>
                    }
                    @if (entry.code.exitCode !== null) {
                      <p class="text-xs" [class]="entry.code.exitCode === 0 ? 'text-muted-foreground' : 'text-destructive font-medium'">
                        exit code {{ entry.code.exitCode }}
                      </p>
                    }
                  </pk-chain-of-thought-item>
                </pk-chain-of-thought-content>
              } @else {
                <!-- A step with nothing to open is a plain row: the kit's trigger is always a disclosure button. -->
                <div class="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                  <span class="inline-flex size-4 shrink-0 items-center justify-center">
                    <ng-icon [name]="entry.icon" aria-hidden="true" />
                  </span>
                  <ng-container [ngTemplateOutlet]="label" [ngTemplateOutletContext]="{ $implicit: entry }" />
                </div>
              }
            </pk-chain-of-thought-step>
          }
        </pk-chain-of-thought>
      </div>
    </div>

    <ng-template #label let-step>
      <span class="min-w-0">
        @if (step.status === 'running') {
          <span class="shimmer motion-reduce:shimmer-none [--shimmer-color:var(--foreground)]">{{ step.label }}</span>
        } @else {
          {{ step.label }}
        }
        @if (step.detail) {
          <span class="text-muted-foreground"> · {{ step.detail }}</span>
        }
        @if (step.status === 'failed' || step.status === 'denied') {
          <span class="text-destructive inline-flex items-center gap-1 align-middle">
            ·
            <ng-icon [name]="step.status === 'failed' ? 'lucideCircleAlert' : 'lucideBan'" aria-hidden="true" />
            {{ statusText(step.status) }}
          </span>
        } @else {
          <span class="sr-only">, {{ statusText(step.status) }}</span>
        }
      </span>
    </ng-template>
  `,
})
export class ReplyChain {
  private static next = 0;
  protected readonly bodyId = `helply-chain-${ReplyChain.next++}`;

  readonly timeline = input.required<ReplyTimeline>();
  /** The reply is still arriving: the chain stays open and cannot be folded. */
  readonly streaming = input(false);

  /** Whether a finished chain was opened again. */
  protected readonly open = signal(false);

  /** A finished chain of more than one entry folds into a line; a single step is shown as it is. */
  protected readonly collapsible = computed(() => !this.streaming() && this.timeline().chain.length > 1);
  protected readonly shown = computed(() => !this.collapsible() || this.open());
  protected readonly summary = computed(() => chainSummary(this.timeline()));
  protected readonly headerIcon = computed(
    () => this.timeline().chain.find((e): e is ChainStep => e.kind === 'step')?.icon ?? 'lucideWrench',
  );
  protected readonly failures = computed(
    () => this.timeline().chain.filter((e) => e.kind === 'step' && e.status === 'failed').length,
  );

  protected statusText(status: ToolStatus): string {
    return STATUS_TEXT[status];
  }
}
