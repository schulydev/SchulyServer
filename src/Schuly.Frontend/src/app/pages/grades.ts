import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChartColumn, lucideChevronDown, lucideSearch } from '@ng-icons/lucide';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { ExamGrade, GradeGroup, GradeHeadline, SubjectResult, buildGradeGroups, chooseGradeCase, countsInAverage, gradeHeadline, groupClassNames, isBbbWebsite, isGraded, oneDecimal, subjectKey, subjectLabel, subjectsBelowFour, weightedMean } from '../core/grade-report';
import { shortDay } from '../core/absence-view';
import { formatWhen } from '../core/date-format';
import { toIsoDate } from '../core/dates';
import { UpcomingTest, nextTestBySubject, upcomingTests } from '../core/upcoming-tests';
import { EmptyState } from '../shared/empty-state';
import { SyncingNotice } from '../shared/syncing-notice';
import { AgendaStore } from '../stores/agenda.store';
import { ClassesStore } from '../stores/classes.store';
import { GradesStore } from '../stores/grades.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { MySchoolsStore, SemesterReportsStore } from '../stores/semester-reports.store';
import { GradesExamRow } from './grades-exam-row';
import { gradeDot, gradeTone, scalePosition } from './grades-tone';
import { GradesZeugnis } from './grades-zeugnis';

const ALL = 'all';
const NO_DATE = 'no-date';

type View = 'subject' | 'date' | 'zeugnis';

const SEGMENT = 'text-foreground/80 aria-pressed:bg-background aria-pressed:text-foreground focus-visible:outline-ring rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-2 aria-pressed:shadow-sm';

