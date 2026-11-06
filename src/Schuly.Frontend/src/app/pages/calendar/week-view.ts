import { Component, computed, inject } from '@angular/core';
import {
  HOUR_HEIGHT,
  PlacedItem,
  daysBetween,
  overlapsDay,
  placeTimedItems,
  sameDay,
  startOfDay,
} from '../../core/calendar';
import { CalendarStore } from '../../stores/calendar.store';
import { tint } from './tint';
import { AppDatePipe } from '../../core/date-format';

@Component({
  selector: 'app-week-view',
  imports: [AppDatePipe],
  host: { class: 'block md:min-h-0 md:flex-1' },
  template: `
    <div class="overflow-x-auto rounded-lg border md:flex md:h-full md:flex-col">
      <div class="min-w-[44rem] md:flex md:min-h-0 md:flex-1 md:flex-col">
        <div class="bg-muted/50 grid border-b" [style.grid-template-columns]="columns()">
          <div></div>
          @for (day of days(); track day.date.getTime()) {
            <button
              type="button"
              class="hover:bg-accent focus-visible:ring-ring/50 flex flex-col items-center gap-0.5 py-1.5 outline-none focus-visible:ring-[3px]"
              [attr.aria-pressed]="day.selected"
              (click)="calendar.selectDay(day.date)"
            >
              <span class="text-muted-foreground text-xs">{{ day.date | appDate: 'weekday' }}</span>
              <span
                [class]="
                  day.today
                    ? 'bg-primary text-primary-foreground inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold'
                    : 'inline-flex size-7 items-center justify-center text-sm'
                "
              >
                {{ day.date.getDate() }}
              </span>
            </button>
          }
        </div>

        @if (hasAllDay()) {
          <div class="grid border-b" [style.grid-template-columns]="columns()">
            <div class="text-muted-foreground self-center pr-2 text-right text-[0.65rem]">
              All day
            </div>
            @for (day of days(); track day.date.getTime()) {
              <div class="flex min-w-0 flex-col gap-0.5 border-l p-0.5">
                @for (item of day.allDay; track item.id) {
                  <button
                    type="button"
                    class="hover:bg-accent truncate rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-xs"
                    [style.border-left-color]="calendar.colors().get(item.sourceId)"
                    [style.background]="tint(calendar.colors().get(item.sourceId))"
                    (click)="calendar.select(item.id)"
                  >
                    {{ item.title }}
                  </button>
                }
              </div>
            }
          </div>
        }

        <div class="max-h-[65vh] overflow-y-auto md:max-h-none md:min-h-0 md:flex-1">
          <div
            class="grid"
            [style.grid-template-columns]="columns()"
            [style.height.px]="hours().length * hourHeight"
          >
            <div class="relative">
              @for (hour of hours(); track hour; let i = $index) {
                <span
                  class="text-muted-foreground absolute right-2 -translate-y-1/2 text-[0.65rem] tabular-nums"
                  [style.top.px]="i * hourHeight"
                >
                  @if (i > 0) {
                    {{ hour.toString().padStart(2, '0') }}:00
                  }
                </span>
              }
            </div>
            @for (day of days(); track day.date.getTime()) {
              <div
                class="relative border-l"
                [style.background-image]="gridLines"
                [style.background-size]="'100% ' + hourHeight + 'px'"
              >
                @for (placed of day.timed; track placed.item.id) {
                  <button
                    type="button"
                    class="hover:z-10 focus-visible:ring-ring/50 absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs leading-tight outline-none focus-visible:z-10 focus-visible:ring-[3px]"
                    [class.line-through]="placed.item.cancelled"
                    [style.top.px]="placed.top + 1"
                    [style.height.px]="placed.height - 2"
                    [style.left]="'calc(' + (placed.column / placed.columns) * 100 + '% + 2px)'"
                    [style.width]="'calc(' + 100 / placed.columns + '% - 4px)'"
                    [style.border-left-color]="calendar.colors().get(placed.item.sourceId)"
                    [style.background]="solid(calendar.colors().get(placed.item.sourceId))"
                    (click)="calendar.select(placed.item.id)"
                  >
                    <span class="block truncate font-medium">{{ placed.item.title }}</span>
                    @if (placed.height > 34) {
                      <span class="text-muted-foreground block truncate tabular-nums">
                        {{ placed.item.start | appDate: 'time' }} -
                        {{ placed.item.end | appDate: 'time' }}
                      </span>
                    }
                  </button>
                }
                @if (day.today && nowOffset() !== null) {
                  <div
                    class="bg-primary pointer-events-none absolute right-0 left-0 h-0.5"
                    [style.top.px]="nowOffset()"
                    aria-hidden="true"
                  ></div>
                }
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class WeekView {
  protected readonly calendar = inject(CalendarStore);
  protected readonly hourHeight = HOUR_HEIGHT;
  protected readonly tint = tint;
  protected readonly gridLines = 'linear-gradient(to bottom, var(--border) 1px, transparent 1px)';

  protected solid(color: string | undefined): string {
    return color ? `color-mix(in oklab, ${color} 18%, var(--background))` : 'var(--background)';
  }

  /** Lessons always show here; a test at a lesson's time takes that lesson's place. */
  private readonly items = computed(() => {
    const items = this.calendar.itemsWithLessons();
    const tests = items.filter((item) => item.sourceId === 'tests' && !item.allDay);
    return items.filter((item) => item.sourceId !== 'lessons' || !tests.some((test) => test.start < item.end && test.end > item.start));
  });

  private readonly timedItems = computed(() => this.items().filter((item) => !item.allDay));

  protected readonly hours = computed(() => {
    let first = 7;
    let last = 19;
    for (const item of this.timedItems()) {
      first = Math.min(first, item.start.getHours());
      last = Math.max(last, item.end.getHours() + (item.end.getMinutes() > 0 ? 1 : 0));
    }
    last = Math.min(Math.max(last, first + 1), 24);
    return Array.from({ length: last - first }, (_, i) => first + i);
  });

  protected readonly days = computed(() => {
    const today = startOfDay(new Date());
    const firstHour = this.hours()[0];
    const items = this.items();
    const week = daysBetween(this.calendar.range().start, 7);
    // The weekend only takes room when something timed happens on it.
    const weekendBusy = week.slice(5).some((date) => items.some((item) => !item.allDay && overlapsDay(item, date)));
    return (weekendBusy ? week : week.slice(0, 5)).map((date) => {
      const dayItems = items.filter((item) => overlapsDay(item, date));
      return {
        date,
        today: sameDay(date, today),
        selected: sameDay(date, this.calendar.selectedDay()),
        allDay: dayItems.filter((item) => item.allDay),
        timed: placeTimedItems(
          dayItems.filter((item) => !item.allDay),
          date,
          firstHour,
        ) as PlacedItem[],
      };
    });
  });

  protected readonly columns = computed(() => `3.5rem repeat(${this.days().length}, minmax(0, 1fr))`);

  protected readonly hasAllDay = computed(() => this.days().some((day) => day.allDay.length));

  protected readonly nowOffset = computed(() => {
    const now = new Date();
    const firstHour = this.hours()[0];
    const minutes = (now.getHours() - firstHour) * 60 + now.getMinutes();
    return minutes < 0 || minutes > this.hours().length * 60 ? null : (minutes / 60) * HOUR_HEIGHT;
  });
}
