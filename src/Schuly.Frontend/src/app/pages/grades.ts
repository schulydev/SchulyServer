import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChartColumn, lucideChevronDown, lucideSearch } from '@ng-icons/lucide';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { ExamGrade, GradeGroup, SubjectResult, allSemestersAverage, buildGradeGroups, countsInAverage, groupClassNames, isBbbWebsite, isGraded, oneDecimal, subjectLabel, weightedMean } from '../core/grade-report';
import { EmptyState } from '../shared/empty-state';
import { SyncingNotice } from '../shared/syncing-notice';
import { GradesStore } from '../stores/grades.store';
import { MySchoolsStore, SemesterReportsStore } from '../stores/semester-reports.store';
import { GradesExamRow } from './grades-exam-row';
import { gradeDot, gradeTone, scalePosition } from './grades-tone';
import { GradesZeugnis } from './grades-zeugnis';

const ALL = 'all';
const NO_DATE = 'no-date';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type View = 'subject' | 'date' | 'zeugnis';

const SEGMENT = 'text-foreground/80 aria-pressed:bg-background aria-pressed:text-foreground focus-visible:outline-ring rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-2 aria-pressed:shadow-sm';

@Component({
  selector: 'app-grades',
  imports: [SyncingNotice, HlmInputGroupImports, HlmSelectImports, HlmSkeletonImports, NgIcon, EmptyState, GradesExamRow, GradesZeugnis],
  providers: [provideIcons({ lucideSearch, lucideChartColumn, lucideChevronDown })],
  template: `
    <div class="flex flex-col gap-5 p-4 md:gap-6 lg:p-6">
      <app-syncing-notice />
      <div class="flex flex-wrap items-center justify-end gap-3">
        <h2 class="sr-only">Grades</h2>
        <div class="flex flex-wrap items-center gap-2">
          @if (groups().length > 1) {
            <div class="bg-muted flex flex-wrap gap-0.5 rounded-lg p-[3px]" role="group" aria-label="Class">
              @for (item of groups(); track item.key) {
                <button type="button" [class]="segment" [attr.aria-pressed]="item.key === group()?.key" (click)="groupKey.set(item.key)">{{ item.label }}</button>
              }
            </div>
          }
          @if (group()) {
            <label class="sr-only" for="grades-semester">Semester</label>
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
                    <hlm-select-item [value]="noDate">No date</hlm-select-item>
                  }
                  <hlm-select-item [value]="all">All semesters</hlm-select-item>
                </hlm-select-group>
              </hlm-select-content>
            </hlm-select>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-2">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <hlm-skeleton class="h-12 w-full" />
          }
        </div>
      } @else if (group(); as current) {
        <section class="flex flex-wrap items-end justify-between gap-x-10 gap-y-6 border-b pb-6" aria-label="Summary">
          <div class="min-w-64 flex-1">
            <p class="text-muted-foreground text-sm">{{ averageLabel() }}</p>
            <div class="mt-1 mb-4 flex flex-wrap items-baseline gap-x-3">
              <p class="text-6xl leading-none font-semibold tracking-tighter tabular-nums">{{ averageText() }}</p>
              @if (current.bbbRules && average() != null) {
                <p class="text-muted-foreground text-sm">every subject counts the same</p>
              }
            </div>
            <div class="relative h-9 max-w-[32.5rem]" aria-hidden="true">
              <div class="bg-muted absolute inset-x-0 top-2 h-1.5 overflow-hidden rounded-full">
                <div class="bg-destructive/25 h-full w-3/5"></div>
              </div>
              <div class="bg-muted-foreground absolute top-[3px] left-3/5 h-4 w-0.5"></div>
              @if (average(); as value) {
                <div class="bg-foreground border-background absolute top-[3px] -ml-2 size-4 rounded-full border-[3px]" [style.left.%]="position(value)"></div>
              }
              <div class="text-muted-foreground absolute inset-x-0 top-5 text-[11px]">
                @for (tick of ticks; track tick) {
                  <span class="absolute first:translate-x-0 last:-translate-x-full [&:not(:first-child,:last-child)]:-translate-x-1/2" [style.left.%]="position(tick)">{{ tick }}</span>
                }
              </div>
            </div>
          </div>
          <dl class="flex gap-7">
            <div class="flex flex-col-reverse">
              <dt class="text-muted-foreground text-sm">Grades</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ gradeCount() }}</dd>
            </div>
            <div class="flex flex-col-reverse">
              <dt class="text-muted-foreground text-sm">Subjects</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ subjectCount() }}</dd>
            </div>
            <div class="flex flex-col-reverse">
              <dt class="text-muted-foreground text-sm">Negative Abweichung</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums" [class.text-destructive]="deviation()">{{ deviationText() }}</dd>
            </div>
          </dl>
        </section>

        <div class="flex flex-wrap items-center justify-between gap-3">
          @if (view() !== 'zeugnis') {
            <hlm-input-group class="w-full sm:max-w-xs">
              <input hlmInputGroupInput placeholder="Search exams or subjects" aria-label="Search exams or subjects" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" />
              <hlm-input-group-addon>
                <ng-icon name="lucideSearch" />
              </hlm-input-group-addon>
            </hlm-input-group>
          } @else {
            <span></span>
          }
          <div class="bg-muted flex flex-wrap gap-0.5 rounded-lg p-[3px]" role="group" aria-label="View">
            @for (item of views; track item.id) {
              <button type="button" [class]="segment" [attr.aria-pressed]="view() === item.id" (click)="view.set(item.id)">{{ item.label }}</button>
            }
          </div>
        </div>

        @switch (view()) {
          @case ('subject') {
            <div class="flex flex-col">
              @for (subject of subjects(); track subject.key) {
                <div class="border-b">
                  <button type="button" class="hover:bg-muted/50 focus-visible:outline-ring grid w-full grid-cols-[minmax(0,1fr)_3.75rem_1rem] items-center gap-3.5 rounded-lg px-1.5 py-3.5 text-left focus-visible:outline-2 sm:grid-cols-[minmax(0,1.25fr)_minmax(5.5rem,1fr)_3.75rem_1rem]" [attr.aria-expanded]="isOpen(subject)" (click)="toggle(subject)">
                    <span class="min-w-0">
                      <span class="block font-medium wrap-anywhere">{{ subject.name }}</span>
                      <span class="text-muted-foreground text-xs">{{ subjectDetail(subject) }}</span>
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
                        <p class="text-muted-foreground py-2 text-sm">From your Zeugnis. Schuly has no exams for this subject.</p>
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
              @for (month of months(); track month.key; let first = $first) {
                <h3 class="text-muted-foreground px-1.5 pb-1 text-xs font-semibold" [class.pt-5]="!first">{{ month.label }}</h3>
                <div class="flex flex-col divide-y border-b px-1.5">
                  @for (row of month.rows; track row.id) {
                    <app-grades-exam-row [row]="row" [classNames]="classNames()" [showSubject]="true" />
                  }
                </div>
              } @empty {
                <p class="text-muted-foreground py-7 text-sm">{{ emptyText() }}</p>
              }
            </div>
          }
          @case ('zeugnis') {
            <app-grades-zeugnis [group]="current" [selectedKey]="semesterKey()" (selected)="semesterKey.set($event)" />
            @if (current.undated.length) {
              <p class="text-muted-foreground text-xs">{{ current.undated.length }} {{ current.undated.length === 1 ? 'grade has' : 'grades have' }} no date, so {{ current.undated.length === 1 ? 'it isn\\'t' : 'they aren\\'t' }} in a semester here. Choose "No date" in the list to see them.</p>
            }
          }
        }
        @if (view() !== 'zeugnis' && !current.bbbRules) {
          <p class="text-muted-foreground text-xs">Subjects show their plain average, which may differ from what your school prints on its reports.</p>
        }
      } @else {
        <app-empty-state icon="lucideChartColumn" title="No grades yet" description="Grades show up here once your school publishes them." />
      }
    </div>
  `,
})
export class Grades {
  private readonly grades = inject(GradesStore);
  private readonly reports = inject(SemesterReportsStore);
  private readonly schools = inject(MySchoolsStore);