@Component({
  selector: 'app-grades',
  imports: [SyncingNotice, HlmInputGroupImports, HlmSelectImports, HlmSkeletonImports, NgIcon, EmptyState, GradesExamRow, GradesZeugnis, TranslatePipe],
  providers: [provideIcons({ lucideSearch, lucideChartColumn, lucideChevronDown })],
  template: `
    <div class="flex flex-col gap-5 p-4 md:gap-6 lg:p-6">
      <app-syncing-notice [class.absolute]="!accounts.syncing()" />
      <h2 class="sr-only">{{ 'nav.grades' | translate }}</h2>

      @if (loading()) {
        <div class="flex flex-col gap-2">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <hlm-skeleton class="h-12 w-full" />
          }
        </div>
      } @else if (noGrades()) {
        <app-empty-state icon="lucideChartColumn" [title]="'grades.empty.title' | translate" [description]="'grades.empty.description' | translate" />
      } @else if (group(); as current) {
        <section class="flex flex-wrap items-end justify-between gap-x-10 gap-y-6 border-b pb-6" [attr.aria-label]="'absences.summary' | translate">
          <div class="min-w-64 flex-1">
            <p class="text-muted-foreground text-sm">{{ headline().label }}</p>
            <div class="mt-1.5 mb-4 flex flex-wrap items-center gap-x-4.5 gap-y-1.5">
              @if (headline().value != null) {
                <p class="text-6xl leading-none font-semibold tracking-tighter tabular-nums">{{ averageText() }}</p>
              }
              <div class="min-w-56 flex-1">
                @if (headline().state) {
                  <p class="text-lg font-semibold tracking-tight text-balance" [class.text-green-700]="headline().tone === 'good'" [class.dark:text-green-400]="headline().tone === 'good'" [class.text-destructive]="headline().tone === 'bad'">{{ headline().state }}</p>
                }
                @if (headline().hint) {
                  <p class="text-muted-foreground max-w-prose text-sm">{{ headline().hint }}</p>
                }
              </div>
            </div>
            @if (headline().value; as value) {
              <div class="relative h-9 max-w-[32.5rem]" aria-hidden="true">
                <div class="bg-muted absolute inset-x-0 top-2 h-1.5 overflow-hidden rounded-full">
                  <div class="bg-destructive/25 h-full w-3/5"></div>
                </div>
                <div class="bg-muted-foreground absolute top-[3px] left-3/5 h-4 w-0.5"></div>
                <div class="bg-foreground border-background absolute top-[3px] -ml-2 size-4 rounded-full border-[3px]" [style.left.%]="position(value)"></div>
                <div class="text-muted-foreground absolute inset-x-0 top-5 text-[11px]">
                  @for (tick of ticks; track tick) {
                    <span class="absolute first:translate-x-0 last:-translate-x-full [&:not(:first-child,:last-child)]:-translate-x-1/2" [style.left.%]="position(tick)">{{ tick }}</span>
                  }
                </div>
              </div>
            }
          </div>
          <div class="flex flex-col items-start justify-between gap-6 self-stretch sm:items-end">
          <div class="flex flex-wrap items-center gap-2">
            @if (groups().length > 1) {
              <div class="bg-muted flex flex-wrap gap-0.5 rounded-lg p-[3px]" role="group" [attr.aria-label]="'grades.class' | translate">
                @for (item of groups(); track item.key) {
                  <button type="button" [class]="segment" [attr.aria-pressed]="item.key === group()?.key" (click)="groupKey.set(item.key)">{{ item.label }}</button>
                }
              </div>
            }
            @if (group()) {
              <label class="sr-only" for="grades-semester">{{ 'absences.semester' | translate }}</label>
              <hlm-select class="w-56" [value]="semesterKey()" [itemToString]="semesterLabel" (valueChange)="semesterKey.set($event ?? null)">
                <hlm-select-trigger buttonId="grades-semester" class="w-full">
                  <hlm-select-value />
                </hlm-select-trigger>
                <hlm-select-content *hlmSelectPortal>
                  <hlm-select-group>
                    @for (semester of newestFirst(); track semester.key) {
                      <hlm-select-item [value]="semester.key">{{ semester.label }}</hlm-select-item>
                    }
                    @if (group()?.undated?.length) {
                      <hlm-select-item [value]="noDate">{{ 'common.noDate' | translate }}</hlm-select-item>
                    }
                    @if (hasAllOption()) {
                      <hlm-select-item [value]="all">{{ 'grades.allSemesters' | translate }}</hlm-select-item>
                    }
                  </hlm-select-group>
                </hlm-select-content>
              </hlm-select>
            }
          </div>
            <dl class="flex gap-7">
              <div class="flex flex-col-reverse">
                <dt class="text-muted-foreground text-sm">{{ 'nav.grades' | translate }}</dt>
                <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ gradeCount() }}</dd>
              </div>
              <div class="flex flex-col-reverse">
                <dt class="text-muted-foreground text-sm">{{ 'grades.subjects' | translate }}</dt>
                <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ subjectCount() }}</dd>
              </div>
              <div class="flex flex-col-reverse">
                <dt class="text-muted-foreground text-sm">{{ (showDeviation() ? 'grades.deviation' : 'grades.subjectsBelowFour') | translate }}</dt>
                <dd class="text-2xl font-semibold tracking-tight tabular-nums" [class.text-destructive]="showDeviation() ? deviation() : belowFour()">{{ showDeviation() ? deviationText() : belowFour() }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <div class="flex flex-wrap items-center justify-between gap-3">
          @if (activeView() !== 'zeugnis') {
            <hlm-input-group class="w-full sm:max-w-xs">
              <input hlmInputGroupInput [placeholder]="'grades.search' | translate" [attr.aria-label]="'grades.search' | translate" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" />
              <hlm-input-group-addon>
                <ng-icon name="lucideSearch" />
              </hlm-input-group-addon>
            </hlm-input-group>
          } @else {
            <span></span>
          }
          <div class="bg-muted flex flex-wrap gap-0.5 rounded-lg p-[3px]" role="group" [attr.aria-label]="'grades.view' | translate">
            @for (item of views(); track item.id) {
              <button type="button" [class]="segment" [attr.aria-pressed]="activeView() === item.id" (click)="view.set(item.id)">{{ item.label | translate }}</button>
            }
          </div>
        </div>

        @switch (activeView()) {
          @case ('subject') {
            <div class="flex flex-col">
              @for (subject of subjects(); track subject.key) {
                <div class="border-b">
                  <button type="button" class="hover:bg-muted/50 focus-visible:outline-ring grid w-full grid-cols-[minmax(0,1fr)_3.75rem_1rem] items-center gap-3.5 rounded-lg px-1.5 py-3.5 text-left focus-visible:outline-2 sm:grid-cols-[minmax(0,1.25fr)_minmax(5.5rem,1fr)_3.75rem_1rem]" [attr.aria-expanded]="isOpen(subject)" (click)="toggle(subject)">
                    <span class="min-w-0">
                      <span class="block font-medium wrap-anywhere">{{ subject.name }}</span>
                      <span class="text-muted-foreground text-xs">{{ subjectDetail(subject) }}</span>
                      @if (nextTest(subject); as test) {
                        <span class="text-muted-foreground block text-xs">{{ 'grades.testOn' | translate: { day: day(test) } }}</span>
                      }
                    </span>
                    <span class="relative col-span-3 row-start-2 block h-4 sm:col-span-1 sm:row-start-auto" aria-hidden="true">
                      <span class="bg-muted-foreground/35 absolute inset-x-0 top-[7px] h-0.5 rounded-full"></span>
                      <span class="bg-muted-foreground/60 absolute top-[3px] left-3/5 h-2.5 w-px"></span>
                      @for (dot of subjectDots(subject); track $index) {
                        <span class="border-background absolute top-[1px] z-[1] -ml-[7px] size-3.5 rounded-full border-2" [class]="dot.tone" [style.left.%]="dot.left"></span>
                      }
                    </span>
                    <span class="col-start-2 row-start-1 justify-self-end rounded-lg px-2 py-0.5 text-center text-sm font-semibold tabular-nums sm:col-start-auto sm:row-start-auto" [class]="tone(subject.grade)" [attr.aria-label]="pillLabel(subject)">{{ pillText(subject) }}</span>
                    <ng-icon name="lucideChevronDown" class="text-muted-foreground col-start-3 row-start-1 transition-transform motion-reduce:transition-none sm:col-start-auto sm:row-start-auto" [class.rotate-180]="isOpen(subject)" aria-hidden="true" />
                  </button>
                  @if (isOpen(subject)) {
                    <div class="flex flex-col divide-y px-1.5 pb-3 sm:pr-9">
                      @for (row of examsOf(subject); track row.id) {
                        <app-grades-exam-row [row]="row" [classNames]="classNames()" />
                      } @empty {
                        <p class="text-muted-foreground py-2 text-sm">{{ 'grades.zeugnisOnlyHint' | translate }}</p>
                      }
                    </div>
                  }
                </div>
              } @empty {
                <p class="text-muted-foreground py-7 text-sm">{{ emptyText() }}</p>
              }
            </div>
          }
          @case ('date') {
            <div class="flex flex-col">
              @if (upcoming().length) {
                <h3 class="text-muted-foreground px-1.5 pb-1 text-xs font-semibold">{{ 'grades.upcoming' | translate }}</h3>
                <div class="flex flex-col divide-y border-b px-1.5">
                  @for (test of upcoming(); track test.key) {
                    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2">
                      <div class="min-w-0 wrap-anywhere">
                        {{ test.title }}
                        @if (test.subject) {<div class="text-muted-foreground text-sm">{{ subjectName(test.subject) }}</div>}
                      </div>
                      <div class="text-muted-foreground text-right text-xs tabular-nums sm:text-sm">
                        {{ day(test) }}@if (!test.allDay) { · {{ time(test.start) }}}@if (test.room) { · {{ test.room }}}
                      </div>
                    </div>
                  }
                </div>
              }
              @for (month of months(); track month.key; let first = $first) {
                <h3 class="text-muted-foreground px-1.5 pb-1 text-xs font-semibold" [class.pt-5]="!first || upcoming().length > 0">{{ month.label }}</h3>
                <div class="flex flex-col divide-y border-b px-1.5">
                  @for (row of month.rows; track row.id) {
                    <app-grades-exam-row [row]="row" [classNames]="classNames()" [showSubject]="true" />
                  }
                </div>
              } @empty {
                @if (!upcoming().length) {
                  <p class="text-muted-foreground py-7 text-sm">{{ emptyText() }}</p>
                }
              }
            </div>
          }
          @case ('zeugnis') {
            <app-grades-zeugnis [group]="current" [selectedKey]="semesterKey()" (selected)="semesterKey.set($event)" />
            @if (current.undated.length) {
              <p class="text-muted-foreground text-xs">{{ 'grades.undated' | translate: { count: current.undated.length } }}</p>
            }
          }
        }
        @if (activeView() !== 'zeugnis' && !current.bbbRules && !isZeugnisSemester()) {
          <p class="text-muted-foreground text-xs">{{ 'grades.plainAverage' | translate }}</p>
        }
      }
    </div>
  `,
})
export class Grades {
  protected readonly accounts = inject(LinkedAccountsStore);
  private readonly grades = inject(GradesStore);
  private readonly reports = inject(SemesterReportsStore);
  private readonly schools = inject(MySchoolsStore);

