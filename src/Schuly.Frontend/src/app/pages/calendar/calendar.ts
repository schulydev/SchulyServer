import { SyncingNotice } from '../../shared/syncing-notice';
import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { CalendarItem, CalendarView, addDays, daySummary, lastDayOf, sameDay, startOfDay } from '../../core/calendar';
import { CalendarStore } from '../../stores/calendar.store';
import { DayList } from './day-list';
import { EventSheet } from './event-sheet';
import { MonthView } from './month-view';
import { WeekView } from './week-view';
import { AppDatePipe, formatWhen } from '../../core/date-format';

interface ListGroup {
  label: string;
  items: CalendarItem[];
}

@Component({
  selector: 'app-calendar',
  imports: [SyncingNotice, HlmAlertImports, HlmButton, HlmSpinner, HlmToggleGroupImports, NgIcon, AppDatePipe, MonthView, WeekView, DayList, EventSheet],
  providers: [CalendarStore, provideIcons({ lucideChevronLeft, lucideChevronRight, lucideTriangleAlert })],
  template: `
    <!-- From md up the page fits the screen: the grid takes what is left, only lists inside it scroll. -->
    <div class="flex flex-col gap-3 p-4 md:h-[calc(100dvh-var(--header-height))] lg:px-6">
      <app-syncing-notice />
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-semibold" aria-live="polite">{{ title() }}</h2>
        @if (calendar.loading()) {
          <hlm-spinner class="size-4" aria-label="Loading" />
        }
      </div>

      @for (source of calendar.problems(); track source.id) {
        <div hlmAlert variant="destructive">
          <ng-icon name="lucideTriangleAlert" hlmAlertIcon />
          <h3 hlmAlertTitle>{{ source.detail }}</h3>
          <p hlmAlertDescription>{{ source.problem }}</p>
        </div>
      }

      <div class="grid grid-cols-[minmax(0,1fr)] gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_17rem] md:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_20rem]">
      <!-- The day panel starts level with the grid, not with this row. -->
      <div class="flex min-w-0 flex-wrap items-center gap-2">
      <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        @for (source of calendar.sources(); track source.id) {
          <button
            type="button"
            class="hover:bg-accent focus-visible:ring-ring/50 inline-flex h-7 items-center gap-2 rounded-full border px-3 text-sm outline-none focus-visible:ring-[3px]"
            [class.text-muted-foreground]="hidden(source.id)"
            [class.bg-card]="!hidden(source.id)"
            [attr.aria-pressed]="!hidden(source.id)"
            [attr.title]="source.detail"
            (click)="calendar.toggleSource(source.id)"
          >
            <span class="size-2 rounded-full" [style.background]="source.color" [style.opacity]="hidden(source.id) ? 0.35 : 1" aria-hidden="true"></span>
            {{ source.label }}
            @if (source.problem) {
              <ng-icon name="lucideTriangleAlert" class="text-destructive" aria-hidden="true" />
              <span class="sr-only">(needs attention)</span>
            }
          </button>
        }
      </div>
        <div class="ml-auto flex items-center gap-1">
          <button hlmBtn variant="outline" size="icon-sm" aria-label="Previous" (click)="calendar.previous()">
            <ng-icon name="lucideChevronLeft" />
          </button>
          <button hlmBtn variant="outline" size="sm" (click)="calendar.today()">Today</button>
          <button hlmBtn variant="outline" size="icon-sm" aria-label="Next" (click)="calendar.next()">
            <ng-icon name="lucideChevronRight" />
          </button>
        </div>
      </div>
      <!-- Sits on top of the day panel, ending at its right edge. -->
      <div class="flex justify-end md:col-start-2 md:row-start-1">
        <hlm-toggle-group
          type="single"
          variant="outline"
          size="sm"
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


        @switch (calendar.view()) {
          @case ('month') {
            <app-month-view class="md:col-start-1" />
          }
          @case ('week') {
            <app-week-view class="md:col-start-1" />
          }
          @case ('list') {
            <div class="flex flex-col md:col-start-1 md:min-h-0 md:overflow-y-auto">
              @for (group of listGroups(); track group.label) {
                <h3 class="text-muted-foreground px-1 pt-4 pb-1 text-xs font-semibold first:pt-0">{{ group.label }}</h3>
                @for (item of group.items; track item.id) {
                  <button
                    type="button"
                    class="hover:bg-accent/50 focus-visible:ring-ring/50 grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border-b px-1 py-2 text-left outline-none focus-visible:ring-[3px]"
                    (click)="calendar.select(item.id)"
                  >
                    <span class="bg-muted flex size-[46px] flex-col items-center justify-center rounded-lg leading-tight" aria-hidden="true">
                      <span class="text-muted-foreground text-[11px] uppercase">{{ item.start | appDate: 'weekday' }}</span>
                      <span class="text-lg font-semibold tabular-nums">{{ item.start.getDate() }}</span>
                    </span>
                    <span class="grid min-w-0 gap-0.5">
                      <span class="truncate text-sm font-medium" [class.line-through]="item.cancelled">{{ item.title }}</span>
                      <span class="text-muted-foreground truncate text-xs">{{ when(item) }}</span>
                    </span>
                    <span class="text-xs font-medium" [style.color]="calendar.colors().get(item.sourceId)">{{ kind(item) }}</span>
                  </button>
                }
              } @empty {
                <p class="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">Nothing coming up in the next four weeks.</p>
              }
            </div>
          }
        }
        <section class="bg-card/50 flex h-fit flex-col overflow-hidden rounded-lg border md:col-start-2 md:row-start-2 md:max-h-full" aria-labelledby="selected-day" aria-live="polite">
          <!-- The date stays put; only the entries below it scroll. -->
          <div class="bg-card flex-none border-b px-4 py-3">
            <h3 id="selected-day" class="text-sm font-semibold">
              {{ calendar.selectedDay() | appDate: 'weekdayDayMonthLong' }}{{ isToday() ? ' · Today' : '' }}
            </h3>
            @if (summary()) {
              <p class="text-muted-foreground mt-0.5 text-xs">{{ summary() }}</p>
            }
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <app-day-list [items]="calendar.selectedDayItems()" />
          </div>
        </section>
      </div>
    </div>
    <app-event-sheet />
  `,
})
export class Calendar {
  protected readonly calendar = inject(CalendarStore);

