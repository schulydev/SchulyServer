import { Component, computed, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideCircleAlert, lucideLoader2, lucideTerminal } from '@ng-icons/lucide';
import { ToolActivity } from '../../core/helply-types';

/** A sandbox command Helply ran: a chip that expands to the command, its output and the exit code. */
@Component({
  selector: 'app-code-chip',
  imports: [NgIcon],
  providers: [provideIcons({ lucideChevronDown, lucideCircleAlert, lucideLoader2, lucideTerminal })],
  host: { class: 'block max-w-full' },
  template: `
    <button
      type="button"
      class="bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-3"
      [class.text-destructive]="tool().status === 'failed'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      (click)="open.set(!open())"
    >
      <ng-icon [name]="running() ? 'lucideLoader2' : 'lucideTerminal'" aria-hidden="true" [class.motion-safe:animate-spin]="running()" />
      <span>{{ tool().label }}</span>
      @if (failed()) {
        <ng-icon name="lucideCircleAlert" aria-hidden="true" />
        <span class="sr-only">Failed</span>
      }
      <ng-icon name="lucideChevronDown" aria-hidden="true" class="transition-transform" [class.rotate-180]="open()" />
    </button>
    @if (open()) {
      <div [id]="panelId" class="mt-1.5 flex max-w-full flex-col gap-2 text-xs">
        <div>
          <p class="text-muted-foreground mb-1 font-medium">Command</p>
          <pre
            tabindex="0"
            role="region"
            class="bg-muted focus-visible:ring-ring/50 max-h-48 overflow-auto rounded-lg border p-2.5 font-mono whitespace-pre-wrap break-all outline-none focus-visible:ring-3"
            aria-label="Command"
          >{{ tool().code?.command }}</pre>
        </div>
        @if (output() !== null) {
          <div>
            <p class="text-muted-foreground mb-1 font-medium">Output</p>
            <pre
              tabindex="0"
              role="region"
              class="bg-muted focus-visible:ring-ring/50 max-h-64 overflow-auto rounded-lg border p-2.5 font-mono whitespace-pre-wrap break-all outline-none focus-visible:ring-3"
              aria-label="Output"
            >{{ output() }}</pre>
          </div>
        }
        @if (exitCode() !== null) {
          <p [class]="exitCode() === 0 ? 'text-muted-foreground' : 'text-destructive font-medium'">exit code {{ exitCode() }}</p>
        }
      </div>
    }
  `,
})
export class CodeChip {
  private static next = 0;
  protected readonly panelId = `helply-code-${CodeChip.next++}`;

  readonly tool = input.required<ToolActivity>();
  protected readonly open = signal(false);
  protected readonly running = computed(() => this.tool().status === 'running');
  protected readonly failed = computed(() => this.tool().status === 'failed');
  protected readonly output = computed(() => this.tool().code?.output ?? null);
  protected readonly exitCode = computed(() => this.tool().code?.exitCode ?? null);
}