  protected readonly segment = SEGMENT;
  protected readonly all = ALL;
  protected readonly noDate = NO_DATE;
  protected readonly ticks = [1, 2, 3, 4, 5, 6];
  protected readonly position = scalePosition;
  protected readonly tone = gradeTone;
  protected readonly view = signal<View>('subject');
  protected readonly query = signal('');
  private readonly touched = signal(new Map<string, boolean>());

  protected readonly loading = computed(() => (this.grades.loading() && !this.grades.items().length) || (this.reports.loading() && !this.reports.items().length));

  protected readonly groups = computed<GradeGroup[]>(() => {
    const schools = this.schools.items();
    const bbb = new Set(schools.filter((s) => isBbbWebsite(s.website)).map((s) => s.id));
    // A report doesn't say which school it's from, so reports without any exams only follow BBB's rules when that is the only school.
    const onlyBbb = schools.length > 0 && bbb.size === schools.length;
    return buildGradeGroups(this.grades.grades(), this.reports.items(), (schoolId) => (schoolId ? bbb.has(schoolId) : onlyBbb));
  });

  protected readonly groupKey = linkedSignal<GradeGroup[], string | null>({
    source: this.groups,
    computation: (groups, previous) => (groups.some((g) => g.key === previous?.value) ? (previous?.value ?? null) : (groups[0]?.key ?? null)),
  });
  protected readonly group = computed(() => this.groups().find((g) => g.key === this.groupKey()) ?? null);
  protected readonly newestFirst = computed(() => [...(this.group()?.semesters ?? [])].reverse());
  protected readonly classNames = computed(() => (this.group() ? groupClassNames(this.group()!) : []));

