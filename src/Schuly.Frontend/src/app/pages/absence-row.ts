import { Component, computed, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideExternalLink, lucideUndo2 } from '@ng-icons/lucide';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { AbsenceRow, shortDay } from '../core/absence-view';
import { StepState } from '../core/absence-steps';
import { ReportedAbsence } from '../stores/absence-reports.store';

const STATUS_TONES: Record<string, { text: string; dot: string }> = {
  excused: { text: 'text-muted-foreground', dot: 'bg-green-500' },
  'needs-excuse': { text: 'text-destructive', dot: 'bg-destructive' },
  unexcused: { text: 'text-destructive', dot: 'bg-destructive' },
  rejected: { text: 'text-destructive', dot: 'bg-destructive' },
  waiting: { text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  upcoming: { text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};

const STEP_TONES: Record<StepState, { text: string; dot: string }> = {
  done: { text: 'text-foreground', dot: 'bg-green-500 border-green-500' },
  next: { text: 'font-medium text-amber-700 dark:text-amber-300', dot: 'border-amber-500' },
  rejected: { text: 'font-medium text-destructive', dot: 'bg-destructive border-destructive' },
  todo: { text: 'text-muted-foreground', dot: 'border-muted-foreground' },
};

/** One absence: date, reason with its note, one status. Steps and actions wait behind the chevron. */
@Component({
  selector: 'app-absence-row',
  imports: [NgIcon, HlmAlertDialogImports, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideChevronDown, lucideExternalLink, lucideUndo2 })],
  template: `
    <div
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 rounded-lg px-1.5 py-3 sm:grid-cols-[9.25rem_minmax(0,1fr)_auto]"
      [class.cursor-pointer]="canOpen()"
      [class.hover:bg-muted]="canOpen()"
      (click)="toggle()"
    >
      <div class="tabular-nums">
        <div class="text-sm font-medium">{{ range() }}</div>
        @if (detail(); as text) {
          <div class="text-muted-foreground text-[13px]">{{ text }}</div>
        }
      </div>
      <div class="col-span-2 row-start-2 min-w-0 text-sm [overflow-wrap:anywhere] sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <div>
          {{ row().reason }}
          @if (row().isDelay) {
            <span class="text-muted-foreground text-[13px]">· Delay</span>
          }
        </div>
        @if (row().note; as note) {
          <div class="text-muted-foreground text-[13px]">{{ note }}</div>
        }
      </div>
      <div class="flex items-center justify-end gap-2.5">
        @if (row().status) {
          <span class="inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap" [class]="tone().text">
            <span class="size-[7px] shrink-0 rounded-full" [class]="tone().dot" aria-hidden="true"></span>
            {{ row().status }}
          </span>
        }
        @if (canOpen()) {
          <button type="button" class="text-muted-foreground focus-visible:outline-ring block rounded focus-visible:outline-2" [attr.aria-expanded]="open()" [attr.aria-label]="'Details for ' + range()" (click)="toggle(); $event.stopPropagation()">
            <ng-icon name="lucideChevronDown" class="block text-base transition-transform motion-reduce:transition-none" [class.rotate-180]="open()" aria-hidden="true" />
          </button>
        } @else {
          <span class="block w-4" aria-hidden="true"></span>
        }
      </div>
    </div>
    @if (open()) {
      <div class="flex flex-col gap-2.5 px-1.5 pb-3.5 sm:pr-9 sm:pl-[10.625rem]">
        @if (row().steps.length) {
          <ol class="flex flex-wrap gap-x-3.5 gap-y-1 text-xs" aria-label="Progress">
            @for (step of row().steps; track step.label) {
              <li class="inline-flex items-center gap-1.5" [class]="stepTones[step.state].text">
                <span class="box-border size-[7px] rounded-full border-[1.5px]" [class]="stepTones[step.state].dot" aria-hidden="true"></span>
                {{ step.label }}
              </li>
            }
          </ol>
        }
        @if (row().trainerComment; as comment) {
          <p class="text-muted-foreground text-[13px] [overflow-wrap:anywhere]">Lehrmeister: {{ comment }}</p>
        }
        @if (row().printUrl || row().report) {
          <div class="flex flex-wrap gap-2">
            @if (row().printUrl; as url) {
              <a hlmBtn variant="outline" size="sm" [href]="url" target="_blank" rel="noopener noreferrer">
                <ng-icon name="lucideExternalLink" aria-hidden="true" />
                Print the form in Schulnetz
                <span class="sr-only">(opens in a new tab)</span>
              </a>
            }
            @if (row().report; as report) {
              <hlm-alert-dialog>
                <button hlmAlertDialogTrigger hlmBtn variant="outline" size="sm" [disabled]="busy()" [attr.aria-busy]="withdrawing()">
                  @if (withdrawing()) {
                    <hlm-spinner aria-hidden="true" />
                  } @else {
                    <ng-icon name="lucideUndo2" aria-hidden="true" />
                  }
                  Withdraw
                  <span class="sr-only">report for {{ range() }}</span>
                </button>
                <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                  <hlm-alert-dialog-header>
                    <h2 hlmAlertDialogTitle>Withdraw this report?</h2>
                    <p hlmAlertDialogDescription>
                      Your school will no longer see this absence report. You can report it again
                      if you still need to.
                    </p>
                  </hlm-alert-dialog-header>
                  <hlm-alert-dialog-footer>
                    <button hlmAlertDialogCancel>Keep report</button>
                    <button hlmAlertDialogAction variant="destructive" (click)="withdraw.emit(report)">Withdraw</button>
                  </hlm-alert-dialog-footer>
                </hlm-alert-dialog-content>
              </hlm-alert-dialog>
            }
          </div>
        }
      </div>
    }
  `,
  host: { class: 'block' },
})
export class AbsenceRowItem {
  readonly row = input.required<AbsenceRow<ReportedAbsence>>();
  readonly busy = input(false);
  readonly withdrawing = input(false);
  readonly withdraw = output<ReportedAbsence>();

  protected readonly stepTones = STEP_TONES;
  protected readonly open = signal(false);
  protected readonly canOpen = computed(() => {
    const row = this.row();
    return row.steps.length > 0 || !!row.trainerComment || !!row.printUrl || !!row.report;
  });
  protected readonly range = computed(() => {
    const { from, until } = this.row();
    return from === until ? shortDay(from) : `${shortDay(from)} – ${shortDay(until)}`;
  });
  protected readonly detail = computed(() => {
    const row = this.row();
    if (row.time) return row.time;
    const days = Math.round((Date.parse(row.until) - Date.parse(row.from)) / 86_400_000) + 1;
    return days > 1 ? `${days} days` : null;
  });
  protected readonly tone = computed(() => STATUS_TONES[this.row().state] ?? { text: '', dot: '' });

  protected toggle(): void {
    if (this.canOpen()) this.open.update((open) => !open);
  }
}
