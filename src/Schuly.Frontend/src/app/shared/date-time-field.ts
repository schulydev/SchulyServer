import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, computed, input, model } from '@angular/core';
import { formatWhen, uiLocale } from '../core/date-format';
import { provideBrnCalendarI18n } from '@spartan-ng/brain/calendar';
import { HlmDatePickerImports, provideHlmDatePickerConfig } from '@spartan-ng/helm/date-picker';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { fromIsoDate, toIsoDate } from '../core/dates';

// Read the locale on every call, so a language switch reaches the picker too.
const DATE_FORMAT = { format: (date: Date) => formatWhen(date, 'weekdayDate') };
const weekday = (index: number) => formatWhen(new Date(2023, 0, 1 + index), 'weekday').replace('.', '').slice(0, 2);
const longMonth = (month: number, year = 2000) => new Date(year, month).toLocaleDateString(uiLocale(), { month: 'long' });

/** Local date and time as the app's date picker plus a time input. `date` is yyyy-mm-dd, `time` is HH:mm. */
@Component({
  selector: 'app-date-time-field',
  imports: [TranslatePipe, HlmDatePickerImports, HlmFieldImports, HlmInput],
  providers: [
    provideHlmDatePickerConfig<Date>({
      autoCloseOnSelect: true,
      formatDate: (date) => DATE_FORMAT.format(date),
      formatInputDate: (date) => DATE_FORMAT.format(date),
    }),
    provideBrnCalendarI18n({
      firstDayOfWeek: () => 1,
      formatWeekdayName: (index) => weekday(index),
      formatHeader: (month, year) => new Date(year, month).toLocaleDateString(uiLocale(), { month: 'long', year: 'numeric' }),
      formatMonth: (month) => longMonth(month),
      formatYear: (year) => String(year),
      months: () => Array.from({ length: 12 }, (_, i) => longMonth(i)) as never,
    }),
  ],
  template: `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div hlmField>
        <label hlmFieldLabel [for]="id() + '-date'">{{ 'shared.dateField.date' | translate: { label: label() } }}<span class="sr-only">, {{ dateLabel() }}</span></label>
        <hlm-date-picker [date]="picked()" [minDate]="minimum()" [autoCloseOnSelect]="true" (dateChange)="setDate($event)">
          <hlm-date-picker-trigger [buttonId]="id() + '-date'" class="w-full">{{ 'shared.dateField.pick' | translate }}</hlm-date-picker-trigger>
        </hlm-date-picker>
      </div>
      <div hlmField>
        <label hlmFieldLabel [for]="id() + '-time'">{{ 'shared.dateField.time' | translate: { label: label() } }}</label>
        <input hlmInput [id]="id() + '-time'" type="time" [value]="time()" (input)="time.set($any($event.target).value)" />
      </div>
    </div>
  `,
})
export class DateTimeField {
  readonly id = input.required<string>();
  readonly label = input('');
  readonly date = model('');
  readonly time = model('');
  /** Earliest selectable day (yyyy-mm-dd). */
  readonly min = input('');

  protected readonly picked = computed(() => fromIsoDate(this.date()));
  protected readonly minimum = computed(() => fromIsoDate(this.min()));
  protected readonly dateLabel = computed(() => {
    const d = this.picked();
    return d ? DATE_FORMAT.format(d) : t('shared.dateField.none');
  });

  protected setDate(date: Date | null | undefined): void {
    if (date) this.date.set(toIsoDate(date));
  }
}
