import { CalendarItem, daySummary, filterItems, weekLayout } from './calendar';

const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min);
let n = 0;
function entry(sourceId: string, start: Date, end: Date, allDay: boolean, title = `e${++n}`): CalendarItem {
  return { id: title, sourceId, title, start, end, allDay, location: null, description: null, organizer: null, joinUrl: null, webLink: null, cancelled: false };
}
const allDay = (sourceId: string, from: Date, lastDay: Date, title?: string) => entry(sourceId, from, new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1), true, title);
const timed = (sourceId: string, start: Date, minutes: number, title?: string) => entry(sourceId, start, new Date(start.getTime() + minutes * 60_000), false, title);

// Monday 16 November 2026.
const week = d(2026, 11, 16);

describe('weekLayout', () => {
  it('draws a multi-day entry as one segment across its days', () => {
    const { segments } = weekLayout(week, [allDay('events', d(2026, 11, 16), d(2026, 11, 21), 'Kulturwoche')]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 0, end: 5, lane: 0, cutStart: false, cutEnd: false });
  });

  it('cuts an entry at the week edges and marks where it continues', () => {
    const { segments } = weekLayout(week, [allDay('holidays', d(2026, 11, 13), d(2026, 11, 25), 'Ferien')]);
    expect(segments[0]).toMatchObject({ start: 0, end: 6, cutStart: true, cutEnd: true });
  });

  it('puts multi-day entries first and stacks overlaps into lanes', () => {
    const test = timed('tests', d(2026, 11, 19, 9, 15), 45, 'Test');
    const week1 = allDay('events', d(2026, 11, 16), d(2026, 11, 21), 'Kulturwoche');
    const other = allDay('events', d(2026, 11, 19), d(2026, 11, 20), 'Zwei Tage');
    const { segments } = weekLayout(week, [test, week1, other]);
    const lane = (t: string) => segments.find((s) => s.item.title === t)!.lane;
    expect(lane('Kulturwoche')).toBe(0);
    expect(lane('Zwei Tage')).toBe(1);
    expect(lane('Test')).toBe(2);
  });

  it('reuses a lane when entries do not overlap', () => {
    const { segments } = weekLayout(week, [timed('tests', d(2026, 11, 16, 8), 45, 'A'), timed('tests', d(2026, 11, 18, 8), 45, 'B')]);
    expect(segments.map((s) => s.lane)).toEqual([0, 0]);
  });

  it('caps a day at three lanes and counts the rest as more', () => {
    const thursday = [8, 9, 10, 11, 13].map((h) => timed('lessons', d(2026, 11, 19, h), 45, `L${h}`));
    const { segments, more } = weekLayout(week, thursday);
    expect(segments.filter((s) => s.start === 3)).toHaveLength(3);
    expect(more[3]).toBe(2);
    expect(more.filter((_, i) => i !== 3).every((x) => x === 0)).toBe(true);
  });

  it('counts a multi-day entry that falls in the fourth lane on every day it covers', () => {
    const bars = [1, 2, 3].map((i) => allDay('events', d(2026, 11, 16), d(2026, 11, 20), `Bar${i}`));
    const fourth = allDay('holidays', d(2026, 11, 17), d(2026, 11, 19), 'Hidden');
    const { segments, more } = weekLayout(week, [...bars, fourth]);
    expect(segments.some((s) => s.item.title === 'Hidden')).toBe(false);
    expect(more).toEqual([0, 1, 1, 1, 0, 0, 0]);
  });
});

describe('filterItems', () => {
  const items = [timed('lessons', d(2026, 11, 19, 8), 45), timed('tests', d(2026, 11, 19, 9), 45), allDay('holidays', d(2026, 12, 21), d(2027, 1, 3))];
  it('hides every source that is turned off', () => {
    expect(filterItems(items, ['lessons']).map((i) => i.sourceId)).toEqual(['tests', 'holidays']);
    expect(filterItems(items, ['lessons', 'holidays']).map((i) => i.sourceId)).toEqual(['tests']);
  });
  it('keeps lessons for the week and the day panel even when they are off', () => {
    expect(filterItems(items, ['lessons', 'tests'], true).map((i) => i.sourceId)).toEqual(['lessons', 'holidays']);
  });
});

describe('daySummary', () => {
  const time = (x: Date) => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  it('names the count and span of the lessons', () => {
    const lessons = [timed('lessons', d(2026, 11, 5, 8, 20), 45), timed('lessons', d(2026, 11, 5, 14, 5), 45)];
    expect(daySummary(d(2026, 11, 5), lessons, time)).toBe('2 lessons, 08:20 – 14:50');
  });
  it('names a holiday, the weekend or no school', () => {
    const holiday = allDay('holidays', d(2026, 12, 21), d(2027, 1, 3), 'Weihnachtsferien 2026');
    expect(daySummary(d(2026, 12, 22), [holiday], time)).toBe('Weihnachtsferien 2026');
    expect(daySummary(d(2026, 11, 7), [], time)).toBe('Weekend');
    expect(daySummary(d(2026, 11, 6), [], time)).toBe('No school today');
  });
});
