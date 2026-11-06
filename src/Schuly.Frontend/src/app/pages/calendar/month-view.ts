import { Component, computed, inject } from '@angular/core';
import { CalendarItem, WeekLayout, addDays, daysBetween, overlapsDay, sameDay, startOfDay, weekLayout } from '../../core/calendar';
import { CalendarStore } from '../../stores/calendar.store';
import { tint } from './tint';
import { AppDatePipe, formatWhen } from '../../core/date-format';

/** A busy day never makes its week taller: three lanes show, the rest is behind "+N". */
const MAX_LANES = 3;

interface MonthDay {
  date: Date;
  inMonth: boolean;
  today: boolean;
  selected: boolean;
  holiday: boolean;
  count: number;
  colors: string[];
}

interface MonthWeek {
  start: Date;
  days: MonthDay[];
  layout: WeekLayout;
}

@Component({
  selector: 'app-month-view',
  imports: [AppDatePipe],
  template: `
    <div class="overflow-hidden rounded-lg border">
      <div class="bg-muted/50 text-muted-foreground grid grid-cols-7 border-b text-xs font-medium">
        @for (name of weekdays(); track name) {
          <div class="px-2 py-1.5">{{ name }}</div>
        }
      </div>
      @for (week of weeks(); track week.start.getTime()) {
        <div
          class="grid h-16 grid-cols-7 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border-b last:border-b-0 sm:h-[8.5rem] sm:grid-rows-[auto_repeat(4,1.375rem)_minmax(0,1fr)]"
        >
          @for (day of week.days; track day.date.getTime(); let i = $index) {
            <button
              type="button"
              [class]="cellClass(day, i)"
              [style.grid-column]="i + 1"
              [style.background]="day.holiday && !day.selected ? holidayTint : null"
              style="grid-row: 1 / -1"
              [attr.aria-pressed]="day.selected"
              [attr.aria-label]="(day.date | appDate: 'full') + ', ' + day.count + (day.count === 1 ? ' entry' : ' entries')"
              (click)="calendar.selectDay(day.date)"
              (dblclick)="calendar.openDay(day.date)"
            ></button>
            <span
              class="pointer-events-none z-[1] px-1.5 pt-1.5 pb-0.5 text-xs tabular-nums"
              [class.text-muted-foreground]="!day.inMonth"
              [style.grid-column]="i + 1"
              style="grid-row: 1"
              aria-hidden="true"
            >
              <span [class]="day.today ? 'bg-primary text-primary-foreground inline-flex size-6 items-center justify-center rounded-full font-semibold' : 'inline-flex h-6 items-center px-1 font-medium'">{{
                day.date.getDate()
              }}</span>
            </span>
            <span class="pointer-events-none z-[1] flex gap-1 px-2 sm:hidden" [style.grid-column]="i + 1" style="grid-row: 2" aria-hidden="true">
              @for (color of day.colors; track $index) {
                <span class="size-1.5 rounded-full" [style.background]="color"></span>
              }
            </span>
          }
          @for (segment of week.layout.segments; track segment.item.id) {
            <button
              type="button"
              [class]="chipClass(segment.cutStart, segment.cutEnd)"
              [class.line-through]="segment.item.cancelled"
              [style.grid-column]="segment.start + 1 + ' / ' + (segment.end + 2)"
              [style.grid-row]="segment.lane + 2"
              [style.background]="tint(calendar.colors().get(segment.item.sourceId), 18)"
              [style.color]="calendar.colors().get(segment.item.sourceId)"
              [attr.title]="segment.item.title"
              (click)="calendar.select(segment.item.id)"
            >
              @if (!segment.item.allDay) {
                <span class="me-1 font-normal tabular-nums opacity-80">{{ segment.item.start | appDate: 'time' }}</span>
              }
              {{ segment.item.title }}
            </button>
          }
          @for (extra of week.layout.more; track $index; let i = $index) {
            @if (extra) {
              <button
                type="button"
                class="bg-muted text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/50 z-[1] mx-1 my-px hidden rounded-md border text-center text-xs font-medium outline-none focus-visible:ring-[3px] sm:block"
                [style.grid-column]="i + 1"
                [style.grid-row]="2 + maxLanes"
                [attr.aria-label]="extra + ' more on ' + (week.days[i].date | appDate: 'weekdayDayMonthLong')"
                (click)="calendar.selectDay(week.days[i].date)"
              >
                +{{ extra }}
              </button>
            }
          }
        </div>
      }
    </div>
  `,
})
export class MonthView {
  protected readonly calendar = inject(CalendarStore);
  protected readonly tint = tint;
  protected readonly maxLanes = MAX_LANES;
  protected readonly holidayTint = tint('var(--cal-holiday)', 10);

  protected readonly weekdays = computed(() => daysBetween(this.calendar.range().start, 7).map((day) => formatWhen(day, 'weekday')));

  protected readonly weeks = computed<MonthWeek[]>(() => {
    const { start } = this.calendar.range();
    const month = this.calendar.anchor().getMonth();
    const today = startOfDay(new Date());
    const items = this.calendar.visibleItems();
    const holidays = items.filter((item) => item.sourceId === 'holidays');
    const weeks: MonthWeek[] = [];
    for (let w = 0; w < 6; w++) {
      const weekStart = addDays(start, w * 7);
      // A last row that belongs entirely to the next month adds nothing.
      if (w > 3 && weekStart.getMonth() !== month) break;
      const days = daysBetween(weekStart, 7).map((date) => {
        const onDay = items.filter((item: CalendarItem) => overlapsDay(item, date));
        return {
          date,
          inMonth: date.getMonth() === month,
          today: sameDay(date, today),
          selected: sameDay(date, this.calendar.selectedDay()),
          holiday: holidays.some((item) => overlapsDay(item, date)),
          count: onDay.length,
          colors: onDay.slice(0, 4).map((item) => this.calendar.colors().get(item.sourceId) ?? 'currentColor'),
        };
      });
      weeks.push({ start: weekStart, days, layout: weekLayout(weekStart, items, MAX_LANES) });
    }
    return weeks;
  });

  protected cellClass(day: MonthDay, column: number): string {
    const base = 'hover:bg-accent/40 focus-visible:ring-ring/50 border-l text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset';
    const edge = column === 0 ? ' border-l-0' : '';
    if (day.selected) return `${base}${edge} bg-accent/70`;
    return day.inMonth ? `${base}${edge}` : `${base}${edge} bg-muted/30`;
  }

  protected chipClass(cutStart: boolean, cutEnd: boolean): string {
    const radius = `${cutStart ? 'rounded-l-none' : 'rounded-l-md'} ${cutEnd ? 'rounded-r-none' : 'rounded-r-md'}`;
    return `focus-visible:ring-ring/50 z-[1] mx-1 my-px hidden truncate px-1.5 text-left text-xs leading-[1.25rem] font-medium outline-none hover:brightness-110 focus-visible:ring-[3px] sm:block ${radius}`;
  }
}
