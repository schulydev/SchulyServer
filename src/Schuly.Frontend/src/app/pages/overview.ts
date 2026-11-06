import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, DestroyRef, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCoffee, lucideUtensils } from '@ng-icons/lucide';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { AgendaEntryDto } from '../api';
import { buildAbsenceRows, todayInSwitzerland } from '../core/absence-view';
import { dateOnly } from '../core/calendar';
import { AppDatePipe, formatWhen } from '../core/date-format';
import { buildGradeGroups, cleanExamName, gradeHeadline, groupClassNames, isBbbWebsite, isGraded, oneDecimal, semesterOfDate, subjectsBelowFour } from '../core/grade-report';
import { attentionItems, needsReportLookup } from '../core/overview-attention';
import { buildTimeline, currentLesson, durationText, greeting, minutesLeft, nextLesson, relativeDay, remainingPercent } from '../core/today-timeline';
import { SyncingNotice } from '../shared/syncing-notice';
import { AbsencesStore } from '../stores/absences.store';
import { AgendaStore } from '../stores/agenda.store';
import { GradesStore } from '../stores/grades.store';
import { ReportedAbsencesCache } from '../stores/reported-absences-cache';
import { MySchoolsStore, SemesterReportsStore } from '../stores/semester-reports.store';
import { UserStore } from '../stores/user.store';
import { gradeTone } from './grades-tone';

/** How often the running lesson's countdown moves on. */
const TICK_MS = 15_000;
const COMING_UP = 5;
const NEW_GRADES = 3;

const hhmm = (date: Date): string => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

