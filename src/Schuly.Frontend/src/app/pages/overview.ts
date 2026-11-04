import { DecimalPipe } from '@angular/common';
import { SyncingNotice } from '../shared/syncing-notice';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideCalendarDays,
  lucideChartColumn,
  lucideTrendingDown,
  lucideTrendingUp,
} from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { dateOnly } from '../core/calendar';
import { AgendaTypeBadge } from '../shared/agenda-type-badge';
import { EmptyState } from '../shared/empty-state';
import { GradeBadge } from '../shared/grade-badge';
import { AbsencesStore } from '../stores/absences.store';
import { AgendaStore } from '../stores/agenda.store';
import { GradesStore } from '../stores/grades.store';
import { UserStore } from '../stores/user.store';
import { AppDatePipe } from '../core/date-format';

@Component({
  selector: 'app-overview',
  imports: [SyncingNotice, 
    HlmCardImports,
    HlmBadge,
    HlmButton,
    HlmTableImports,
    HlmProgressImports,
    HlmSkeletonImports,
    NgIcon,
    RouterLink,
    AppDatePipe,
    DecimalPipe,
    GradeBadge,
    AgendaTypeBadge,
    EmptyState,
  ],
  providers: [
    provideIcons({
      lucideTrendingUp,
      lucideTrendingDown,
      lucideArrowRight,
      lucideChartColumn,
      lucideCalendarDays,
    }),
  ],
  template: `
    <div class="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div class="px-4 lg:px-6 empty:hidden"><app-syncing-notice /></div>
      <div class="px-4 lg:px-6">
        <h2 class="text-2xl font-semibold tracking-tight">Hi {{ firstName() }}</h2>
        <p class="text-muted-foreground text-sm">Here is what is going on at school.</p>
      </div>

      <div
        class="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4"
      >
        <div class="@container/card" hlmCard>
          <div hlmCardHeader>
            <p hlmCardDescription>Average grade</p>
            <h3 hlmCardTitle class="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              @if (grades.overallAverage(); as average) {
                {{ average | number: '1.2-2' }}
              } @else {
                -
              }
            </h3>
            <div hlmCardAction>
              <span hlmBadge variant="outline">
                <ng-icon
                  [name]="grades.insufficientCount() ? 'lucideTrendingDown' : 'lucideTrendingUp'"
                />
                {{ grades.subjectAverages().length }} subjects
              </span>
            </div>
          </div>
          <div hlmCardFooter class="flex-col items-start gap-1.5 text-sm">
            <div class="line-clamp-1 flex gap-2 font-medium">
              @if (grades.insufficientCount(); as count) {
                {{ count }} {{ count === 1 ? 'subject' : 'subjects' }} below 4
              } @else {
                All subjects at 4 or above
              }
            </div>
            <div class="text-muted-foreground">Weighted average across all subjects</div>
          </div>
        </div>

        <div class="@container/card" hlmCard>
          <div hlmCardHeader>
            <p hlmCardDescription>Upcoming tests</p>
            <h3 hlmCardTitle class="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {{ upcoming().length }}
            </h3>
            <div hlmCardAction>
              <span hlmBadge variant="outline">{{ examsThisWeek() }} this week</span>
            </div>
          </div>
          <div hlmCardFooter class="flex-col items-start gap-1.5 text-sm">
            <div class="line-clamp-1 flex gap-2 font-medium">
              @if (upcoming()[0]; as next) {
                Next: {{ next.name }}
              } @else {
                Nothing scheduled
              }
            </div>
            <div class="text-muted-foreground">
              @if (upcoming()[0]?.date; as date) {
                {{ date | appDate: 'weekdayDayMonthLong' }}
              } @else {
                Enjoy the quiet
              }
            </div>
          </div>
        </div>

        <div class="@container/card" hlmCard>
          <div hlmCardHeader>
            <p hlmCardDescription>Today</p>
            <h3 hlmCardTitle class="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {{ agenda.today().length }}
            </h3>
            <div hlmCardAction>
              <span hlmBadge variant="outline">
                <ng-icon name="lucideCalendarDays" />
                {{ agenda.upcoming().length }} ahead
              </span>
            </div>
          </div>
          <div hlmCardFooter class="flex-col items-start gap-1.5 text-sm">
            <div class="line-clamp-1 flex gap-2 font-medium">
              @if (agenda.today()[0]; as first) {
                {{ first.title }}
              } @else {
                Free day
              }
            </div>
            <div class="text-muted-foreground">Lessons and events in your agenda</div>
          </div>
        </div>

        <div class="@container/card" hlmCard>
          <div hlmCardHeader>
            <p hlmCardDescription>Absences</p>
            <h3 hlmCardTitle class="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {{ absences.absenceCount() }}
            </h3>
            <div hlmCardAction>
              <span hlmBadge variant="outline">{{ absences.delayCount() }} delays</span>
            </div>
          </div>
          <div hlmCardFooter class="flex-col items-start gap-1.5 text-sm">
            <div class="line-clamp-1 flex gap-2 font-medium">
              {{ absences.daysMissed() }} days missed
            </div>
            <div class="text-muted-foreground">Recorded by your school</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 px-4 lg:px-6 @5xl/main:grid-cols-7">
        <section hlmCard class="@5xl/main:col-span-4">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Recent grades</h3>
            <p hlmCardDescription>Your latest results</p>
            <div hlmCardAction>
              <a hlmBtn variant="ghost" size="sm" routerLink="/grades">
                View all
                <ng-icon name="lucideArrowRight" />
              </a>
            </div>
          </div>
          <div hlmCardContent>
            @if (grades.loading()) {
              <div class="flex flex-col gap-2">
                @for (i of [1, 2, 3, 4]; track i) {
                  <hlm-skeleton class="h-9 w-full" />
                }
              </div>
            } @else if (recentGrades().length) {
              <div hlmTableContainer>
                <table hlmTable>
                  <thead hlmTHead>
                    <tr hlmTr>
                      <th hlmTh>Exam</th>
                      <th hlmTh class="hidden sm:table-cell">Subject</th>
                      <th hlmTh class="hidden md:table-cell">Date</th>
                      <th hlmTh class="text-right">Grade</th>
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (grade of recentGrades(); track grade.id) {
                      <tr hlmTr>
                        <td hlmTd class="font-medium">{{ grade.exam }}</td>
                        <td hlmTd class="text-muted-foreground hidden sm:table-cell">
                          {{ grade.subject }}
                        </td>
                        <td hlmTd class="text-muted-foreground hidden md:table-cell">
                          {{ grade.date | appDate: 'date' }}
                        </td>
                        <td hlmTd class="text-right"><app-grade-badge [score]="grade.score" /></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <app-empty-state
                icon="lucideChartColumn"
                title="No grades yet"
                description="Grades show up here once your school publishes them."
              />
            }
          </div>
        </section>

        <section hlmCard class="@5xl/main:col-span-3">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Coming up</h3>
            <p hlmCardDescription>Tests and events in your agenda</p>
            <div hlmCardAction>
              <a hlmBtn variant="ghost" size="sm" routerLink="/calendar">
                Calendar
                <ng-icon name="lucideArrowRight" />
              </a>
            </div>
          </div>
          <div hlmCardContent class="flex flex-col gap-4">
            @for (entry of comingUp(); track entry.id) {
              <div class="flex items-start gap-3">
                <div class="bg-muted flex w-12 shrink-0 flex-col items-center rounded-md py-1.5">
                  <span class="text-muted-foreground text-[10px] font-medium uppercase">{{
                    entry.start | appDate: 'month'
                  }}</span>
                  <span class="text-lg leading-none font-semibold tabular-nums">{{
                    entry.start | appDate: 'day'
                  }}</span>
                </div>
                <div class="grid flex-1 gap-0.5">
                  <span class="truncate text-sm font-medium">{{ entry.title }}</span>
                  <span class="text-muted-foreground truncate text-xs"
                    >@if (entry.end) {{{ entry.start | appDate: 'weekdayDayMonth' }} - {{ entry.end | appDate: 'weekdayDayMonth' }}} @else if (entry.allDay) {{{ entry.start | appDate: 'weekdayLong' }}, all day} @else {{{ entry.start | appDate: 'weekdayLongTime' }}}{{ entry.place ? ' - ' + entry.place : '' }}</span
                  >
                </div>
                <app-agenda-type-badge [type]="entry.entryType" />
              </div>
            } @empty {
              <app-empty-state
                icon="lucideCalendarDays"
                title="Nothing coming up"
                description="Your agenda is clear."
              />
            }
          </div>
        </section>
      </div>

      @if (grades.subjectAverages().length) {
        <div class="px-4 lg:px-6">
          <section hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle>Subjects</h3>
              <p hlmCardDescription>Weighted average per subject on the Swiss 1 to 6 scale</p>
            </div>
            <div hlmCardContent class="grid gap-x-8 gap-y-4 @3xl/main:grid-cols-2">
              @for (subject of grades.subjectAverages(); track subject.subject) {
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-medium">{{ subject.subject }}</span>
                    <span class="tabular-nums" [class.text-destructive]="subject.average < 4">{{
                      subject.average | number: '1.2-2'
                    }}</span>
                  </div>
                  <hlm-progress
                    [value]="gradeBar(subject.average)"
                    [attr.aria-label]="subject.subject + ' average'"
                  >
                    <hlm-progress-indicator />
                  </hlm-progress>
                </div>
              }
            </div>
          </section>
        </div>
      }
    </div>
  `,
})
export class Overview {
  /** Grades run from 1 to 6, but a school can report an average of 0, and a progress bar throws outside 0 to 100. */
  protected gradeBar(average: number): number {
    return Math.min(100, Math.max(0, ((average - 1) / 5) * 100));
  }