  /** Opens on the newest semester of the class, and again on switching class. */
  protected readonly semesterKey = linkedSignal<GradeGroup | null, string | null>({
    source: this.group,
    computation: (group, previous) => {
      const options = [...(group?.semesters.map((s) => s.key) ?? []), ALL, ...(group?.undated.length ? [NO_DATE] : [])];
      const sameClass = previous?.source?.key === group?.key;
      if (sameClass && previous?.value && options.includes(previous.value)) return previous.value;
      return group?.semesters[group.semesters.length - 1]?.key ?? (group?.undated.length ? NO_DATE : ALL);
    },
  });
  protected readonly semester = computed(() => this.group()?.semesters.find((s) => s.key === this.semesterKey()) ?? null);
  protected readonly semesterLabel = (key: string | null): string => {
    if (key === ALL) return t('grades.allSemesters');
    if (key === NO_DATE) return t('common.noDate');
    return this.group()?.semesters.find((s) => s.key === key)?.label ?? '';
  };

  private readonly selectedSubjects = computed<SubjectResult[]>(() => {
    const group = this.group();
    if (!group) return [];
    if (this.semesterKey() === NO_DATE) return this.subjectsFromRows(group.undated, group.bbbRules);
    if (this.semesterKey() === ALL) {
      const merged = new Map<string, SubjectResult>();
      for (const semester of [...group.semesters].reverse()) {
        for (const subject of semester.subjects) {
          const known = merged.get(subject.key);
          merged.set(subject.key, known ? { ...known, rows: [...known.rows, ...subject.rows] } : { ...subject, rows: [...subject.rows] });
        }
      }
      for (const subject of this.subjectsFromRows(group.undated, group.bbbRules)) if (!merged.has(subject.key)) merged.set(subject.key, subject);
      // Across semesters a subject has no single Zeugnis grade: it shows the average of its exams, or its latest grade without any.
      return [...merged.values()].map((subject) => {
        const exact = weightedMean(subject.rows);
        return { ...subject, exact, grade: exact ?? subject.grade };
      });
    }
    return this.semester()?.subjects ?? [];
  });

