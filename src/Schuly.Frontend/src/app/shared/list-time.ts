import { Component, computed, input } from '@angular/core';
import { isToday, startOfToday } from '../core/dates';
import { AppDatePipe, DatePreset } from '../core/date-format';

const WEEK_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Time of day for today's items, short date otherwise.
 * With `weekday`, items from the last week show the short weekday and older ones "d MMM" (plus the year when it differs), as mail and chat clients do.
 */
@Component({
  selector: 'app-list-time',
  imports: [AppDatePipe],
  template: `
    @if (value(); as v) {
      <time [attr.datetime]="v" class="tabular-nums whitespace-nowrap">{{ v | appDate: format() }}</time>
    }
  `,
})
export class ListTime {
  readonly value = input<string | null | undefined>(null);
  readonly weekday = input(false);
  protected readonly format = computed<DatePreset>(() => {
    const v = this.value();
    if (isToday(v)) return 'time';
    if (!this.weekday() || !v) return 'date';
    const date = new Date(v);
    const today = startOfToday();
    if (today.getTime() - date.getTime() <= WEEK_MS && date.getTime() <= Date.now()) return 'weekday';
    return date.getFullYear() === today.getFullYear() ? 'dayMonth' : 'date';
  });
}
