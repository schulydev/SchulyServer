import { Component, computed, inject } from '@angular/core';
import { CalendarItem, daysBetween, overlapsDay, sameDay, startOfDay } from '../../core/calendar';
import { CalendarStore } from '../../stores/calendar.store';
import { tint } from './tint';
import { AppDatePipe, formatWhen } from '../../core/date-format';

interface MonthCell {
  date: Date;
  inMonth: boolean;
  today: boolean;
  selected: boolean;
  items: CalendarItem[];
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
      <div class="grid grid-cols-7">
        @for (cell of cells(); track cell.date.getTime()) {
          <div [class]="cellClass(cell)">
            <button
              type="button"
              [class]="dayClass(cell)"
              [attr.aria-pressed]="cell.selected"
              [attr.aria-label]="
                (cell.date | appDate: 'full') +
                ', ' +
                cell.items.length +
                (cell.items.length === 1 ? ' entry' : ' entries')
              "
              (click)="calendar.selectDay(cell.date)"
              (dblclick)="calendar.openDay(cell.date)"
            >
              {{ cell.date.getDate() }}
            </button>
            <div class="flex flex-wrap gap-1 px-1 sm:hidden" aria-hidden="true">
              @for (item of cell.items.slice(0, 4); track item.id) {
                <span
                  class="size-1.5 rounded-full"
                  [style.background]="calendar.colors().get(item.sourceId)"
                ></span>
              }
            </div>
            @for (item of cell.items.slice(0, 3); track item.id) {
              <button
                type="button"
                class="hover:bg-accent hidden w-full truncate rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-xs sm:block"
                [class.line-through]="item.cancelled"
                [style.border-left-color]="calendar.colors().get(item.sourceId)"
                [style.background]="tint(calendar.colors().get(item.sourceId))"
                (click)="calendar.select(item.id)"
              >
                @if (!item.allDay && sameDay(item.start, cell.date)) {
                  <span class="text-muted-foreground tabular-nums">{{
                    item.start | appDate: 'time'
                  }}</span>
                }
                {{ item.title }}
              </button>
            }
            @if (cell.items.length > 3) {
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground hidden px-1.5 text-left text-xs sm:block"
                (click)="calendar.selectDay(cell.date)"
              >
                +{{ cell.items.length - 3 }} more
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class MonthView {
  protected readonly calendar = inject(CalendarStore);
  protected readonly tint = tint;
  protected readonly sameDay = sameDay;

  protected readonly weekdays = computed(() => {
    const monday = this.calendar.range().start;
    return daysBetween(monday, 7).map((day) => formatWhen(day, 'weekday'));
  });

  protected readonly cells = computed<MonthCell[]>(() => {
    const { start } = this.calendar.range();
    const month = this.calendar.anchor().getMonth();
    const today = startOfDay(new Date());
    const items = this.calendar.visibleItems();
    return daysBetween(start, 42).map((date) => ({
      date,
      inMonth: date.getMonth() === month,
      today: sameDay(date, today),
      selected: sameDay(date, this.calendar.selectedDay()),
      items: items
        .filter((item) => overlapsDay(item, date))
        .sort(
          (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime(),
        ),
    }));
  });

  protected cellClass(cell: MonthCell): string {
    const base =
      'flex min-h-16 flex-col gap-0.5 border-r border-b p-1 sm:min-h-28 [&:nth-child(7n)]:border-r-0';
    if (cell.selected) return `${base} bg-accent/50`;
    return cell.inMonth ? base : `${base} bg-muted/30 text-muted-foreground`;
  }

  protected dayClass(cell: MonthCell): string {
    const base =
      'focus-visible:ring-ring/50 inline-flex size-7 items-center justify-center self-start rounded-full text-xs tabular-nums outline-none focus-visible:ring-[3px]';
    return cell.today
      ? `${base} bg-primary text-primary-foreground font-semibold`
      : `${base} hover:bg-accent`;
  }
}
