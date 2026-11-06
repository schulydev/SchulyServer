import { describe, expect, it } from 'vitest';
import { AgendaEntryDto, AgendaEntryType } from '../api';
import { buildTimeline, currentLesson, durationText, isLunchBreak, nextLesson, relativeDay, remainingPercent } from './today-timeline';

const at = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00`);
const lesson = (title: string, from: string, to: string, place = 'A 1.03'): AgendaEntryDto => ({ id: `${title}${from}`, entryType: AgendaEntryType.Lesson, title, place, date: at(from).toISOString(), endDate: at(to).toISOString() });
const test = (title: string, from: string, to: string): AgendaEntryDto => ({ id: `t${from}`, entryType: AgendaEntryType.Test, title, date: at(from).toISOString(), endDate: at(to).toISOString() });

const DAY = [
  lesson('Deutsch', '07:45', '08:30'),
  lesson('Deutsch', '08:35', '09:20'),
  lesson('Mathematik', '09:35', '10:20'),
  lesson('Mathematik', '10:25', '11:10'),
  lesson('Wirtschaft', '12:45', '13:30'),
  test('Logarithmen', '09:35', '10:20'),
];

describe('buildTimeline', () => {
  it('shows the longer breaks and hides the 5-minute changes', () => {
    const slots = buildTimeline(DAY, at('09:40'));
    const breaks = slots.filter((s) => s.kind === 'break');
    expect(breaks.map((b) => [b.minutes, b.lunch])).toEqual([[15, false], [95, true]]);
    expect(slots.filter((s) => s.kind === 'lesson')).toHaveLength(5);
  });

  it('marks the running lesson, the finished ones and names a test in its lesson', () => {
    const slots = buildTimeline(DAY, at('09:40'));
    expect(currentLesson(slots)?.title).toBe('Mathematik');
    expect(currentLesson(slots)?.test).toBe('Logarithmen');
    expect(slots.filter((s) => s.state === 'done')).toHaveLength(3);
    expect(nextLesson(slots)?.start).toEqual(at('10:25'));
  });

  it('has no current lesson during a break, and the break is the one running', () => {
    const slots = buildTimeline(DAY, at('11:30'));
    expect(currentLesson(slots)).toBeNull();
    expect(slots.find((s) => s.state === 'now')?.kind).toBe('break');
  });

  it('ignores gaps above two hours', () => {
    const slots = buildTimeline([lesson('A', '08:00', '08:45'), lesson('B', '13:00', '13:45')], at('07:00'));
    expect(slots.some((s) => s.kind === 'break')).toBe(false);
  });
});

describe('isLunchBreak', () => {
  it('follows the legacy rule', () => {
    expect(isLunchBreak(at('11:10'), at('12:45'))).toBe(true);
    expect(isLunchBreak(at('12:00'), at('12:20'))).toBe(false);
    expect(isLunchBreak(at('09:20'), at('10:20'))).toBe(false);
    expect(isLunchBreak(at('13:00'), at('13:30'))).toBe(true);
    expect(isLunchBreak(at('13:05'), at('13:40'))).toBe(false);
  });
});

describe('countdown', () => {
  it('gives the share still to go', () => {
    expect(remainingPercent(at('09:35'), at('10:20'), at('09:40'))).toBeCloseTo(88.9, 1);
    expect(remainingPercent(at('09:35'), at('10:20'), at('10:30'))).toBe(0);
    expect(remainingPercent(at('09:35'), at('10:20'), at('09:00'))).toBe(100);
  });

  it('writes the time left', () => {
    expect(durationText(40)).toBe('40 min');
    expect(durationText(39.2)).toBe('40 min');
    expect(durationText(95)).toBe('1 h 35 min');
    expect(durationText(120)).toBe('2 h');
    expect(durationText(0.4)).toBe('less than a minute');
  });
});

describe('relativeDay', () => {
  it('counts days and weeks', () => {
    const now = at('09:00');
    expect(relativeDay('2026-11-06', now)).toBe('today');
    expect(relativeDay('2026-11-05', now)).toBe('yesterday');
    expect(relativeDay('2026-11-03', now)).toBe('3 days ago');
    expect(relativeDay('2026-10-15', now)).toBe('3 weeks ago');
  });
});