  protected readonly grades = inject(GradesStore);
  protected readonly agenda = inject(AgendaStore);
  protected readonly absences = inject(AbsencesStore);
  private readonly user = inject(UserStore);

  protected readonly firstName = computed(() => this.user.name().split(' ')[0]);
  protected readonly recentGrades = computed(() => this.grades.grades().filter((g) => g.score > 0).slice(0, 6));
  /** All-day entries arrive as midnight UTC (the calendar's rule), so they show a date or a range instead of 01:00. */
  protected readonly comingUp = computed(() =>
    this.agenda
      .upcoming()
      .filter((entry) => entry.entryType !== 'Lesson')
      .slice(0, 5)
      .map((entry) => {
        const startDay = dateOnly(entry.date);
        const endDay = entry.endDate ? dateOnly(entry.endDate) : startDay;
        const allDay = startDay !== null && endDay !== null;
        const start = allDay ? startDay : new Date(entry.date);
        const end = allDay && endDay.getTime() !== startDay.getTime() ? endDay : null;
        return { ...entry, start, end, allDay };
      }),
  );
  protected readonly upcoming = computed(() =>
    [
      ...this.grades.upcomingExams().map((exam) => ({ name: exam.name, date: exam.date })),
      ...this.agenda
        .upcoming()
        .filter((entry) => entry.entryType === 'Test')
        .map((entry) => ({ name: entry.title, date: entry.date })),
    ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
  );
  protected readonly examsThisWeek = computed(() => {
    const weekAhead = Date.now() + 7 * 24 * 3_600_000;
    return this.upcoming().filter((exam) => exam.date && new Date(exam.date).getTime() <= weekAhead)
      .length;
  });
}
