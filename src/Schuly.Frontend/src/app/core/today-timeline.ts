import { t } from '../core/i18n';
import { AgendaEntryDto } from '../api';

export type SlotState = 'done' | 'now' | 'later';

export interface LessonSlot {
  kind: 'lesson';
  key: string;
  start: Date;
  end: Date;
  title: string;
  room: string | null;
  test: string | null;
  state: SlotState;
}

export interface BreakSlot {
  kind: 'break';
  key: string;
  start: Date;
  end: Date;
  minutes: number;
  lunch: boolean;
  state: SlotState;
}

export type TimelineSlot = LessonSlot | BreakSlot;

/** Gaps shorter than this are the room change between lessons and stay hidden; longer ones aren't a break any more. */
export const MIN_BREAK_MINUTES = 10;
export const MAX_BREAK_MINUTES = 120;

const minutesOfDay = (date: Date): number => date.getHours() * 60 + date.getMinutes();

/** The legacy app's rule (BreakCard, #105): at least 30 minutes, starting 11:00 to 13:00 and ending 11:30 to 13:30. */
export function isLunchBreak(start: Date, end: Date): boolean {
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (minutes < 30) return false;
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  return from >= 11 * 60 && from <= 13 * 60 && to >= 11 * 60 + 30 && to <= 13 * 60 + 30;
}

const stateOf = (start: Date, end: Date, now: Date): SlotState => (end <= now ? 'done' : start <= now ? 'now' : 'later');

/** Today's lessons in order, with the longer breaks between them. A test overlapping a lesson is named on it. */
export function buildTimeline(entries: AgendaEntryDto[], now: Date): TimelineSlot[] {
  const timed = entries.filter((e) => e.endDate && !Number.isNaN(new Date(e.date).getTime()));
  const tests = timed.filter((e) => e.entryType === 'Test');
  const lessons = timed
    .filter((e) => e.entryType === 'Lesson')
    .map((e) => ({ entry: e, start: new Date(e.date), end: new Date(e.endDate!) }))
    .filter((l) => l.end > l.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: TimelineSlot[] = [];
  lessons.forEach((lesson, i) => {
    const previous = lessons[i - 1];
    if (previous) {
      const minutes = Math.round((lesson.start.getTime() - previous.end.getTime()) / 60_000);
      if (minutes >= MIN_BREAK_MINUTES && minutes <= MAX_BREAK_MINUTES) {
        slots.push({ kind: 'break', key: `break|${previous.end.toISOString()}`, start: previous.end, end: lesson.start, minutes, lunch: isLunchBreak(previous.end, lesson.start), state: stateOf(previous.end, lesson.start, now) });
      }
    }
    const test = tests.find((t) => new Date(t.date) < lesson.end && new Date(t.endDate!) > lesson.start);
    slots.push({ kind: 'lesson', key: lesson.entry.id ?? `${lesson.start.toISOString()}|${lesson.entry.title}`, start: lesson.start, end: lesson.end, title: lesson.entry.title, room: lesson.entry.place || null, test: test ? test.title : null, state: stateOf(lesson.start, lesson.end, now) });
  });
  return slots;
}

/** The lesson running now, if any. */
export const currentLesson = (slots: TimelineSlot[]): LessonSlot | null => (slots.find((s) => s.kind === 'lesson' && s.state === 'now') as LessonSlot | undefined) ?? null;

/** The next lesson that hasn't started. */
export const nextLesson = (slots: TimelineSlot[]): LessonSlot | null => (slots.find((s) => s.kind === 'lesson' && s.state === 'later') as LessonSlot | undefined) ?? null;

/** Share of the lesson still to go, 0 to 100: the pie's coloured part, so it shrinks as the lesson goes on. */
export function remainingPercent(start: Date, end: Date, now: Date): number {
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((end.getTime() - now.getTime()) / total) * 100));
}

/** "40 min", "1 h 35 min" or "less than a minute". */
export function durationText(minutes: number): string {
  if (minutes < 1) return t('overview.duration.lessThanMinute');
  const whole = Math.ceil(minutes);
  if (whole < 60) return t('overview.duration.minutes', { minutes: whole });
  const rest = whole % 60;
  return rest ? t('overview.duration.hoursMinutes', { hours: Math.floor(whole / 60), minutes: rest }) : t('overview.duration.hours', { hours: whole / 60 });
}

export const minutesLeft = (end: Date, now: Date): number => (end.getTime() - now.getTime()) / 60_000;

/** "today", "yesterday", "3 days ago", "2 weeks ago" or "5 months ago". */
export function relativeDay(iso: string | null, now: Date): string {
  if (!iso) return '';
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (days <= 0) return t('overview.ago.today');
  if (days === 1) return t('overview.ago.yesterday');
  if (days < 14) return t('overview.ago.days', { count: days });
  if (days < 60) return t('overview.ago.weeks', { count: Math.floor(days / 7) });
  return t('overview.ago.months', { count: Math.floor(days / 30) });
}

export function greeting(now: Date): string {
  const hour = now.getHours();
  return t(hour < 12 ? 'overview.greeting.morning' : hour < 18 ? 'overview.greeting.afternoon' : 'overview.greeting.evening');
}