  private subjectsFromRows(rows: ExamGrade[], bbbRules: boolean): SubjectResult[] {
    const subjects = new Map<string, SubjectResult>();
    for (const row of rows) {
      const name = subjectLabel(row.subject);
      const entry = subjects.get(name) ?? { key: name, name, grade: null, marker: null, exact: null, counted: countsInAverage(name, bbbRules), rows: [] };
      entry.rows.push(row);
      subjects.set(name, entry);
    }
    for (const entry of subjects.values()) {
      entry.exact = weightedMean(entry.rows);
      entry.grade = entry.exact;
    }
    return [...subjects.values()];
  }

  protected readonly gradeCase = computed(() => chooseGradeCase(this.group()));
  protected readonly noGrades = computed(() => this.groups().every((g) => chooseGradeCase(g) === 'none'));
  /** Without a report there's nothing a Zeugnis view could print. */
  protected readonly views = computed<{ id: View; label: string }[]>(() => [{ id: 'subject', label: 'grades.bySubject' }, { id: 'date', label: 'grades.byDate' }, ...(this.gradeCase() === 'no-reports' ? [] : [{ id: 'zeugnis' as const, label: 'grades.zeugnis' }])]);
  protected readonly activeView = computed<View>(() => (this.views().some((v) => v.id === this.view()) ? this.view() : 'subject'));
  protected readonly hasAllOption = computed(() => (this.group()?.semesters.length ?? 0) > 1 || !!this.group()?.undated.length);
  /** This semester's subject grades are Zeugnis grades: from the report, or expected under confirmed rules. */
  protected readonly isZeugnisSemester = computed(() => !!this.semester()?.report || !!this.semester()?.expected);
  protected readonly belowFour = computed(() => subjectsBelowFour(this.selectedSubjects()));
  protected readonly showDeviation = computed(() => !!this.group()?.bbbRules && !!this.semester());

  protected readonly headline = computed<GradeHeadline>(() => {
    const group = this.group();
    if (!group) return { label: '', value: null, state: '', tone: '', hint: '' };
    const suffix = this.groups().length > 1 ? `, ${group.label}` : '';
    if (this.semesterKey() === NO_DATE) return { label: `${t('grades.withoutDate')}${suffix}`, value: null, state: '', tone: '', hint: t('grades.hint.withoutDate') };
    return gradeHeadline(group, this.semester(), this.belowFour(), suffix);
  });
  protected readonly averageText = computed(() => {
    const value = this.headline().value;
    return value != null ? oneDecimal(value) : '';
  });

  private readonly selectedRows = computed(() => this.selectedSubjects().flatMap((s) => s.rows));
  protected readonly gradeCount = computed(() => this.selectedRows().filter((r) => isGraded(r.score)).length);
  protected readonly subjectCount = computed(() => this.selectedSubjects().filter((s) => s.counted && (s.grade != null || s.exact != null)).length);
  protected readonly deviation = computed(() => this.semester()?.deviation ?? null);
  protected readonly deviationText = computed(() => {
    const value = this.deviation();
    return value == null ? '–' : value === 0 ? '0' : value.toFixed(1);
  });

  private matches(row: ExamGrade): boolean {
    const query = this.query().trim().toLowerCase();
    return !query || row.exam.toLowerCase().includes(query) || row.subject.toLowerCase().includes(query);
  }

  protected readonly subjects = computed(() => {
    const query = this.query().trim().toLowerCase();
    const list = this.selectedSubjects().filter((s) => !query || s.name.toLowerCase().includes(query) || s.rows.some((r) => this.matches(r)));
    const rank = (s: SubjectResult) => s.exact ?? s.grade ?? Number.POSITIVE_INFINITY;
    return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  });

