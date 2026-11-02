import { DecimalPipe } from '@angular/common';
import { SyncingNotice } from '../shared/syncing-notice';
import { Component, inject } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideUserX } from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { EmptyState } from '../shared/empty-state';
import { AbsenceReportDialog } from './absence-report-dialog';
import { AbsenceReportsCard } from './absence-reports-card';
import { AbsenceReportsStore } from '../stores/absence-reports.store';
import { AbsenceFilter, AbsencesStore } from '../stores/absences.store';
import { AppDatePipe } from '../core/date-format';

@Component({
  selector: 'app-absences',
  imports: [SyncingNotice, 
    HlmCardImports,
    HlmTableImports,
    HlmBadge,
    HlmToggleGroupImports,
    HlmSkeletonImports,
    AppDatePipe,
    DecimalPipe,
    EmptyState,
    AbsenceReportDialog,
    AbsenceReportsCard,
  ],
  providers: [provideIcons({ lucideUserX }), AbsenceReportsStore],
  template: `
    <div class="flex flex-col gap-4 p-4 md:gap-6 lg:p-6">
      <app-syncing-notice />
      <div class="grid grid-cols-3 gap-2 sm:gap-4">
        <div hlmCard class="py-3 sm:py-4">
          <div hlmCardHeader class="px-3 sm:px-4">
            <p hlmCardDescription>Absences</p>
            <h3 hlmCardTitle class="text-xl tabular-nums sm:text-2xl">
              {{ absences.absenceCount() }}
            </h3>
          </div>
        </div>
        <div hlmCard class="py-3 sm:py-4">
          <div hlmCardHeader class="px-3 sm:px-4">
            <p hlmCardDescription>Delays</p>
            <h3 hlmCardTitle class="text-xl tabular-nums sm:text-2xl">
              {{ absences.delayCount() }}
            </h3>
          </div>
        </div>
        <div hlmCard class="py-3 sm:py-4">
          <div hlmCardHeader class="px-3 sm:px-4">
            <p hlmCardDescription>Hours missed</p>
            <h3 hlmCardTitle class="text-xl tabular-nums sm:text-2xl">
              {{ absences.hoursAbsent() | number: '1.0-1' }}
            </h3>
          </div>
        </div>
      </div>

      <app-absence-reports-card />

      <div class="flex flex-wrap items-center justify-between gap-2">
      <hlm-toggle-group
        type="single"
        variant="outline"
        size="sm"
        [nullable]="false"
        [value]="absences.filter()"
        (valueChange)="setFilter($event)"
        aria-label="Filter absences"
        class="self-start"
      >
        <button hlmToggleGroupItem value="all" class="px-3">All</button>
        <button hlmToggleGroupItem value="Absence" class="px-3">Absences</button>
        <button hlmToggleGroupItem value="Delay" class="px-3">Delays</button>
      </hlm-toggle-group>
      @if (reports.available()) {
        <app-absence-report-dialog />
      }
      </div>

      @if (absences.loading()) {
        <div class="flex flex-col gap-2">
          @for (i of [1, 2, 3, 4]; track i) {
            <hlm-skeleton class="h-10 w-full" />
          }
        </div>
      } @else if (absences.items().length) {
        <div class="overflow-hidden rounded-lg border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted">
                <tr hlmTr>
                  <th hlmTh>Date</th>
                  <th hlmTh class="hidden sm:table-cell">Time</th>
                  <th hlmTh>Type</th>
                  <th hlmTh>Reason</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (absence of absences.visible(); track absence.id) {
                  <tr hlmTr>
                    <td hlmTd class="font-medium tabular-nums">
                      <span class="sm:hidden">{{ absence.from | appDate: 'dayMonth' }}</span>
                      <span class="hidden sm:inline">{{
                        absence.from | appDate: 'weekdayDate'
                      }}</span>
                    </td>
                    <td hlmTd class="text-muted-foreground hidden tabular-nums sm:table-cell">
                      {{ absence.from | appDate: 'time' }} - {{ absence.until | appDate: 'time' }}
                    </td>
                    <td hlmTd>
                      <span
                        hlmBadge
                        [variant]="absence.type === 'Delay' ? 'secondary' : 'outline'"
                        >{{ absence.type === 'Delay' ? 'Delay' : 'Absence' }}</span
                      >
                      @if (absence.isExcused === true) {
                        <span hlmBadge variant="outline" class="ml-1">Excused</span>
                      } @else if (absence.isExcused === false) {
                        <span hlmBadge variant="destructive" class="ml-1">Unexcused</span>
                      }
                    </td>
                    <td hlmTd class="text-muted-foreground max-w-28 truncate sm:max-w-xs">
                      {{ absence.reason || '-' }}
                    </td>
                  </tr>
                } @empty {
                  <tr hlmTr>
                    <td hlmTd colspan="4" class="text-muted-foreground h-24 text-center">
                      No results.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <app-empty-state
          icon="lucideUserX"
          title="No absences"
          description="Absences and delays recorded by your school show up here."
        />
      }
    </div>
  `,
})
export class Absences {
  protected readonly absences = inject(AbsencesStore);
  protected readonly reports = inject(AbsenceReportsStore);

  protected setFilter(value: unknown): void {
    if (typeof value === 'string') this.absences.setFilter(value as AbsenceFilter);
  }
}
