import { Component, computed, input } from '@angular/core';
import { AppDatePipe } from '../core/date-format';
import { ExamGrade, cleanExamName, isGraded, subjectLabel } from '../core/grade-report';
import { gradeTone } from './grades-tone';

/** One exam: name, date, how it compares with the class, and the grade. */
@Component({
  selector: 'app-grades-exam-row',
  imports: [AppDatePipe],
  template: `
    <div class="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 py-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_3.25rem]">
      <div class="min-w-0 wrap-anywhere">
        {{ title() }}
        @if (row().weighting !== 1) {
          <span class="text-primary ml-1 text-xs font-medium whitespace-nowrap">Weight {{ row().weighting }}</span>
        }
        @if (showSubject()) {
          <div class="text-muted-foreground text-sm">{{ subject() }}</div>
        }
      </div>
      <div class="text-muted-foreground col-start-1 text-xs tabular-nums sm:col-start-auto sm:text-sm">
        @if (row().date) {
          {{ row().date | appDate: 'date' }}
        } @else {
          No date
        }
      </div>
      <div class="text-muted-foreground col-start-1 text-xs tabular-nums sm:col-start-auto sm:text-sm">
        @if (hasClassAverage()) {
          Class {{ classAverage() }}
          @if (difference(); as diff) {
            <span [class]="diff.better ? 'text-green-700 dark:text-green-400' : 'text-destructive'">{{ diff.text }}</span>
          }
        }
      </div>
      @if (graded()) {
        <span class="col-start-2 row-start-1 min-w-11 justify-self-end rounded-lg px-2 py-0.5 text-center text-sm font-semibold tabular-nums sm:col-start-auto sm:row-start-auto" [class]="tone()">{{ row().score.toFixed(1) }}</span>
      } @else {
        <span class="text-muted-foreground col-start-2 row-start-1 justify-self-end text-right text-xs sm:col-start-auto sm:row-start-auto">Not graded</span>
      }
    </div>
  `,
})
export class GradesExamRow {
  readonly row = input.required<ExamGrade>();
  readonly classNames = input<string[]>([]);
  readonly showSubject = input(false);

  protected readonly subject = computed(() => subjectLabel(this.row().subject));
  protected readonly graded = computed(() => isGraded(this.row().score));
  protected readonly tone = computed(() => gradeTone(this.row().score));
  protected readonly hasClassAverage = computed(() => isGraded(this.row().classAverage));
  protected readonly classAverage = computed(() => (this.row().classAverage ?? 0).toFixed(1));

  protected readonly title = computed(() => {
    const name = cleanExamName(this.row().exam, this.row().subject, this.classNames());
    // Modules arrive with one grade named after the module itself.
    return subjectLabel(name) === this.subject() ? 'Grade' : name;
  });

  protected readonly difference = computed(() => {
    const row = this.row();
    if (!this.graded() || !this.hasClassAverage()) return null;
    const value = row.score - (row.classAverage ?? 0);
    if (Math.abs(value) < 0.05) return null;
    return { better: value > 0, text: `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}` };
  });
}
