import {
  afterNextRender,
  computed,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { formatWhen, uiLocale } from '../core/date-format';
import { form, FormField, FormRoot, validate } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSend } from '@ng-icons/lucide';
import { provideBrnCalendarI18n } from '@spartan-ng/brain/calendar';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmDatePickerImports, provideHlmDatePickerConfig } from '@spartan-ng/helm/date-picker';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { fromIsoDate, startOfToday, toIsoDate } from '../core/dates';
import {
  AbsenceReportRequest,
  AbsenceReportsStore,
  absenceErrorMessage,
} from '../stores/absence-reports.store';

const MAX_LENGTH = 500;
const OTHER_REASON = '__other__';
const NO_REASON = '__none__';

const LOCALE = uiLocale();
const DATE_FORMAT = { format: (date: Date) => formatWhen(date, 'weekdayDate', LOCALE) };
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => formatWhen(new Date(2023, 0, 1 + i), 'weekday', LOCALE).replace('.', '').slice(0, 2));
const longMonth = (month: number, year = 2000) =>
  new Date(year, month).toLocaleDateString(LOCALE, { month: 'long' });

interface ReportModel {
  dateFrom: string;
  dateTo: string;
  partial: boolean;
  timeFrom: string;
  timeTo: string;
  reasonChoice: string;
  reason: string;
  comment: string;
}

const emptyModel = (): ReportModel => {
  const today = toIsoDate(startOfToday());
  return {
    dateFrom: today,
    dateTo: today,
    partial: false,
    timeFrom: '',
    timeTo: '',
    reasonChoice: '',
    reason: '',
    comment: '',
  };
};