  protected readonly months = computed(() => {
    const rows = this.selectedRows().filter((r) => this.matches(r));
    const dated = rows.filter((r) => r.date).sort((a, b) => (b.date as string).localeCompare(a.date as string));
    const months: { key: string; label: string; rows: ExamGrade[] }[] = [];
    for (const row of dated) {
      const key = (row.date as string).slice(0, 7);
      const [year, month] = key.split('-').map(Number);
      const last = months[months.length - 1];
      if (last?.key === key) last.rows.push(row);
      else months.push({ key, label: formatWhen(new Date(year, month - 1, 1), 'monthYearLong'), rows: [row] });
    }
    const undated = rows.filter((r) => !r.date);
    if (undated.length) months.push({ key: 'none', label: t('common.noDate'), rows: undated });
    return months;
  });

  protected readonly emptyText = computed(() => {
    const query = this.query().trim();
    return query ? t('grades.noMatch', { query }) : t('grades.noneInSemester');
  });

  protected isOpen(subject: SubjectResult): boolean {
    if (this.query().trim()) return true;
    const key = `${this.groupKey()}|${this.semesterKey()}|${subject.key}`;
    return this.touched().get(key) ?? (subject.grade != null && subject.grade < 4);
  }

  protected toggle(subject: SubjectResult): void {
    const key = `${this.groupKey()}|${this.semesterKey()}|${subject.key}`;
    const open = this.isOpen(subject);
    this.touched.update((map) => new Map(map).set(key, !open));
  }

  protected examsOf(subject: SubjectResult): ExamGrade[] {
    return [...subject.rows].filter((r) => this.matches(r) || subject.name.toLowerCase().includes(this.query().trim().toLowerCase())).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }

  private readonly agenda = inject(AgendaStore);
  private readonly classes = inject(ClassesStore);

  /** Tests not graded yet, in the selected class only when Schuly knows which subjects it has. */
  private readonly allUpcoming = computed(() => upcomingTests(this.agenda.items(), this.grades.exams(), (id) => this.classes.names().get(id ?? '') ?? '', new Date()));
  protected readonly upcoming = computed(() => {
    const group = this.group();
    const keys = new Set(group ? group.semesters.flatMap((s) => s.subjects.map((sub) => sub.key)) : []);
    const query = this.query().trim().toLowerCase();
    return this.allUpcoming().filter((t) => (!keys.size || !t.subject || keys.has(subjectKey(t.subject))) && (!query || t.title.toLowerCase().includes(query) || t.subject.toLowerCase().includes(query)));
  });
  private readonly nextTests = computed(() => nextTestBySubject(this.allUpcoming()));
  protected readonly nextTest = (subject: SubjectResult): UpcomingTest | null => this.nextTests().get(subject.key) ?? null;
  protected readonly day = (test: UpcomingTest): string => shortDay(toIsoDate(test.start));
  protected readonly time = (date: Date): string => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  protected readonly subjectName = subjectLabel;

  protected subjectDetail(subject: SubjectResult): string {
    const graded = subject.rows.filter((r) => isGraded(r.score)).length;
    const parts = [subject.rows.length ? (graded ? t('grades.count', { count: graded }) : t('grades.notGraded')) : t('grades.zeugnisOnly')];
    if (graded > 1 && subject.exact != null && this.isZeugnisSemester()) parts.push(t('grades.averageOf', { value: subject.exact.toFixed(2) }));
    if (!subject.counted) parts.push(t('grades.notCounted'));
    return parts.join(' · ');
  }

  protected subjectDots(subject: SubjectResult): { tone: string; left: number }[] {
    const scores = subject.rows.filter((r) => isGraded(r.score)).map((r) => r.score);
    return (scores.length ? scores : subject.grade != null ? [subject.grade] : []).map((score) => ({ tone: gradeDot(score), left: scalePosition(score) }));
  }

  protected pillText(subject: SubjectResult): string {
    if (subject.grade != null) return this.isZeugnisSemester() && subject.grade * 2 === Math.round(subject.grade * 2) ? subject.grade.toFixed(1) : subject.grade.toFixed(2);
    return subject.marker ?? '–';
  }

  protected pillLabel(subject: SubjectResult): string {
    const text = this.pillText(subject);
    return t(this.isZeugnisSemester() ? 'grades.zeugnisGrade' : 'grades.average', { value: text });
  }
}
