import { Component, inject, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMapPin, lucideVideo } from '@ng-icons/lucide';
import { CalendarItem } from '../../core/calendar';
import { CalendarStore } from '../../stores/calendar.store';
import { AppDatePipe } from '../../core/date-format';

@Component({
  selector: 'app-day-list',
  imports: [AppDatePipe, NgIcon],
  providers: [provideIcons({ lucideMapPin, lucideVideo })],
  template: `
    <ul class="divide-y">
      @for (item of items(); track item.id) {
        <li>
          <button
            type="button"
            class="hover:bg-accent/60 focus-visible:ring-ring/50 flex w-full items-start gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-[3px]"
            (click)="calendar.select(item.id)"
          >
            <span
              class="mt-1 h-8 w-1 shrink-0 rounded-full"
              [style.background]="calendar.colors().get(item.sourceId)"
              aria-hidden="true"
            ></span>
            <span class="text-muted-foreground w-12 shrink-0 pt-0.5 text-xs tabular-nums">
              @if (item.allDay) {
                All day
              } @else {
                {{ item.start | appDate: 'time' }}<br />{{ item.end | appDate: 'time' }}
              }
            </span>
            <span class="grid min-w-0 flex-1 gap-0.5">
              <span class="truncate text-sm font-medium" [class.line-through]="item.cancelled">{{
                item.title
              }}</span>
              <span class="text-muted-foreground truncate text-xs">{{ sourceLabel(item) }}</span>
              @if (item.location) {
                <span class="text-muted-foreground flex items-center gap-1 truncate text-xs">
                  <ng-icon [name]="item.joinUrl ? 'lucideVideo' : 'lucideMapPin'" size="12px" />
                  {{ item.location }}
                </span>
              }
            </span>
          </button>
        </li>
      } @empty {
        <li class="text-muted-foreground px-4 py-6 text-center text-sm">{{ emptyText() }}</li>
      }
    </ul>
  `,
})
export class DayList {
  protected readonly calendar = inject(CalendarStore);
  readonly items = input.required<CalendarItem[]>();
  readonly emptyText = input('Nothing planned.');

  protected sourceLabel(item: CalendarItem): string {
    return this.calendar.sources().find((source) => source.id === item.sourceId)?.label ?? '';
  }
}