@Component({
  selector: 'app-absence-report-dialog',
  imports: [
    FormRoot,
    FormField,
    NgIcon,
    HlmAlertImports,
    HlmButton,
    HlmDialogImports,
    HlmFieldImports,
    HlmInput,
    HlmDatePickerImports,
    HlmSelectImports,
    HlmSpinner,
    HlmSwitch,
    HlmTextarea,
  ],
  providers: [
    provideIcons({ lucideSend }),
    provideHlmDatePickerConfig<Date>({
      autoCloseOnSelect: true,
      formatDate: (date) => DATE_FORMAT.format(date),
      formatInputDate: (date) => DATE_FORMAT.format(date),
    }),
    provideBrnCalendarI18n({
      firstDayOfWeek: () => 1,
      formatWeekdayName: (index) => WEEKDAYS[index],
      formatHeader: (month, year) =>
        new Date(year, month).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }),
      formatMonth: (month) => longMonth(month),
      formatYear: (year) => String(year),
      months: () => Array.from({ length: 12 }, (_, i) => longMonth(i)) as never,
    }),
  ],
  template: `
    <button hlmBtn type="button" (click)="show()">
      <ng-icon name="lucideSend" aria-hidden="true" />
      Report absence
    </button>

    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Report an absence</h2>
          <p hlmDialogDescription>
            This is sent to your school and appears for each of your classes. You can
            withdraw it until the school has processed it.
          </p>
        </hlm-dialog-header>

        <form [formRoot]="report" class="flex flex-col gap-4" [attr.aria-busy]="submitting()">
          <fieldset class="flex flex-col gap-4" [disabled]="submitting()">
            @if (reports.accounts().length > 1) {
              <div hlmField>
                <label hlmFieldLabel for="absence-account">School</label>
                <hlm-select [value]="accountId()" [itemToString]="accountLabel" (valueChange)="accountId.set($event ?? '')">
                  <hlm-select-trigger buttonId="absence-account" class="w-full">
                    <hlm-select-value />
                  </hlm-select-trigger>
                  <hlm-select-content *hlmSelectPortal>
                    <hlm-select-group>
                      @for (account of reports.accounts(); track account.id) {
                        <hlm-select-item [value]="account.id">{{ account.title }}</hlm-select-item>
                      }
                    </hlm-select-group>
                  </hlm-select-content>
                </hlm-select>
              </div>
            }

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div hlmField>
                <label hlmFieldLabel for="absence-from"
                  >From<span class="sr-only">, {{ dateLabel(model().dateFrom) }}</span></label
                >
                <hlm-date-picker
                  [date]="fromDate()"
                  [autoCloseOnSelect]="true"
                  (dateChange)="setFrom($event)"
                >
                  <hlm-date-picker-trigger buttonId="absence-from" class="w-full">
                    Pick a date
                  </hlm-date-picker-trigger>
                </hlm-date-picker>
                @if (report.dateFrom().touched() && report.dateFrom().invalid()) {
                  <hlm-field-error>{{ report.dateFrom().errors()[0]?.message }}</hlm-field-error>
                }
              </div>
              <div hlmField>
                <label hlmFieldLabel for="absence-to"
                  >To<span class="sr-only">, {{ dateLabel(model().dateTo) }}</span></label
                >
                <hlm-date-picker
                  [date]="toDate()"
                  [minDate]="fromDate()"
                  [autoCloseOnSelect]="true"
                  (dateChange)="setTo($event)"
                >
                  <hlm-date-picker-trigger buttonId="absence-to" class="w-full">
                    Pick a date
                  </hlm-date-picker-trigger>
                </hlm-date-picker>
                @if (report.dateTo().touched() && report.dateTo().invalid()) {
                  <hlm-field-error>{{ report.dateTo().errors()[0]?.message }}</hlm-field-error>
                }
              </div>
            </div>

            <div class="flex items-center gap-2">
              <hlm-switch
                inputId="absence-partial"
                [checked]="model().partial"
                (checkedChange)="setPartial($event)"
              />
              <label for="absence-partial" class="text-sm">Only some lessons</label>
            </div>

            @if (model().partial) {
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="absence-time-from">From time</label>
                  <input
                    hlmInput
                    id="absence-time-from"
                    type="time"
                    [formField]="report.timeFrom"
                  />
                  @if (report.timeFrom().touched() && report.timeFrom().invalid()) {
                    <hlm-field-error>{{ report.timeFrom().errors()[0]?.message }}</hlm-field-error>
                  }
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="absence-time-to">To time</label>
                  <input hlmInput id="absence-time-to" type="time" [formField]="report.timeTo" />
                  @if (report.timeTo().touched() && report.timeTo().invalid()) {
                    <hlm-field-error>{{ report.timeTo().errors()[0]?.message }}</hlm-field-error>
                  }
                </div>
              </div>
            }

            <div hlmField>
              <div class="flex items-center gap-2">
                <label hlmFieldLabel for="absence-reason-choice">Reason (optional)</label>
                @if (reasonsLoading()) {
                  <hlm-spinner aria-hidden="true" class="size-3.5" />
                  <span class="sr-only" role="status">Loading reasons</span>
                }
              </div>
              <hlm-select
                [disabled]="reasonsLoading()"
                [attr.aria-busy]="reasonsLoading()"
                [value]="model().reasonChoice || noReason"
                [itemToString]="reasonLabel"
                (valueChange)="setReasonChoice($event === noReason ? '' : ($event ?? ''))"
              >
                <hlm-select-trigger buttonId="absence-reason-choice" class="w-full">
                  <hlm-select-value />
                </hlm-select-trigger>
                <hlm-select-content *hlmSelectPortal>
                  <hlm-select-group>
                    <hlm-select-item [value]="noReason">No reason</hlm-select-item>
                    @for (reason of reasonOptions(); track reason) {
                      <hlm-select-item [value]="reason">{{ reason }}</hlm-select-item>
                    }
                    <hlm-select-item [value]="otherReason">Other…</hlm-select-item>
                  </hlm-select-group>
                </hlm-select-content>
              </hlm-select>
            </div>

            @if (model().reasonChoice === otherReason) {
              <div hlmField>
                <label hlmFieldLabel for="absence-reason">Your reason</label>
                <input
                  #customReason
                  hlmInput
                  id="absence-reason"
                  autocomplete="off"
                  aria-required="true"
                  [formField]="report.reason"
                />
                @if (report.reason().touched() && report.reason().invalid()) {
                  <hlm-field-error>{{ report.reason().errors()[0]?.message }}</hlm-field-error>
                }
              </div>
            }

            <div hlmField>
              <label hlmFieldLabel for="absence-comment">Comment (optional)</label>
              <textarea
                hlmTextarea
                id="absence-comment"
                rows="3"
                [formField]="report.comment"
              ></textarea>
              @if (report.comment().touched() && report.comment().invalid()) {
                <hlm-field-error>{{ report.comment().errors()[0]?.message }}</hlm-field-error>
              }
            </div>
          </fieldset>

          @if (error()) {
            <div hlmAlert variant="destructive" role="alert">
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }

          <hlm-dialog-footer>
            <button
              hlmBtn
              variant="outline"
              type="button"
              [disabled]="submitting()"
              (click)="open.set(false)"
            >
              Cancel
            </button>
            <button hlmBtn type="submit" [disabled]="submitting()" [attr.aria-busy]="submitting()">
              @if (submitting()) {
                <hlm-spinner aria-hidden="true" />
              }
              Send report
            </button>
          </hlm-dialog-footer>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class AbsenceReportDialog {
  protected readonly reports = inject(AbsenceReportsStore);
  private readonly injector = inject(Injector);
  private readonly customReason = viewChild<ElementRef<HTMLInputElement>>('customReason');

  protected readonly reasonOptions = signal<string[]>([]);
  protected readonly reasonsLoading = signal(false);
  protected readonly otherReason = OTHER_REASON;
  protected readonly noReason = NO_REASON;

  /** The trigger shows the selected item's label, never its raw value. */
  protected readonly reasonLabel = (value: string): string =>
    value === NO_REASON ? 'No reason' : value === OTHER_REASON ? 'Other…' : value;
  protected readonly accountLabel = (id: string): string => this.reports.accounts().find((a) => a.id === id)?.title ?? id;

  protected readonly open = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly accountId = signal('');

  protected readonly model = signal<ReportModel>(emptyModel());
  private lastFrom = this.model().dateFrom;
  protected readonly fromDate = computed(() => fromIsoDate(this.model().dateFrom));
  protected readonly toDate = computed(() => fromIsoDate(this.model().dateTo));

  protected readonly report = form(
    this.model,
    (path) => {
      validate(path.dateFrom, ({ value }) =>
        value() ? undefined : { kind: 'required', message: 'Choose a start date.' },
      );
      validate(path.dateTo, ({ value, valueOf }) => {
        if (!value()) return { kind: 'required', message: 'Choose an end date.' };
        const from = valueOf(path.dateFrom);
        return from && value() < from
          ? { kind: 'range', message: 'The end date cannot be before the start date.' }
          : undefined;
      });
      validate(path.timeFrom, ({ valueOf }) =>
        valueOf(path.partial) && !valueOf(path.timeFrom)
          ? { kind: 'required', message: 'Choose a start time.' }
          : undefined,
      );
      validate(path.timeTo, ({ valueOf }) => {
        if (!valueOf(path.partial)) return undefined;
        const to = valueOf(path.timeTo);
        if (!to) return { kind: 'required', message: 'Choose an end time.' };
        const sameDay = valueOf(path.dateFrom) === valueOf(path.dateTo);
        return sameDay && valueOf(path.timeFrom) && to <= valueOf(path.timeFrom)
          ? { kind: 'range', message: 'The end time must be after the start time.' }
          : undefined;
      });
      validate(path.reason, ({ value, valueOf }) => {
        if (valueOf(path.reasonChoice) !== OTHER_REASON) return undefined;
        if (!value().trim()) return { kind: 'required', message: 'Enter your reason.' };
        return value().length > MAX_LENGTH
          ? { kind: 'maxLength', message: `Use ${MAX_LENGTH} characters or fewer.` }
          : undefined;
      });
      validate(path.comment, ({ value }) =>
        value().length > MAX_LENGTH
          ? { kind: 'maxLength', message: `Use ${MAX_LENGTH} characters or fewer.` }
          : undefined,
      );
    },
    { submission: { action: () => this.send() } },
  );

  constructor() {
    effect(() => {
      const id = this.accountId();
      if (this.open() && id) untracked(() => void this.loadReasons(id));
    });
  }

  private async loadReasons(accountId: string): Promise<void> {
    this.reasonsLoading.set(true);
    const reasons = await this.reports.loadReasons(accountId);
    if (this.accountId() !== accountId) return;
    this.reasonOptions.set(reasons);
    this.reasonsLoading.set(false);
    const { reasonChoice } = this.model();
    if (reasonChoice && reasonChoice !== OTHER_REASON && !reasons.includes(reasonChoice)) {
      this.model.update((m) => ({ ...m, reasonChoice: '', reason: '' }));
    }
  }

  protected submitting(): boolean {
    return this.report().submitting();
  }

  protected show(): void {
    this.model.set(emptyModel());
    this.lastFrom = this.model().dateFrom;
    this.error.set(null);
    this.accountId.set(this.reports.accounts()[0]?.id ?? '');
    this.report().reset();
    this.open.set(true);
  }

  protected dateLabel(value: string): string {
    const date = fromIsoDate(value);
    return date ? DATE_FORMAT.format(date) : 'no date chosen';
  }

  protected setFrom(date: Date | null): void {
    this.model.update((m) => ({ ...m, dateFrom: date ? toIsoDate(date) : '' }));
    this.report.dateFrom().markAsTouched();
    this.fromChanged();
  }

  protected setTo(date: Date | null): void {
    this.model.update((m) => ({ ...m, dateTo: date ? toIsoDate(date) : '' }));
    this.report.dateTo().markAsTouched();
  }

  private fromChanged(): void {
    const { dateFrom, dateTo } = this.model();
    if (!dateTo || dateTo === this.lastFrom || dateTo < dateFrom) {
      this.model.update((m) => ({ ...m, dateTo: dateFrom }));
    }
    this.lastFrom = dateFrom;
  }

  protected setPartial(partial: boolean): void {
    this.model.update((m) => ({ ...m, partial }));
  }

  protected setReasonChoice(reasonChoice: string): void {
    this.model.update((m) => ({ ...m, reasonChoice, reason: '' }));
    if (reasonChoice === OTHER_REASON) {
      afterNextRender(() => this.customReason()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }

  private async send(): Promise<undefined> {
    this.error.set(null);
    const m = this.model();
    const request: AbsenceReportRequest = { dateFrom: m.dateFrom, dateTo: m.dateTo };
    if (m.partial) {
      request.hourFrom = m.timeFrom;
      request.hourTo = m.timeTo;
    }
    const reason = m.reasonChoice === OTHER_REASON ? m.reason.trim() : m.reasonChoice;
    if (reason) request.reason = reason;
    if (m.comment.trim()) request.comment = m.comment.trim();
    try {
      await this.reports.report(this.accountId() || this.reports.accounts()[0].id, request);
    } catch (error) {
      this.error.set(absenceErrorMessage(error, 'Could not send the report. Try again.'));
      return undefined;
    }
    this.open.set(false);
    toast.success('Absence reported to your school.');
    await this.reports.refresh();
    return undefined;
  }
}
