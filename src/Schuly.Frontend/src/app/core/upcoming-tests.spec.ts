import { describe, expect, it } from 'vitest';
import { AgendaEntryDto, AgendaEntryType } from '../api';
import { nextTestBySubject, upcomingTests } from './upcoming-tests';

const now = new Date('2026-11-06T09:40:00');
const names: Record<string, string> = { c1: 'Naturwissenschaften (Physik)', c2: 'Englisch' };
const subjectOf = (id: string | null | undefined) => names[id ?? ''] ?? '';
const test = (id: string, classId: string, iso: string, end?: string, place = 'A 2.07'): AgendaEntryDto => ({ id, entryType: AgendaEntryType.Test, title: id, classId, date: iso, endDate: end ?? iso, place });

describe('upcomingTests', () => {
  it('keeps tests from today on, soonest first, with time and room', () => {
    const tests = upcomingTests([test('Later', 'c2', '2026-11-19T09:25:00Z', '2026-11-19T10:10:00Z'), test('Past', 'c1', '2026-11-02T08:00:00Z'), test('Physik', 'c1', '2026-11-10T07:35:00Z', '2026-11-10T08:20:00Z')], [], subjectOf, now);
    expect(tests.map((t) => t.title)).toEqual(['Physik', 'Later']);
    expect(tests[0]).toMatchObject({ subject: 'Naturwissenschaften (Physik)', room: 'A 2.07', allDay: false });
  });

  it('adds an ungraded exam the agenda lacks, and skips graded or duplicate ones', () => {
    const tests = upcomingTests(
      [test('Physik', 'c1', '2026-11-10T07:35:00Z', '2026-11-10T08:20:00Z')],
      [
        { id: 'e1', name: 'Physik again', subject: 'Naturwissenschaften (Physik)', date: '2026-11-10', score: null },
        { id: 'e2', name: 'Unit 5', subject: 'Englisch', date: '2026-11-19', score: null },
        { id: 'e3', name: 'Graded', subject: 'Englisch', date: '2026-11-20', score: 5 },
        { id: 'e4', name: 'Old', subject: 'Englisch', date: '2026-10-01', score: null },
      ],
      subjectOf,
      now,
    );
    expect(tests.map((t) => t.title)).toEqual(['Physik', 'Unit 5']);
    expect(tests[1]).toMatchObject({ allDay: true, room: null });
  });

  it('gives each subject its next test', () => {
    const tests = upcomingTests([test('B', 'c2', '2026-11-20T09:00:00Z'), test('A', 'c2', '2026-11-12T09:00:00Z')], [], subjectOf, now);
    expect(nextTestBySubject(tests).get('englisch')?.title).toBe('A');
  });
});
