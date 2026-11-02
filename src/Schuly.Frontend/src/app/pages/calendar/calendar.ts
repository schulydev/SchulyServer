import { SyncingNotice } from '../../shared/syncing-notice';
import { LinkedAccountsStore } from '../../stores/linked-accounts.store';
import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { CalendarView, addDays, daysBetween, overlapsDay } from '../../core/calendar';
import { CalendarStore } from '../../stores/calendar.store';
import { DayList } from './day-list';
import { EventSheet } from './event-sheet';
import { MonthView } from './month-view';
import { WeekView } from './week-view';
import { AppDatePipe, formatWhen } from '../../core/date-format';

@Component({
  selector: 'app-calendar',
  imports: [SyncingNotice, 
    HlmAlertImports,
    HlmButton,
    HlmSpinner,
    HlmToggleGroupImports,
    NgIcon,
    AppDatePipe,
    MonthView,
    WeekView,
    DayList,
    EventSheet,
  ],
  providers: [
    CalendarStore,
    provideIcons({ lucideChevronLeft, lucideChevronRight, lucideTriangleAlert }),
  ],
  template: `
    <div class="flex flex-col gap-4 p-4 lg:p-6">
      <app-syncing-notice />
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-1">
          <button
            hlmBtn
            variant="outline"
            size="icon"
            aria-label="Previous"
            (click)="calendar.previous()"
          >
            <ng-icon name="lucideChevronLeft" />
          </button>
          <button hlmBtn variant="outline" (click)="calendar.today()">Today</button>
          <button hlmBtn variant="outline" size="icon" aria-label="Next" (click)="calendar.next()">
            <ng-icon name="lucideChevronRight" />
          </button>
        </div>
        <h2 class="text-lg font-semibold" aria-live="polite">{{ title() }}</h2>
        @if (calendar.loading()) {
          <hlm-spinner class="size-4" aria-label="Loading" />
        }
        <hlm-toggle-group
          type="single"
          variant="outline"
          size="sm"
          class="ml-auto"
          [nullable]="false"
          [value]="calendar.view()"
          (valueChange)="setView($event)"
          aria-label="Calendar view"
        >
          <button hlmToggleGroupItem value="month" class="px-3">Month</button>
          <button hlmToggleGroupItem value="week" class="px-3">Week</button>
          <button hlmToggleGroupItem value="list" class="px-3">List</button>
        </hlm-toggle-group>
      </div>

      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Calendars">
        @for (source of calendar.sources(); track source.id) {
          <button
            hlmBtn
            variant="outline"
            size="sm"
            class="gap-2"
            [class.opacity-60]="hidden(source.id)"
            [attr.aria-pressed]="!hidden(source.id)"
            [attr.title]="source.detail"
            (click)="calendar.toggleSource(source.id)"
          >
            <span
              class="size-2.5 rounded-full border-2"
              [style.border-color]="source.color"
              [style.background]="hidden(source.id) ? 'transparent' : source.color"
              aria-hidden="true"
            ></span>
            {{ source.label }}
            @if (source.problem) {
              <ng-icon name="lucideTriangleAlert" class="text-destructive" aria-hidden="true" />
              <span class="sr-only">(needs attention)</span>
            }
          </button>
        }
      </div>

      @for (source of calendar.problems(); track source.id) {
        <div hlmAlert variant="destructive">
          <ng-icon name="lucideTriangleAlert" hlmAlertIcon />
          <h3 hlmAlertTitle>{{ source.detail }}</h3>
          <p hlmAlertDescription>{{ source.problem }}</p>
        </div>
      }

      @if (
        calendar.feedAvailable() && !calendar.feedLoading() && !calendar.accounts().length && !linked.loading()
      ) {
        <p class="text-muted-foreground text-sm">
          Link an account in Settings to see its calendar here too.
        </p>
      }

      @switch (calendar.view()) {
        @case ('month') {
          <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <app-month-view />
            <section class="h-fit overflow-hidden rounded-lg border" aria-labelledby="selected-day">
              <h3 id="selected-day" class="bg-muted/50 border-b px-4 py-2.5 text-sm font-medium">
                {{ calendar.selectedDay() | appDate: 'weekdayDayMonthLong' }}
              </h3>
              <app-day-list [items]="calendar.selectedDayItems()" />
            </section>
          </div>
        }
        @case ('week') {
          <app-week-view />
        }
        @case ('list') {
          <div class="flex flex-col gap-4">
            @for (day of listDays(); track day.date.getTime()) {
              <section
                class="overflow-hidden rounded-lg border"
                [attr.aria-label]="day.date | appDate: 'full'"
              >
                <h3 class="bg-muted/50 border-b px-4 py-2.5 text-sm font-medium">
                  {{ day.date | appDate: 'weekdayDayMonthLong' }}
                </h3>
                <app-day-list [items]="day.items" />
              </section>
            } @empty {
              <p
                class="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm"
              >
                Nothing planned in the next four weeks.
              </p>
            }
          </div>
        }
      }
    </div>
    <app-event-sheet />
  `,
})
export class Calendar {
  protected readonly calendar = inject(CalendarStore);
  protected readonly linked = inject(LinkedAccountsStore);

  protected readonly title = computed(() => {
    const { start, end } = this.calendar.range();
    const view = this.calendar.view();
    if (view === 'month') return formatWhen(this.calendar.anchor(), 'monthYearLong');
    return `${formatWhen(start, 'dayMonth')} - ${formatWhen(addDays(end, -1), 'date')}`;
  });

  protected readonly listDays = computed(() => {
    const items = this.calendar.visibleItems();
    return daysBetween(this.calendar.range().start, 28)
      .map((date) => ({ date, items: items.filter((item) => overlapsDay(item, date)) }))
      .filter((day) => day.items.length);
  });

  protected hidden(id: string): boolean {
    return this.calendar.hidden().includes(id);
  }

  protected setView(value: unknown): void {
    if (value === 'month' || value === 'week' || value === 'list')
      this.calendar.setView(value as CalendarView);
  }
}