  protected readonly segment = SEGMENT;
  protected readonly all = ALL;
  protected readonly noDate = NO_DATE;
  protected readonly ticks = [1, 2, 3, 4, 5, 6];
  protected readonly position = scalePosition;
  protected readonly tone = gradeTone;
  protected readonly views: { id: View; label: string }[] = [
    { id: 'subject', label: 'By subject' },
    { id: 'date', label: 'By date' },
    { id: 'zeugnis', label: 'Zeugnis' },
  ];

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
    if (key === ALL) return 'All semesters';
    if (key === NO_DATE) return 'No date';
    return this.group()?.semesters.find((s) => s.key === key)?.label ?? '';
  };

  protected readonly average = computed(() => {
    const group = this.group();
    if (!group) return null;
    if (this.semesterKey() === ALL) return allSemestersAverage(group);
    return this.semester()?.average ?? null;
  });
  protected readonly averageText = computed(() => {
    const value = this.average();
    return value != null ? oneDecimal(value) : '–';
  });
  protected readonly averageLabel = computed(() => {
    const group = this.group();
    const semester = this.semester();
    const className = this.groups().length > 1 ? `, ${group?.label}` : '';
    if (this.semesterKey() === NO_DATE) return `Grades without a date${className}`;
    if (!semester) return `Average of all semesters${className}`;
    if (semester.report) return `Zeugnis average, ${semester.label}${className}`;
    if (semester.expected) return `Expected average, ${semester.label}${className}`;
    return `No Zeugnis yet, ${semester.label}${className}`;
  });

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
      else months.push({ key, label: `${MONTHS[month - 1]} ${year}`, rows: [row] });
    }
    const undated = rows.filter((r) => !r.date);
    if (undated.length) months.push({ key: 'none', label: 'No date', rows: undated });
    return months;
  });

  protected readonly emptyText = computed(() => {
    const query = this.query().trim();
    return query ? `No exams match "${query}".` : 'No grades in this semester yet.';
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

  protected subjectDetail(subject: SubjectResult): string {
    const graded = subject.rows.filter((r) => isGraded(r.score)).length;
    const parts = [subject.rows.length ? (graded ? `${graded} ${graded === 1 ? 'grade' : 'grades'}` : 'Not graded') : 'Zeugnis only'];
    if (graded > 1 && subject.exact != null) parts.push(`average ${subject.exact.toFixed(2)}`);
    if (!subject.counted) parts.push('not in the average');
    return parts.join(' · ');
  }

  protected subjectDots(subject: SubjectResult): { tone: string; left: number }[] {
    const scores = subject.rows.filter((r) => isGraded(r.score)).map((r) => r.score);
    return (scores.length ? scores : subject.grade != null ? [subject.grade] : []).map((score) => ({ tone: gradeDot(score), left: scalePosition(score) }));
  }

  protected pillText(subject: SubjectResult): string {
    if (subject.grade != null) return subject.grade * 2 === Math.round(subject.grade * 2) ? subject.grade.toFixed(1) : subject.grade.toFixed(2);
    return subject.marker ?? '–';
  }

  protected pillLabel(subject: SubjectResult): string {
    const text = this.pillText(subject);
    return this.group()?.bbbRules && this.semesterKey() !== ALL ? `Zeugnis grade ${text}` : `Average ${text}`;
  }
}
