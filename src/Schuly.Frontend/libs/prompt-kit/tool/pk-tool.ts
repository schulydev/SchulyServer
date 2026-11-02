/**
 * pk-tool — collapsible visualization for an agent tool-call.
 *
 * Inputs:
 *   toolPart:     ToolPart (required) — { type, state, input?, output?, toolCallId?, errorText? }
 *   defaultOpen:  boolean — initial expanded state (default false)
 *   class:        string
 *
 * Mirrors React's prompt-kit Tool component.
 */
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronDown,
  lucideCircleCheck,
  lucideCircleX,
  lucideSettings,
} from '@ng-icons/lucide';
import {
  BrnCollapsible,
  BrnCollapsibleContent,
  BrnCollapsibleTrigger,
} from '@spartan-ng/brain/collapsible';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { cn } from '../utils/cn';

export type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

export interface ToolPart {
  type: string;
  state: ToolState;
  input?: Record<string, unknown>;
  /** A structured result, or plain text such as a command's output. */
  output?: Record<string, unknown> | string;
  /** Process exit code of a command; shown under the output (destructive colour when not 0). */
  exitCode?: number | null;
  toolCallId?: string;
  errorText?: string;
}

interface BadgeStyle {
  label: string;
  classes: string;
}

const BADGE: Record<ToolState, BadgeStyle> = {
  'input-streaming': {
    label: 'Processing',
    classes: 'bg-muted text-muted-foreground',
  },
  'input-available': {
    label: 'Ready',
    classes: 'bg-muted text-muted-foreground',
  },
  'output-available': {
    label: 'Completed',
    classes: 'bg-primary/10 text-primary',
  },
  'output-error': {
    label: 'Error',
    classes: 'bg-destructive/10 text-destructive',
  },
};

@Component({
  selector: 'pk-tool',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BrnCollapsible,
    BrnCollapsibleTrigger,
    BrnCollapsibleContent,
    HlmBadge,
    HlmSpinner,
    NgIcon,
  ],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideCircleCheck,
      lucideCircleX,
      lucideSettings,
    }),
  ],
  template: `
    <div [class]="containerClass()">
      <div brnCollapsible [(expanded)]="isOpen">
        <button
          brnCollapsibleTrigger
          class="bg-background hover:bg-muted/50 group flex h-auto w-full items-center justify-between rounded-b-none px-3 py-2 font-normal transition-colors"
        >
          <div class="flex items-center gap-2">
            @if (toolPart().state === 'input-streaming') {
              <hlm-spinner class="text-primary" aria-label="Processing" />
            } @else {
              <ng-icon
                [name]="iconName()"
                [class]="iconColor()"
                class="text-[length:--spacing(4)]"
              />
            }
            <span class="font-mono text-sm font-medium">{{ toolPart().type }}</span>
            <span hlmBadge [class]="badgeClass()">{{ badgeLabel() }}</span>
          </div>
          <ng-icon
            name="lucideChevronDown"
            class="text-[length:--spacing(3)] transition-transform group-data-[state=open]:rotate-180"
          />
        </button>

        <div
          brnCollapsibleContent
          class="block overflow-hidden transition-[height] duration-150 ease-out data-[state=closed]:h-0 data-[state=open]:h-(--brn-collapsible-content-height)"
        >
          <div class="bg-background border-border space-y-3 border-t p-3">
            @if (hasInput()) {
              <div>
                <h4 class="text-muted-foreground mb-2 text-sm font-medium">Input</h4>
                <div class="bg-background rounded border p-2 font-mono text-sm">
                  @for (entry of inputEntries(); track entry.key) {
                    <div class="mb-1">
                      <span class="text-muted-foreground">{{ entry.key }}:</span>
                      <span class="break-all whitespace-pre-wrap"> {{ entry.value }}</span>
                    </div>
                  }
                </div>
              </div>
            }

            @if (toolPart().output; as out) {
              <div>
                <h4 class="text-muted-foreground mb-2 text-sm font-medium">Output</h4>
                <div
                  class="bg-background max-h-60 overflow-auto rounded border p-2 font-mono text-sm"
                >
                  <pre class="break-all whitespace-pre-wrap" tabindex="0" role="region" aria-label="Output">{{ formatValue(out) }}</pre>
                </div>
              </div>
            }

            @if (toolPart().exitCode !== undefined && toolPart().exitCode !== null) {
              <p
                class="text-xs"
                [class]="toolPart().exitCode === 0 ? 'text-muted-foreground' : 'text-destructive font-medium'"
              >
                exit code {{ toolPart().exitCode }}
              </p>
            }

            @if (toolPart().state === 'output-error' && toolPart().errorText) {
              <div>
                <h4 class="text-destructive mb-2 text-sm font-medium">Error</h4>
                <div
                  class="bg-destructive/10 border-destructive/30 rounded border p-2 text-sm"
                >
                  {{ toolPart().errorText }}
                </div>
              </div>
            }

            @if (toolPart().state === 'input-streaming') {
              <div class="text-muted-foreground text-sm">Processing tool call...</div>
            }

            @if (toolPart().toolCallId; as id) {
              <div class="text-muted-foreground border-border border-t pt-2 text-xs">
                <span class="font-mono">Call ID: {{ id }}</span>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PkTool {
  public readonly toolPart = input.required<ToolPart>();
  public readonly defaultOpen = input<boolean>(false);
  public readonly class = input<string>('');

  protected readonly isOpen = linkedSignal(() => this.defaultOpen());

  protected readonly containerClass = computed(() =>
    cn('border-border mt-3 overflow-hidden rounded-lg border', this.class()),
  );

  protected readonly iconName = computed(() => {
    switch (this.toolPart().state) {
      case 'input-available':
        return 'lucideSettings';
      case 'output-available':
        return 'lucideCircleCheck';
      case 'output-error':
        return 'lucideCircleX';
      default:
        return 'lucideSettings';
    }
  });

  protected readonly iconColor = computed(() => {
    switch (this.toolPart().state) {
      case 'input-available':
        return 'text-muted-foreground';
      case 'output-available':
        return 'text-primary';
      case 'output-error':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  });

  protected readonly badgeLabel = computed(() => BADGE[this.toolPart().state].label);
  protected readonly badgeClass = computed(() => BADGE[this.toolPart().state].classes);

  protected readonly hasInput = computed(() => {
    const i = this.toolPart().input;
    return !!i && Object.keys(i).length > 0;
  });
  protected readonly inputEntries = computed(() => {
    const i = this.toolPart().input ?? {};
    return Object.entries(i).map(([key, value]) => ({ key, value: this.formatValue(value) }));
  });

  protected formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  }
}
