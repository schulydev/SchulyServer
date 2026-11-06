export type CalendarView = 'month' | 'week' | 'list';

export interface CalendarItem {
  id: string;
  sourceId: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  joinUrl: string | null;
  webLink: string | null;
  cancelled: boolean;
}

export interface CalendarSource {
  id: string;
  label: string;
  detail: string | null;
  color: string;
  problem: string | null;
}

export interface PlacedItem {
  item: CalendarItem;
  top: number;
  height: number;
  column: number;
  columns: number;
}

export const HOUR_HEIGHT = 48;
const MINUTE = 60_000;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function daysBetween(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function visibleRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === 'month') {
    const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return { start, end: addDays(start, 42) };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  const start = startOfDay(anchor);
  return { start, end: addDays(start, 28) };
}

export function overlapsDay(item: CalendarItem, day: Date): boolean {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return (
    item.start < dayEnd &&
    (item.end > dayStart || (item.end.getTime() === item.start.getTime() && item.start >= dayStart))
  );
}

export function parseDate(value: string, allDay: boolean): Date {
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export function dateOnly(value: string): Date | null {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDate(value, true);
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0
    ? new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    : null;
}

export function placeTimedItems(items: CalendarItem[], day: Date, firstHour: number): PlacedItem[] {
  const dayStart = startOfDay(day);
  const origin = dayStart.getTime() + firstHour * 60 * MINUTE;
  const dayEnd = addDays(dayStart, 1).getTime();
  const sorted = [...items].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime(),
  );

  const placed: PlacedItem[] = [];
  let cluster: PlacedItem[] = [];
  let clusterEnd = 0;
  const columnEnds: number[] = [];

  const closeCluster = () => {
    for (const entry of cluster) entry.columns = columnEnds.length;
    cluster = [];
    columnEnds.length = 0;
  };

  for (const item of sorted) {
    const start = Math.max(item.start.getTime(), origin);
    const end = Math.max(Math.min(item.end.getTime(), dayEnd), start + 15 * MINUTE);
    if (cluster.length && start >= clusterEnd) closeCluster();

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }

    const entry: PlacedItem = {
      item,
      top: ((start - origin) / MINUTE / 60) * HOUR_HEIGHT,
      height: ((end - start) / MINUTE / 60) * HOUR_HEIGHT,
      column,
      columns: 1,
    };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, end);
  }
  closeCluster();
  return placed;
}

/** One entry's piece within a week row of the month grid: columns 0-6, its lane, and whether it continues past the row's edges. */
export interface WeekSegment {
  item: CalendarItem;
  start: number;
  end: number;
  lane: number;
  cutStart: boolean;
  cutEnd: boolean;
}

export interface WeekLayout {
  segments: WeekSegment[];
  /** Per day (0-6): how many entries fall in lanes past the cap, shown as "+N". */
  more: number[];
}

/** The last day an item covers: all-day items end at midnight after their last day, timed items count only their start day. */
export function lastDayOf(item: CalendarItem): Date {
  return item.allDay ? addDays(startOfDay(item.end), item.end.getTime() === startOfDay(item.end).getTime() ? -1 : 0) : startOfDay(item.start);
}

const DAY_MS = 86_400_000;
const dayIndex = (weekStart: Date, day: Date) => Math.round((startOfDay(day).getTime() - weekStart.getTime()) / DAY_MS);

/**
 * Lays out one week of the month grid. Multi-day entries go first so they keep their lane across the week, then all-day
 * ones, then timed ones by start. Only `maxLanes` lanes show; anything below counts towards "+N" on every day it covers.
 */
export function weekLayout(weekStart: Date, items: CalendarItem[], maxLanes = 3): WeekLayout {
  const start = startOfDay(weekStart);
  const span = (item: CalendarItem) => dayIndex(start, lastDayOf(item)) - dayIndex(start, item.start);
  const inWeek = items
    .filter((item) => dayIndex(start, item.start) <= 6 && dayIndex(start, lastDayOf(item)) >= 0)
    .sort((a, b) => Number(span(b) > 0) - Number(span(a) > 0) || Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime() || span(b) - span(a));
  const taken: { lane: number; start: number; end: number }[] = [];
  const segments: WeekSegment[] = [];
  const more = [0, 0, 0, 0, 0, 0, 0];
  for (const item of inWeek) {
    const from = dayIndex(start, item.start);
    const to = dayIndex(start, lastDayOf(item));
    const s = Math.max(0, from);
    const e = Math.min(6, to);
    let lane = 0;
    while (taken.some((t) => t.lane === lane && !(e < t.start || s > t.end))) lane++;
    taken.push({ lane, start: s, end: e });
    if (lane >= maxLanes) {
      for (let d = s; d <= e; d++) more[d]++;
      continue;
    }
    segments.push({ item, start: s, end: e, lane, cutStart: from < 0, cutEnd: to > 6 });
  }
  return { segments, more };
}

/** Which entries a view shows. The month honours every filter; the week and the day panel always show lessons, since a day without them would be wrong. */
export function filterItems(items: CalendarItem[], hidden: readonly string[], keepLessons = false): CalendarItem[] {
  const off = new Set(hidden);
  if (keepLessons) off.delete('lessons');
  return items.filter((item) => !off.has(item.sourceId));
}

/** The line under the day panel's title: the lessons' count and span, the holiday, the weekend, or nothing. */
export function daySummary(day: Date, items: CalendarItem[], time: (date: Date) => string): string {
  const today = items.filter((item) => overlapsDay(item, day));
  const lessons = today.filter((item) => item.sourceId === 'lessons' && !item.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  if (lessons.length) {
    const end = lessons.reduce((last, item) => (item.end > last ? item.end : last), lessons[0].end);
    return `${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}, ${time(lessons[0].start)} – ${time(end)}`;
  }
  const holiday = today.find((item) => item.sourceId === 'holidays');
  if (holiday) return holiday.title;
  // A school day with nothing on it needs no line of its own.
  return day.getDay() === 0 || day.getDay() === 6 ? 'Weekend' : '';
}