  protected readonly title = computed(() => {
    const { start, end } = this.calendar.range();
    const view = this.calendar.view();
    if (view === 'month') return formatWhen(this.calendar.anchor(), 'monthYearLong');
    if (view === 'list') return `From ${formatWhen(start, 'dayMonth')}`;
    return `${formatWhen(start, 'dayMonth')} - ${formatWhen(addDays(end, -1), 'date')}`;
  });

  protected readonly isToday = computed(() => sameDay(this.calendar.selectedDay(), startOfDay(new Date())));

  protected readonly summary = computed(() => daySummary(this.calendar.selectedDay(), this.calendar.selectedDayAll(), (date) => formatWhen(date, 'time')));

  /** Only what stands out: tests, events, holidays and linked calendars, from today on, grouped by month. */
  protected readonly listGroups = computed<ListGroup[]>(() => {
    const now = new Date();
    const groups: ListGroup[] = [];
    for (const item of this.calendar.visibleItems()) {
      if (item.sourceId === 'lessons' || item.end <= now) continue;
      const label = formatWhen(item.start, 'monthYearLong');
      const group = groups.find((g) => g.label === label) ?? groups[groups.push({ label, items: [] }) - 1];
      group.items.push(item);
    }
    return groups;
  });

  protected hidden(id: string): boolean {
    return this.calendar.hidden().includes(id);
  }

  protected when(item: CalendarItem): string {
    const last = lastDayOf(item);
    const day = formatWhen(item.start, 'weekdayDayMonth');
    if (item.allDay) return sameDay(last, item.start) ? day : `${day} - ${formatWhen(last, 'weekdayDayMonth')}`;
    const place = item.location ? ` · ${item.location}` : '';
    return `${day} · ${formatWhen(item.start, 'time')} - ${formatWhen(item.end, 'time')}${place}`;
  }

  protected kind(item: CalendarItem): string {
    return this.calendar.sources().find((source) => source.id === item.sourceId)?.label ?? '';
  }

  protected setView(value: unknown): void {
    if (value === 'month' || value === 'week' || value === 'list') this.calendar.setView(value as CalendarView);
  }
}
