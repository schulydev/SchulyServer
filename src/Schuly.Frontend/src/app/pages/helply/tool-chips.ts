import { Component, computed, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBan, lucideChevronDown, lucideCircleAlert, lucideCircleCheck, lucideLoader2, lucideWrench } from '@ng-icons/lucide';
import { ToolActivity, ToolStatus } from '../../core/helply-types';

const ICONS: Record<ToolStatus, string> = {
  running: 'lucideLoader2',
  done: 'lucideCircleCheck',
  failed: 'lucideCircleAlert',
  denied: 'lucideBan',
};

const STATUS_TEXT: Record<ToolStatus, string> = {
  running: 'In progress',
  done: 'Done',
  failed: 'Failed',
  denied: 'Not allowed',
};

/** What Helply looked up for a message. Several finished tools collapse into one disclosure. */
@Component({
  selector: 'app-tool-chips',
  imports: [NgIcon],
  providers: [provideIcons({ lucideBan, lucideChevronDown, lucideCircleAlert, lucideCircleCheck, lucideLoader2, lucideWrench })],
  template: `
    @if (tools().length) {
      <div class="flex flex-col items-start gap-1.5">
        @if (collapsible()) {
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs outline-none focus-visible:ring-3"
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="listId"
            (click)="expanded.set(!expanded())"
          >
            <ng-icon name="lucideWrench" aria-hidden="true" />
            Used {{ tools().length }} tools
            <ng-icon
              name="lucideChevronDown"
              aria-hidden="true"
              class="transition-transform"
              [class.rotate-180]="open()"
            />
          </button>
        }
        @if (open()) {
          <ul [id]="listId" class="flex flex-wrap gap-1.5" aria-label="Tools Helply used">
            @for (tool of tools(); track tool.id) {
              <li
                class="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                [class.text-destructive]="tool.status === 'failed'"
              >
                <ng-icon
                  [name]="icon(tool.status)"
                  aria-hidden="true"
                  [class.motion-safe:animate-spin]="tool.status === 'running'"
                />
                <span>{{ tool.label }}</span>
                <span class="sr-only">{{ statusText(tool.status) }}</span>
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
})
export class ToolChips {
  private static next = 0;
  protected readonly listId = `helply-tools-${ToolChips.next++}`;

  readonly tools = input.required<ToolActivity[]>();

  protected readonly expanded = signal(false);
  protected readonly running = computed(() => this.tools().some((t) => t.status === 'running'));
  protected readonly collapsible = computed(() => this.tools().length > 2);
  protected readonly open = computed(() => !this.collapsible() || this.expanded() || this.running());

  protected icon(status: ToolStatus): string {
    return ICONS[status];
  }

  protected statusText(status: ToolStatus): string {
    return STATUS_TEXT[status];
  }
}
