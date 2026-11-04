import { Component, computed, input, output } from '@angular/core';
import { GradeGroup, SemesterResult, SubjectResult, hasPromotionDecisions, oneDecimal, promotionText } from '../core/grade-report';

interface Row {
  key: string;
  name: string;
  counted: boolean;
  cells: { semester: number; text: string; low: boolean }[];
}

/** The class's Zeugnis as the school prints it: subjects down, semesters across, under the school years. */
@Component({
  selector: 'app-grades-zeugnis',
  template: `
    <div class="overflow-x-auto" tabindex="0" role="region" aria-label="Zeugnis">
      <table class="w-full min-w-[38rem] border-collapse text-center tabular-nums">
        <thead>
          <tr class="text-muted-foreground text-xs">
            <td class="border-b"></td>
            @for (year of years(); track year) {
              <th scope="colgroup" colspan="2" class="border-b border-l px-1 py-2 font-medium">{{ year }}</th>
            }
          </tr>
          <tr class="text-muted-foreground text-xs">
            <th scope="col" class="w-1/3 border-b px-1 py-2 text-left font-medium">Pflichtfächer</th>
            @for (number of columns(); track number) {
              <th scope="col" class="border-b px-1 py-2 font-medium" [class.border-l]="number % 2 === 1" [class.bg-muted]="number === selectedNumber()">
                @if (semesterAt(number); as semester) {
                  <button type="button" class="hover:text-foreground focus-visible:outline-ring rounded px-2 py-0.5 font-semibold underline decoration-dotted underline-offset-3 focus-visible:outline-2" [attr.aria-label]="'Show semester ' + number" [attr.aria-pressed]="number === selectedNumber()" (click)="selected.emit(semester.key)">{{ number }}</button>
                } @else {
                  {{ number }}
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.key) {
            <tr>
              <th scope="row" class="border-b px-1 py-2 text-left font-medium wrap-anywhere">
                {{ row.name }}
                @if (!row.counted) {
                  <span class="text-muted-foreground block text-xs font-normal">Not in the average</span>
                }
              </th>
              @for (cell of row.cells; track cell.semester) {
                <td class="border-b px-1 py-2" [class.border-l]="cell.semester % 2 === 1" [class.bg-muted]="cell.semester === selectedNumber()" [class.italic]="isExpected(cell.semester)" [class.text-foreground/75]="isExpected(cell.semester) && !cell.low" [class.text-red-800]="cell.low" [class.dark:text-red-400]="cell.low" [class.font-semibold]="cell.low">{{ cell.text }}</td>
              }
            </tr>
          }
        </tbody>
        <tfoot class="text-sm">
          @for (line of summary(); track line.label; let first = $first) {
            <tr [class.font-semibold]="first" [class.text-foreground/75]="!first">
              <th scope="row" class="border-b px-1 py-2 text-left font-[inherit]" [class.border-t-2]="first">{{ line.label }}</th>
              @for (number of columns(); track number) {
                <td class="border-b px-1 py-2" [class.border-t-2]="first" [class.border-l]="number % 2 === 1" [class.bg-muted]="number === selectedNumber()" [class.italic]="isExpected(number)">{{ line.value(number) }}</td>
              }
            </tr>
          }
        </tfoot>
      </table>
    </div>
    @if (expectedNumber(); as number) {
      <p class="text-muted-foreground mt-3 text-xs">Semester {{ number }} is expected until the real Zeugnis is out.</p>
    }
    @if (!expectedNumber() && hasPendingSemester()) {
      <p class="text-muted-foreground mt-3 text-xs">This semester stays empty until the real Zeugnis is out.</p>
    }
  `,
})
export class GradesZeugnis {
  readonly group = input.required<GradeGroup>();
  readonly selectedKey = input<string | null>(null);
  readonly selected = output<string>();

  private readonly bySemester = computed(() => new Map(this.group().semesters.map((s) => [s.number, s])));
  protected readonly semesterAt = (number: number) => this.bySemester().get(number) ?? null;
  protected readonly isExpected = (number: number) => this.semesterAt(number)?.expected ?? false;
  protected readonly selectedNumber = computed(() => this.group().semesters.find((s) => s.key === this.selectedKey())?.number ?? null);
  protected readonly expectedNumber = computed(() => [...this.group().semesters].reverse().find((s) => s.expected)?.number ?? null);
  protected readonly hasPendingSemester = computed(() => this.group().semesters.some((s) => !s.report && !s.expected));

  // ponytail: an even number of columns, at least eight. Fewer years just leave empty columns.
  protected readonly columns = computed(() => {
    const last = Math.max(8, ...this.group().semesters.map((s) => s.number));
    return Array.from({ length: last + (last % 2) }, (_, i) => i + 1);
  });

  protected readonly years = computed(() => {
    const first = this.group().semesters[0];
    if (!first) return [];
    const startYear = first.yearStart;
    return this.columns()
      .filter((n) => n % 2 === 1)
      .map((n) => {
        const year = startYear + (n - 1) / 2;
        return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
      });
  });

  protected readonly rows = computed<Row[]>(() => {
    const seen = new Map<string, Map<number, SubjectResult>>();
    const names = new Map<string, SubjectResult>();
    // A semester with no report and no confirmed rules has nothing to print yet.
    for (const semester of this.group().semesters.filter((s) => s.report || s.expected)) {
      for (const subject of semester.subjects) {
        if (!seen.has(subject.key)) seen.set(subject.key, new Map());
        seen.get(subject.key)!.set(semester.number, subject);
        names.set(subject.key, subject);
      }
    }
    return [...seen].map(([key, cells]) => ({
      key,
      name: names.get(key)!.name,
      counted: names.get(key)!.counted,
      cells: this.columns().map((semester) => {
        const subject = cells.get(semester);
        return { semester, text: subject ? this.gradeText(subject) : '', low: (subject?.grade ?? 6) < 4 };
      }),
    }));
  });

  protected readonly summary = computed(() => {
    const text = (number: number, read: (s: SemesterResult) => string) => {
      const semester = this.semesterAt(number);
      return semester ? read(semester) : '';
    };
    const lines = [
      { label: 'Durchschnitt', value: (n: number) => text(n, (s) => (s.average != null ? oneDecimal(s.average) : '')) },
      { label: 'Promotion', value: (n: number) => text(n, (s) => (s.expected ? (hasPromotionDecisions(this.group()) ? 'offen' : '') : promotionText(s.report?.promotionDecision))) },
      { label: 'Negative Notenabweichung', value: (n: number) => text(n, (s) => (s.deviation ? String(s.deviation) : '')) },
      { label: 'Absenzen unentschuldigt', value: (n: number) => text(n, (s) => (s.report?.unexcusedAbsences != null ? String(s.report.unexcusedAbsences) : '')) },
    ];
    return lines.filter((line) => this.group().semesters.some((s) => line.value(s.number)));
  });

  private gradeText(subject: SubjectResult): string {
    if (subject.grade != null) return subject.grade.toFixed(1);
    return subject.marker ?? '';
  }
}
