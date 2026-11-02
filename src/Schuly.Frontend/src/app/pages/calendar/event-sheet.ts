import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideClock,
  lucideExternalLink,
  lucideMapPin,
  lucideUser,
  lucideVideo,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { addDays, sameDay } from '../../core/calendar';
import { formatWhen } from '../../core/date-format';
import { CalendarStore } from '../../stores/calendar.store';

@Component({
  selector: 'app-event-sheet',
  imports: [HlmSheetImports, HlmButton, NgIcon],
  providers: [
    provideIcons({ lucideClock, lucideExternalLink, lucideMapPin, lucideUser, lucideVideo }),
  ],
  template: `
    <hlm-sheet
      side="right"
      [state]="calendar.selected() ? 'open' : 'closed'"
      (closed)="calendar.select(null)"
    >
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 sm:max-w-md">
        @if (calendar.selected(); as item) {
          <hlm-sheet-header class="border-b">
            <div class="flex items-center gap-2 text-xs">
              <span
                class="size-2.5 rounded-full"
                [style.background]="source()?.color"
                aria-hidden="true"
              ></span>
              <span class="text-muted-foreground">{{ source()?.label }}</span>
            </div>
            <h2 hlmSheetTitle [class.line-through]="item.cancelled">{{ item.title }}</h2>
            <p hlmSheetDescription>
              @if (item.cancelled) {
                Cancelled.
              }
              {{ when() }}
            </p>
          </hlm-sheet-header>
          <div class="flex min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 text-sm">
            @if (item.location) {
              <p class="flex items-start gap-2">
                <ng-icon
                  [name]="item.joinUrl ? 'lucideVideo' : 'lucideMapPin'"
                  size="16px"
                  class="text-muted-foreground mt-0.5 shrink-0"
                />
                <span>{{ item.location }}</span>
              </p>
            }
            @if (item.organizer) {
              <p class="flex items-start gap-2">
                <ng-icon
                  name="lucideUser"
                  size="16px"
                  class="text-muted-foreground mt-0.5 shrink-0"
                />
                <span>{{ item.organizer }}</span>
              </p>
            }
            @if (item.description) {
              <p class="text-muted-foreground whitespace-pre-line [overflow-wrap:anywhere]">
                {{ item.description.trim() }}
              </p>
            }
            @if (source()?.detail; as detail) {
              <p class="text-muted-foreground text-xs">From {{ detail }}</p>
            }
          </div>
          @if (item.joinUrl || item.webLink) {
            <hlm-sheet-footer class="border-t">
              @if (item.joinUrl) {
                <a hlmBtn [href]="item.joinUrl" target="_blank" rel="noopener noreferrer">
                  <ng-icon name="lucideVideo" />
                  Join meeting
                </a>
              }
              @if (item.webLink) {
                <a
                  hlmBtn
                  variant="outline"
                  [href]="item.webLink"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ng-icon name="lucideExternalLink" />
                  Open in Outlook
                </a>
              }
            </hlm-sheet-footer>
          }
        }
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class EventSheet {
  protected readonly calendar = inject(CalendarStore);
  protected readonly source = computed(() => {
    const item = this.calendar.selected();
    return item
      ? (this.calendar.sources().find((source) => source.id === item.sourceId) ?? null)
      : null;
  });

  protected readonly when = computed(() => {
    const item = this.calendar.selected();
    if (!item) return '';
    const date = (d: Date) => formatWhen(d, 'weekdayDateLong');
    const time = (d: Date) => formatWhen(d, 'time');
    if (item.allDay) {
      const last = addDays(item.end, -1);
      return sameDay(item.start, last) || last < item.start
        ? `${date(item.start)}, all day`
        : `${date(item.start)} to ${date(last)}`;
    }
    return sameDay(item.start, item.end)
      ? `${date(item.start)}, ${time(item.start)} - ${time(item.end)}`
      : `${date(item.start)} ${time(item.start)} to ${date(item.end)} ${time(item.end)}`;
  });
}