@Component({
  selector: 'app-overview',
  imports: [SyncingNotice, HlmSkeletonImports, NgIcon, RouterLink, AppDatePipe, TranslatePipe],
  providers: [provideIcons({ lucideCoffee, lucideUtensils })],
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
      <div class="empty:hidden"><app-syncing-notice /></div>
      <header>
        <h2 class="text-2xl font-semibold tracking-tight text-balance">{{ hello() }}</h2>
        <p class="text-muted-foreground mt-1 text-sm">{{ subline() }}</p>
      </header>

      <div class="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div class="flex min-w-0 flex-col gap-8 max-lg:contents">
          <section aria-labelledby="today-title" class="max-lg:order-1">
            <div class="mb-2.5 flex items-baseline justify-between gap-3">
              <h3 id="today-title" class="text-[15px] font-semibold">{{ 'common.today' | translate }}</h3>
              <a routerLink="/calendar" class="text-muted-foreground hover:text-foreground text-sm">{{ 'overview.timetable' | translate }}</a>
            </div>
            @if (agenda.loading() && !agenda.items().length) {
              <div class="flex flex-col gap-2">@for (i of [1, 2, 3]; track i) {<div hlmSkeleton class="h-12 w-full"></div>}</div>
            } @else if (timeline().length) {
              <ol class="flex flex-col">
                @for (slot of timeline(); track slot.key) {
                  <li class="relative grid grid-cols-[52px_14px_minmax(0,1fr)] gap-2.5" [class.opacity-55]="slot.state === 'done'">
                    <span class="text-muted-foreground text-right text-[13px] tabular-nums" [class]="slot.kind === 'lesson' ? 'pt-2.5' : 'pt-1'">{{ time(slot.start) }}</span>
                    <span class="relative self-stretch" aria-hidden="true">
                      <span class="bg-border absolute inset-y-0 left-1.5 w-0.5" [class.top-3.5]="$first" [class.bottom-auto]="$last" [class.h-3.5]="$last && !$first"></span>
                      @if (slot.kind === 'lesson') {
                        <span class="absolute top-3 left-0.5 size-2.5 rounded-full border-2"
                          [class]="slot.state === 'now' ? 'border-primary bg-primary ring-primary/25 ring-4' : slot.state === 'done' ? 'border-border bg-border' : 'border-border bg-background'"></span>
                      } @else {
                        <span class="absolute top-2.5 left-1 size-1.5 rotate-45 rounded-[2px]" [class]="slot.state === 'now' ? 'bg-primary' : 'bg-muted-foreground'"></span>
                      }
                    </span>
                    @if (slot.kind === 'lesson') {
                      <div class="mb-1.5 rounded-lg px-3 py-2" [class.bg-muted]="slot.state === 'now'">
                        <p class="flex flex-wrap items-center gap-1.5 font-medium">
                          {{ slot.title }}
                          @if (slot.test) {<span class="rounded-md bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{{ 'overview.test' | translate }}</span>}
                        </p>
                        <p class="text-muted-foreground text-[13px]">{{ time(slot.start) }} – {{ time(slot.end) }}@if (slot.room) { · {{ slot.room }}}@if (slot.test) { · {{ slot.test }}}</p>
                        @if (slot.state === 'now') {
                          <p class="text-muted-foreground mt-1 flex items-center gap-1.5 text-[13px]">
                            <span class="size-3 shrink-0 -scale-x-100 rounded-full" role="progressbar" [attr.aria-label]="'overview.timeLeft' | translate" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pie(slot.start, slot.end)"
                              [style.background]="'conic-gradient(var(--primary) ' + pie(slot.start, slot.end) + '%, color-mix(in oklab, var(--muted-foreground) 30%, transparent) 0)'"></span>
                            <span><b class="text-foreground font-semibold tabular-nums">{{ left(slot.end) }}</b> {{ 'overview.left' | translate: { end: time(slot.end) } }}</span>
                          </p>
                        }
                      </div>
                    } @else {
                      <p class="text-muted-foreground mb-1.5 flex items-center gap-1.5 px-3 py-1 text-[13px]" [class.text-foreground]="slot.state === 'now'">
                        <ng-icon [name]="slot.lunch ? 'lucideUtensils' : 'lucideCoffee'" class="shrink-0 text-sm" aria-hidden="true" />
                        {{ (slot.lunch ? 'overview.lunchBreak' : 'overview.bigBreak') | translate }} · {{ time(slot.start) }} – {{ time(slot.end) }}
                      </p>
                    }
                  </li>
                }
              </ol>
            } @else {
              <p class="text-muted-foreground py-2 text-sm">{{ (agenda.items().some(isLesson) ? 'overview.noLessons' : 'overview.noTimetable') | translate }}</p>
            }
          </section>

          <section aria-labelledby="grades-title" class="max-lg:order-4">
            <div class="mb-2.5 flex items-baseline justify-between gap-3">
              <h3 id="grades-title" class="text-[15px] font-semibold">{{ 'overview.newGrades' | translate }}</h3>
              <a routerLink="/grades" class="text-muted-foreground hover:text-foreground text-sm">
                @if (standing(); as s) {<b class="text-foreground font-semibold">{{ s.value }}</b>@if (s.state) { · <span [class]="s.tone === 'bad' ? 'text-destructive font-medium' : 'font-medium text-green-700 dark:text-green-400'">{{ s.state }}</span>} · }{{ 'overview.allGrades' | translate }}
              </a>
            </div>
            @if (newGrades().length) {
              <ul class="flex flex-col divide-y">
                @for (grade of newGrades(); track grade.id) {
                  <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                    <div class="min-w-0">
                      <p class="font-medium break-words">{{ grade.exam }}</p>
                      <p class="text-muted-foreground text-[13px]">{{ grade.subject }}@if (grade.when) { · {{ grade.when }}}</p>
                    </div>
                    <span class="min-w-11 rounded-lg px-2 py-0.5 text-center text-[13px] font-semibold tabular-nums" [class]="toneClass(grade.score)">{{ grade.score.toFixed(1) }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-muted-foreground py-2 text-sm">{{ 'overview.noGrades' | translate }}</p>
            }
          </section>
        </div>

        <div class="flex min-w-0 flex-col gap-8 max-lg:contents">
          <section aria-labelledby="todo-title" class="max-lg:order-2">
            <h3 id="todo-title" class="mb-2.5 text-[15px] font-semibold">{{ 'overview.attention.title' | translate }}</h3>
            @if (attention().length) {
              <div class="flex flex-col divide-y overflow-hidden rounded-xl border">
                @for (item of attention(); track item.key) {
                  <a [routerLink]="item.link" class="bg-card hover:bg-muted grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3">
                    <span class="size-2 rounded-full" [class]="item.tone === 'bad' ? 'bg-destructive' : 'bg-amber-500'" aria-hidden="true"></span>
                    <span class="min-w-0">
                      <span class="block font-medium">{{ item.title }}</span>
                      @if (item.detail) {<span class="text-muted-foreground block text-[13px]">{{ item.detail }}</span>}
                    </span>
                    <span class="text-[13px] whitespace-nowrap" [class]="item.tone === 'bad' ? 'text-destructive font-medium' : 'text-muted-foreground'">{{ item.when }}</span>
                  </a>
                }
              </div>
            } @else {
              <p class="text-muted-foreground flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm">
                <span class="size-2 rounded-full bg-green-600 dark:bg-green-400" aria-hidden="true"></span>{{ 'overview.attention.none' | translate }}
              </p>
            }
          </section>

          <section aria-labelledby="next-title" class="max-lg:order-3">
            <div class="mb-2.5 flex items-baseline justify-between gap-3">
              <h3 id="next-title" class="text-[15px] font-semibold">{{ 'overview.comingUp' | translate }}</h3>
              <a routerLink="/calendar" class="text-muted-foreground hover:text-foreground text-sm">{{ 'nav.calendar' | translate }}</a>
            </div>
            @if (comingUp().length) {
              <ul class="flex flex-col divide-y">
                @for (entry of comingUp(); track entry.key) {
                  <li class="grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                    <span class="bg-muted flex size-[46px] flex-col items-center justify-center rounded-lg leading-tight" aria-hidden="true">
                      <small class="text-muted-foreground text-[11px] uppercase">{{ entry.start | appDate: 'weekday' }}</small>
                      <strong class="text-lg font-semibold tabular-nums">{{ entry.start.getDate() }}</strong>
                    </span>
                    <span class="min-w-0">
                      <span class="block font-medium break-words">{{ entry.title }}</span>
                      <span class="text-muted-foreground block text-[13px]">
                        @if (entry.end) {{{ entry.start | appDate: 'weekdayDayMonth' }} – {{ entry.end | appDate: 'weekdayDayMonth' }}} @else {{{ entry.start | appDate: 'weekdayDayMonth' }}}@if (entry.time) { · {{ entry.time }}}@if (entry.place) { · {{ entry.place }}}
                      </span>
                    </span>
                    <span class="text-[12px] whitespace-nowrap" [class]="entry.isTest ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'">{{ entry.kind }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-muted-foreground py-2 text-sm">{{ 'overview.nothingComingUp' | translate }}</p>
            }
          </section>
        </div>
      </div>
    </div>
  `,
})
export class Overview {
  protected readonly agenda = inject(AgendaStore);
  private readonly grades = inject(GradesStore);
  private readonly absences = inject(AbsencesStore);
  private readonly reports = inject(SemesterReportsStore);
  private readonly schools = inject(MySchoolsStore);
  private readonly user = inject(UserStore);

  /** The clock the timeline runs on; it moves every TICK_MS so the countdown stays current. */
  private readonly now = signal(new Date());

  private readonly injector = inject(Injector);
  private readonly reportsCache = inject(ReportedAbsencesCache);
  /** Opened only once a past unexcused absence shows up, so an Overview with nothing open costs no Schulnetz request. */
  private readonly reportStore = signal<ReturnType<ReportedAbsencesCache['open']> | null>(null);

  constructor() {
    const timer = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    effect(() => {
      const needed = needsReportLookup(this.absences.items(), todayInSwitzerland(this.now()));
      untracked(() => {
        if (needed && !this.reportStore()) this.reportStore.set(this.reportsCache.open(this.injector));
      });
    });
  }

  protected readonly isLesson = (entry: AgendaEntryDto): boolean => entry.entryType === 'Lesson';
  protected readonly time = hhmm;
  protected readonly left = (end: Date): string => durationText(minutesLeft(end, this.now()));
  protected readonly pie = (start: Date, end: Date): number => Math.round(remainingPercent(start, end, this.now()) * 10) / 10;
  protected readonly toneClass = gradeTone;

  protected readonly timeline = computed(() => buildTimeline(this.agenda.today(), this.now()));

  protected readonly hello = computed(() => {
    const first = this.user.name().split(' ')[0];
    return first ? `${greeting(this.now())}, ${first}` : greeting(this.now());
  });

  private readonly groups = computed(() => {
    const schools = this.schools.items();
    const bbb = new Set(schools.filter((s) => isBbbWebsite(s.website)).map((s) => s.id));
    const onlyBbb = schools.length > 0 && bbb.size === schools.length;
    return buildGradeGroups(this.grades.grades(), this.reports.items(), (schoolId) => (schoolId ? bbb.has(schoolId) : onlyBbb));
  });

  private readonly classNames = computed(() => this.groups().flatMap(groupClassNames));

  protected readonly subline = computed(() => {
    const now = this.now();
    const parts = [formatWhen(now, 'weekdayDayMonthLong')];
    const today = semesterOfDate(now.toISOString());
    const semester = this.groups()[0]?.semesters.find((s) => s.yearStart === today.yearStart && s.half === today.half);
    if (semester) parts.push(t('common.semester', { number: semester.number }));
    const slots = this.timeline();
    const next = nextLesson(slots);
    if (next && !currentLesson(slots)) parts.push(t(next.room ? 'overview.nextIn' : 'overview.next', { title: next.title, room: next.room }));
    else if (slots.length && !next && !currentLesson(slots)) parts.push(t('overview.lessonsOver'));
    return parts.join(' · ');
  });

  /** The Grades page's headline for its default class and newest semester, shortened, wherever that page shows a number. */
  protected readonly standing = computed(() => {
    const group = this.groups()[0];
    const semester = group?.semesters[group.semesters.length - 1] ?? null;
    if (!group || !semester) return null;
    const headline = gradeHeadline(group, semester, subjectsBelowFour(semester.subjects));
    if (headline.value == null) return null;
    const state = headline.tone === 'good' ? t('overview.onTrack') : headline.tone === 'bad' ? t('overview.atRisk') : '';
    return { value: oneDecimal(headline.value), state, tone: headline.tone };
  });

  protected readonly newGrades = computed(() =>
    this.grades
      .grades()
      .filter((g) => isGraded(g.score))
      .slice(0, NEW_GRADES)
      .map((g) => ({ ...g, exam: cleanExamName(g.exam, g.subject, this.classNames()), when: relativeDay(g.date, this.now()) })),
  );

  protected readonly attention = computed(() => {
    const schools = this.schools.items();
    const bbb = new Set(schools.filter((s) => isBbbWebsite(s.website)).map((s) => s.id));
    const onlyBbb = schools.length > 0 && bbb.size === schools.length;
    const context = {
      today: todayInSwitzerland(this.now()),
      isBbb: (schoolId: string | null) => (schoolId ? bbb.has(schoolId) : onlyBbb),
      website: (schoolId: string | null) => (schoolId ? schools.find((s) => s.id === schoolId) : schools[0])?.website ?? null,
    };
    const reports = this.reportStore()?.reports() ?? [];
    return attentionItems(buildAbsenceRows(this.absences.items(), reports, context), this.agenda.upcoming(), this.now());
  });

  /** All-day entries arrive as midnight UTC (the calendar's rule), so they show a date or a range instead of a time. */
  protected readonly comingUp = computed(() => {
    const now = this.now();
    return this.agenda
      .upcoming()
      .filter((e) => e.entryType !== 'Lesson')
      .map((e) => {
        const startDay = dateOnly(e.date);
        const endDay = e.endDate ? dateOnly(e.endDate) : startDay;
        const allDay = startDay !== null && endDay !== null;
        const start = allDay ? startDay : new Date(e.date);
        const endTime = !allDay && e.endDate ? new Date(e.endDate) : null;
        const end = allDay && endDay && endDay.getTime() !== startDay.getTime() ? endDay : null;
        const time = allDay ? '' : endTime && endTime.getTime() !== start.getTime() ? `${hhmm(start)} – ${hhmm(endTime)}` : hhmm(start);
        const isTest = e.entryType === 'Test';
        return { key: e.id ?? `${e.date}|${e.title}`, title: e.title, place: e.place || '', start, end, time, allDay, isTest, kind: t(isTest ? 'overview.test' : e.entryType === 'Holiday' ? 'overview.holiday' : 'overview.event') };
      })
      // A timed entry that has started is today's business, shown in the timeline; all-day and multi-day ones stay until they end.
      .filter((e) => e.allDay || e.start.getTime() >= now.getTime())
      .slice(0, COMING_UP);
  });
}
