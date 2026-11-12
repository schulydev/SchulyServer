import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
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
import { ToolStatus } from '../../core/helply-types';
import { ChainStep, runSummary } from './helply-timeline';

const STATUS_TEXT: Record<ToolStatus, string> = {
  running: 'helply.status.running',
  done: 'helply.status.done',
  failed: 'helply.status.failed',
  denied: 'helply.status.denied',
};

/** How many of the latest steps show while a run is being taken; the earlier ones fold away behind a toggle. */
const SHOWN_STEPS = 3;

/**
 * One run of steps Helply took between two stretches of its text. While the reply streams the latest few
 * show (earlier ones fold behind a toggle, and steps rise in as they start); a finished run of more than
 * one step folds into a one-line summary that opens it again.
 */
@Component({
  selector: 'app-reply-chain',
  imports: [TranslatePipe, NgIcon, NgTemplateOutlet, PkChainOfThoughtImports, PkCodeBlockImports],
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
        class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 flex max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-3"
        [attr.aria-expanded]="shown()"
        [attr.aria-controls]="bodyId"
        (click)="open.set(!open())"
      >
        <ng-icon [name]="headerIcon()" size="14px" aria-hidden="true" class="shrink-0" />
        <span class="min-w-0 truncate">{{ summary() }}</span>
        @if (failures()) {
          <ng-icon name="lucideCircleAlert" size="14px" class="text-destructive shrink-0" aria-hidden="true" />
          <span class="sr-only">, {{ 'helply.run.failed' | translate: { count: failures() } }}</span>
        }
        <ng-icon
          name="lucideChevronDown"
          size="12px"
          aria-hidden="true"
          class="shrink-0 transition-transform duration-200"
          [class.rotate-180]="shown()"
        />
      </button>
    }
    <!-- Height animates through the grid row, so a run folds and opens smoothly instead of jumping. -->
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
        <pk-chain-of-thought role="list" [attr.aria-label]="'helply.did' | translate" class="block" [class.pt-2]="collapsible()">
          @if (active() && steps().length > shownSteps) {
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 mb-2 flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-xs outline-none transition-colors focus-visible:ring-3"
              [attr.aria-expanded]="expanded()"
              (click)="expanded.set(!expanded())"
            >
              {{ (expanded() ? 'helply.run.fewer' : 'helply.run.earlier') | translate: { count: steps().length - shownSteps } }}
              <ng-icon name="lucideChevronDown" size="12px" aria-hidden="true" class="transition-transform" [class.rotate-180]="expanded()" />
            </button>
          }
          <!-- Tracked by the step itself, so only the one folding away animates. -->
          @for (step of steps(); track step.key) {
            @if ($index >= folded()) {
              <pk-chain-of-thought-step
                role="listitem"
                [last]="$last"
                [animate.enter]="active() ? 'rise-in' : ''"
                [animate.leave]="active() ? 'fold-away' : ''"
              >
                @if (step.code) {
                  <pk-chain-of-thought-trigger [leftIcon]="true" class="max-w-full">
                    <ng-icon leftIcon [name]="step.icon" size="14px" aria-hidden="true" />
                    <ng-container [ngTemplateOutlet]="label" [ngTemplateOutletContext]="{ $implicit: step }" />
                  </pk-chain-of-thought-trigger>
                  <pk-chain-of-thought-content>
                    <pk-chain-of-thought-item class="flex min-w-0 flex-col gap-2">
                      <pk-code-block class="min-w-0">
                        <pk-code-block-group class="text-muted-foreground border-b px-3 py-1.5 text-xs">
                          <span>{{ 'helply.command' | translate }}</span>
                        </pk-code-block-group>
                        <pk-code-block-code
                          class="[&_pre]:break-all [&_pre]:whitespace-pre-wrap"
                          language="bash"
                          [code]="step.code.command"
                        />
                      </pk-code-block>
                      @if (step.code.output !== null) {
                        <pre
                          tabindex="0"
                          role="region"
                          [attr.aria-label]="'helply.output' | translate"
                          class="bg-muted text-foreground focus-visible:ring-ring/50 max-h-72 overflow-auto rounded-lg p-3 font-mono text-xs break-all whitespace-pre-wrap outline-none focus-visible:ring-3"
                        >{{ step.code.output || '(no output)' }}</pre>
                      }
                      @if (step.code.exitCode !== null) {
                        <p class="text-xs" [class]="step.code.exitCode === 0 ? 'text-muted-foreground' : 'text-destructive font-medium'">
                          {{ 'helply.exitCode' | translate: { code: step.code.exitCode } }}
                        </p>
                      }
                    </pk-chain-of-thought-item>
                  </pk-chain-of-thought-content>
                } @else {
                  <!-- A step with nothing to open is a plain row: the kit's trigger is always a disclosure button. -->
                  <div class="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                    <span class="inline-flex size-4 shrink-0 items-center justify-center">
                      <ng-icon [name]="step.icon" size="14px" aria-hidden="true" />
                    </span>
                    <ng-container [ngTemplateOutlet]="label" [ngTemplateOutletContext]="{ $implicit: step }" />
                  </div>
                }
              </pk-chain-of-thought-step>
            }
          }
        </pk-chain-of-thought>
      </div>
    </div>

    <ng-template #label let-step>
      <span class="min-w-0">
        @if (step.status === 'running') {
          <span class="shimmer text-muted-foreground motion-reduce:shimmer-none [--shimmer-color:var(--foreground)]">{{ step.label }}</span>
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

  readonly steps = input.required<readonly ChainStep[]>();
  /** Still being taken: the reply is streaming and nothing was written after this run yet. The run stays open. */
  readonly active = input(false);

  protected readonly shownSteps = SHOWN_STEPS;
  /** Whether the earlier steps of a run being taken are shown too. */
  protected readonly expanded = signal(false);
  /** Whether a finished run was opened again. */
  protected readonly open = signal(false);

  /** A finished run of more than one step folds into a line; a single step is shown as it is. */
  protected readonly collapsible = computed(() => !this.active() && this.steps().length > 1);
  protected readonly shown = computed(() => !this.collapsible() || this.open());
  /** How many steps at the start of the run are folded away while it is taken; none once it is done. */
  protected readonly folded = computed(() => (this.expanded() || !this.active() ? 0 : Math.max(0, this.steps().length - SHOWN_STEPS)));
  protected readonly summary = computed(() => runSummary(this.steps()));
  protected readonly headerIcon = computed(() => this.steps()[0]?.icon ?? 'lucideWrench');
  protected readonly failures = computed(() => this.steps().filter((s) => s.status === 'failed').length);

  protected statusText(status: ToolStatus): string {
    return t(STATUS_TEXT[status]);
  }
}
