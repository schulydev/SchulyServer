import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBellRing, lucideCircleAlert, lucideTriangleAlert, lucideX } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { Importance } from '../core/chat-media';
import { toIsoDate } from '../core/dates';
import { htmlToText } from '../core/rich-html';
import { ScheduledMessage, ChatApi, apiMessage } from '../core/chat-api';
import { DateTimeField } from '../shared/date-time-field';
import { AppDatePipe } from '../core/date-format';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const pad = (n: number) => String(n).padStart(2, '0');
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Local date and time fields to a Date; null when either is missing. */
export function combine(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  return d && t ? new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])) : null;
}

/** Schedule the current draft for later, and manage what is still waiting in this chat. */
@Component({
  selector: 'app-schedule-dialog',
  imports: [AppDatePipe, NgIcon, HlmButton, HlmDialogImports, HlmSpinner, DateTimeField],
  providers: [provideIcons({ lucideX })],
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Schedule message</h2>
          <p hlmDialogDescription>Sent for you between one minute and seven days from now. Text and formatting only.</p>
        </hlm-dialog-header>
        <form class="flex flex-col gap-4" (submit)="submit($event)">
          @if (blocked(); as reason) {
            <p class="text-muted-foreground text-sm" role="status">{{ reason }}</p>
          } @else {
            <p class="bg-muted wrap-anywhere rounded-md px-3 py-2 text-sm"><span class="sr-only">Message: </span>{{ preview() }}</p>
          }
          <app-date-time-field id="schedule" label="Send" [(date)]="date" [(time)]="time" [min]="today()" />
          @if (error(); as e) {
            <p class="text-destructive text-sm" role="alert">{{ e }}</p>
          }
          <section aria-labelledby="scheduled-heading" class="flex flex-col gap-2">
            <h3 id="scheduled-heading" class="text-sm font-semibold">Waiting in this chat</h3>
            @if (loading()) {
              <p class="text-muted-foreground flex items-center gap-2 text-sm" role="status"><hlm-spinner aria-hidden="true" />Loading</p>
            } @else if (!pending().length) {
              <p class="text-muted-foreground text-sm">Nothing scheduled.</p>
            } @else {
              <ul class="flex flex-col gap-2">
                @for (m of pending(); track m.id) {
                  <li class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <span class="min-w-0 flex-1">
                      <span class="block truncate">{{ text(m) }}</span>
                      <time class="text-foreground/70 text-xs" [attr.datetime]="m.sendAt">{{ m.sendAt | appDate: 'weekdayDayMonthTime' }}</time>
                    </span>
                    <button hlmBtn type="button" variant="ghost" size="sm" [disabled]="cancelling() === m.id" (click)="cancel(m)">
                      <ng-icon name="lucideX" aria-hidden="true" />
                      Cancel<span class="sr-only"> scheduled message</span>
                    </button>
                  </li>
                }
              </ul>
            }
          </section>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" type="button" (click)="open.set(false)">Close</button>
            <button hlmBtn type="submit" [disabled]="!!blocked() || busy()">
              @if (busy()) {
                <hlm-spinner aria-hidden="true" />
              }
              Schedule
            </button>
          </hlm-dialog-footer>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class ScheduleDialog {
  private readonly api = inject(ChatApi);

  readonly open = model(false);
  readonly chatId = input.required<string>();
  readonly content = input('');
  readonly contentType = input<'text' | 'html'>('text');
  readonly importance = input<Importance>('normal');
  /** Why the current draft cannot be scheduled (empty, or it has attachments), or null. */
  readonly blocked = input<string | null>(null);
  readonly scheduled = output<void>();

  protected readonly date = signal('');
  protected readonly time = signal('');
  protected readonly today = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly pending = signal<ScheduledMessage[]>([]);
  protected readonly cancelling = signal<string | null>(null);
  protected readonly preview = computed(() => {
    const t = this.contentType() === 'html' ? htmlToText(this.content()) : this.content();
    return t.length > 200 ? `${t.slice(0, 200)}...` : t;
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const soon = new Date(Date.now() + 15 * MINUTE);
        this.date.set(toIsoDate(soon));
        this.time.set(timeOf(soon));
        this.today.set(toIsoDate(new Date()));
        this.error.set('');
        void this.refresh();
      });
    });
  }

  protected text(m: ScheduledMessage): string {
    return m.contentType === 'html' ? htmlToText(m.content) : m.content;
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.pending.set(await this.api.scheduled(this.chatId()));
    } catch {
      this.pending.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.blocked() || this.busy()) return;
    const at = combine(this.date(), this.time());
    const now = Date.now();
    if (!at || at.getTime() < now + MINUTE || at.getTime() > now + 7 * DAY) {
      this.error.set('Pick a time between one minute and seven days from now.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    try {
      const importance = this.importance();
      await this.api.schedule(this.chatId(), {
        content: this.content(),
        contentType: this.contentType(),
        ...(importance !== 'normal' ? { importance } : {}),
        sendAt: at.toISOString(),
      });
      toast.success('Message scheduled.');
      this.scheduled.emit();
      await this.refresh();
    } catch (e) {
      this.error.set(apiMessage(e, 'Could not schedule the message.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(m: ScheduledMessage): Promise<void> {
    this.cancelling.set(m.id);
    try {
      await this.api.cancelScheduled(m.id);
      this.pending.update((list) => list.filter((x) => x.id !== m.id));
      toast.success('Scheduled message cancelled.');
    } catch (e) {
      this.error.set(apiMessage(e, 'Could not cancel the scheduled message.'));
    } finally {
      this.cancelling.set(null);
    }
  }
}

/** Normal, Important or Urgent for the next message. */
@Component({
  selector: 'app-delivery-dialog',
  imports: [NgIcon, HlmButton, HlmDialogImports],
  providers: [provideIcons({ lucideBellRing, lucideCircleAlert, lucideTriangleAlert })],
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-sm">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Delivery options</h2>
          <p hlmDialogDescription>Important and urgent messages stand out for the people in this chat.</p>
        </hlm-dialog-header>
        <fieldset class="flex flex-col gap-2">
          <legend class="sr-only">Delivery</legend>
          @for (o of options; track o.value) {
            <label class="has-checked:border-primary has-focus-visible:outline-ring flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 has-focus-visible:outline-2">
              <input type="radio" name="delivery" class="mt-1" [value]="o.value" [checked]="importance() === o.value" (change)="importance.set(o.value)" />
              <span>
                <span class="flex items-center gap-1.5 text-sm font-medium"><ng-icon [name]="o.icon" aria-hidden="true" />{{ o.label }}</span>
                <span class="text-foreground/70 block text-xs">{{ o.hint }}</span>
              </span>
            </label>
          }
        </fieldset>
        <hlm-dialog-footer>
          <button hlmBtn type="button" (click)="open.set(false)">Done</button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class DeliveryDialog {
  readonly open = model(false);
  readonly importance = model<Importance>('normal');
  protected readonly options: { value: Importance; label: string; hint: string; icon: string }[] = [
    { value: 'normal', label: 'Normal', hint: 'Delivered as usual.', icon: 'lucideBellRing' },
    { value: 'high', label: 'Important', hint: 'Marked with an Important label.', icon: 'lucideCircleAlert' },
    { value: 'urgent', label: 'Urgent', hint: 'Marked with an Urgent label.', icon: 'lucideTriangleAlert' },
  ];
}

/** Create an online meeting with this chat's members. */
@Component({
  selector: 'app-meeting-dialog',
  imports: [HlmButton, HlmDialogImports, HlmFieldImports, HlmInput, HlmSpinner, HlmTextarea, DateTimeField],
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Schedule meeting</h2>
          <p hlmDialogDescription>Invites everyone in this chat to an online meeting.</p>
        </hlm-dialog-header>
        <form class="flex flex-col gap-4" (submit)="submit($event)">
          <div hlmField>
            <label hlmFieldLabel for="meeting-subject">Subject</label>
            <input hlmInput id="meeting-subject" maxlength="255" autocomplete="off" [value]="subject()" (input)="subject.set($any($event.target).value)" />
          </div>
          <app-date-time-field id="meeting-start" label="Start" [(date)]="date" [(time)]="start" [min]="today()" />
          <div hlmField>
            <label hlmFieldLabel for="meeting-end">End time</label>
            <input hlmInput id="meeting-end" type="time" [value]="end()" (input)="end.set($any($event.target).value)" />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="meeting-description">Description (optional)</label>
            <textarea hlmTextarea id="meeting-description" rows="3" maxlength="4000" [value]="description()" (input)="description.set($any($event.target).value)"></textarea>
          </div>
          @if (error(); as e) {
            <p class="text-destructive text-sm" role="alert">{{ e }}</p>
          }
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" type="button" (click)="open.set(false)">Cancel</button>
            <button hlmBtn type="submit" [disabled]="busy()">
              @if (busy()) {
                <hlm-spinner aria-hidden="true" />
              }
              Create meeting
            </button>
          </hlm-dialog-footer>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class MeetingDialog {
  private readonly api = inject(ChatApi);

  readonly open = model(false);
  readonly chatId = input.required<string>();
  readonly chatTitle = input('');

  protected readonly subject = signal('');
  protected readonly description = signal('');
  protected readonly date = signal('');
  protected readonly start = signal('');
  protected readonly end = signal('');
  protected readonly today = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const begin = new Date(Date.now() + 30 * MINUTE);
        begin.setMinutes(Math.ceil(begin.getMinutes() / 15) * 15, 0, 0);
        this.date.set(toIsoDate(begin));
        this.start.set(timeOf(begin));
        this.end.set(timeOf(new Date(begin.getTime() + 30 * MINUTE)));
        this.today.set(toIsoDate(new Date()));
        this.subject.set(this.chatTitle() ? `Meeting with ${this.chatTitle()}`.slice(0, 255) : '');
        this.description.set('');
        this.error.set('');
      });
    });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    const subject = this.subject().trim();
    const start = combine(this.date(), this.start());
    const end = combine(this.date(), this.end());
    if (!subject) return this.error.set('Give the meeting a subject.');
    if (!start || !end) return this.error.set('Choose a date, a start time and an end time.');
    if (end <= start) return this.error.set('The meeting must end after it starts.');
    this.error.set('');
    this.busy.set(true);
    try {
      const description = this.description().trim();
      const result = await this.api.meeting(this.chatId(), {
        subject,
        start: start.toISOString(),
        end: end.toISOString(),
        ...(description ? { description } : {}),
      });
      this.open.set(false);
      const join = result.joinUrl ?? result.webLink;
      toast.success('Meeting scheduled.', {
        description: subject,
        ...(join ? { action: { label: 'Join', onClick: () => window.open(join, '_blank', 'noopener,noreferrer') } } : {}),
      });
    } catch (e) {
      this.error.set(apiMessage(e, 'Could not create the meeting.'));
    } finally {
      this.busy.set(false);
    }
  }
}
