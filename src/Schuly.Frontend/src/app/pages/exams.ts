import { SyncingNotice } from '../shared/syncing-notice';
import { Component, inject, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClipboardList } from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { EmptyState } from '../shared/empty-state';
import { GradeBadge } from '../shared/grade-badge';
import { ExamRow, GradesStore } from '../stores/grades.store';
import { AppDatePipe } from '../core/date-format';

@Component({
  selector: 'app-exam-table',
  imports: [HlmTableImports, HlmBadge, HlmSkeletonImports, AppDatePipe, GradeBadge, EmptyState],
  template: `
    @if (loading()) {
      <div class="flex flex-col gap-2">
        @for (i of [1, 2, 3, 4]; track i) {
          <hlm-skeleton class="h-10 w-full" />
        }
      </div>
    } @else if (exams().length) {
      <div class="overflow-hidden rounded-lg border">
        <div hlmTableContainer>
          <table hlmTable>
            <thead hlmTHead class="bg-muted">
              <tr hlmTr>
                <th hlmTh>Exam</th>
                <th hlmTh class="hidden sm:table-cell">Subject</th>
                <th hlmTh>Date</th>
                <th hlmTh class="hidden md:table-cell">Type</th>
                <th hlmTh class="text-right">Grade</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (exam of exams(); track exam.id) {
                <tr hlmTr>
                  <td hlmTd>
                    <div class="font-medium">{{ exam.name }}</div>
                    <div class="text-muted-foreground text-xs sm:hidden">{{ exam.subject }}</div>
                    @if (exam.description) {
                      <div class="text-muted-foreground max-w-md truncate text-xs">
                        {{ exam.description }}
                      </div>
                    }
                  </td>
                  <td hlmTd class="text-muted-foreground hidden sm:table-cell">
                    {{ exam.subject }}
                  </td>
                  <td hlmTd class="text-muted-foreground tabular-nums">
                    @if (exam.date) {
                      <span class="sm:hidden">{{ exam.date | appDate: 'dayMonth' }}</span>
                      <span class="hidden sm:inline">{{ exam.date | appDate: 'weekdayDate' }}</span>
                    } @else {
                      -
                    }
                  </td>
                  <td hlmTd class="hidden md:table-cell">
                    <span hlmBadge [variant]="exam.finalExam ? 'default' : 'outline'">{{
                      exam.finalExam ? 'Final exam' : 'Exam'
                    }}</span>
                  </td>
                  <td hlmTd class="text-right">
                    @if (exam.score != null) {
                      <app-grade-badge [score]="exam.score" />
                    } @else {
                      <span class="text-muted-foreground">-</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    } @else {
      <app-empty-state
        icon="lucideClipboardList"
        [title]="emptyTitle()"
        description="Exams from your school appear here."
      />
    }
  `,
})
export class ExamTable {
  readonly exams = input.required<ExamRow[]>();
  readonly loading = input(false);
  readonly emptyTitle = input('No exams');
}

@Component({
  selector: 'app-exams',
  imports: [SyncingNotice, HlmTabsImports, HlmBadge, ExamTable],
  providers: [provideIcons({ lucideClipboardList })],
  template: `
    <div class="flex flex-col gap-4 p-4 lg:p-6">
      <app-syncing-notice />
      <hlm-tabs tab="upcoming" class="w-full">
        <hlm-tabs-list
          aria-label="Exams"
          class="**:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:px-1"
        >
          <button hlmTabsTrigger="upcoming">
            Upcoming
            <span hlmBadge variant="secondary">{{ grades.upcomingExams().length }}</span>
          </button>
          <button hlmTabsTrigger="past">
            Past
            <span hlmBadge variant="secondary">{{ grades.pastExams().length }}</span>
          </button>
        </hlm-tabs-list>
        <div hlmTabsContent="upcoming" class="mt-2">
          <app-exam-table
            [exams]="grades.upcomingExams()"
            [loading]="grades.loading()"
            emptyTitle="No upcoming exams"
          />
        </div>
        <div hlmTabsContent="past" class="mt-2">
          <app-exam-table
            [exams]="grades.pastExams()"
            [loading]="grades.loading()"
            emptyTitle="No past exams"
          />
        </div>
      </hlm-tabs>
    </div>
  `,
})
export class Exams {
  protected readonly grades = inject(GradesStore);
}
