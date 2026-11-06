import { describe, expect, it } from 'vitest';
import { AbsenceDto, AbsenceType, AgendaEntryDto, AgendaEntryType } from '../api';
import { AbsenceRow, AbsenceState, buildAbsenceRows } from './absence-view';
import { attentionItems, daysUntil, needsReportLookup } from './overview-attention';

const now = new Date('2026-11-06T09:40:00');
const row = (state: AbsenceState, from = '2026-10-27', status = ''): AbsenceRow => ({ key: `${state}${from}`, isDelay: false, from, until: from, time: null, reason: 'Andere Absenz', note: null, state, status, due: status.startsWith('Needs an excuse ') ? status.slice('Needs an excuse '.length) : null, steps: [], trainerComment: null, lessons: null, report: null, printUrl: null, bbb: true });
const test = (title: string, iso: string): AgendaEntryDto => ({ id: title, entryType: AgendaEntryType.Test, title, date: iso, endDate: iso, place: 'A 2.07' });

describe('attentionItems', () => {
  it('lists only absences that need doing, with the deadline', () => {
    const items = attentionItems([row('needs-excuse', '2026-10-27', 'Needs an excuse by 10.11. (expected)'), row('waiting'), row('excused'), row('upcoming', '2026-11-20'), row('unexcused')], [], now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'bad', title: 'Absence on 27.10. needs an excuse', when: 'by 10.11. (expected)', link: '/absences' });
    expect(items[0].detail).toContain('CHF 10');
  });

  it('flags a rejected absence', () => {
    expect(attentionItems([row('rejected')], [], now)[0].title).toBe('Absence on 27.10. was rejected');
  });

  it('includes tests in the next 7 days only', () => {
    const items = attentionItems([], [test('Physik', '2026-11-10T08:35:00'), test('Later', '2026-11-20T08:35:00'), test('Past', '2026-11-05T08:35:00')], now);
    expect(items.map((i) => [i.title, i.when])).toEqual([['Test: Physik', 'in 4 days']]);
  });

  it('is empty when there is nothing to do', () => {
    expect(attentionItems([row('excused')], [], now)).toEqual([]);
  });
});

describe('daysUntil', () => {
  it('says today, tomorrow or in N days', () => {
    expect(daysUntil(new Date('2026-11-06T15:00:00'), now)).toBe('today');
    expect(daysUntil(new Date('2026-11-07T08:00:00'), now)).toBe('tomorrow');
    expect(daysUntil(new Date('2026-11-09T08:00:00'), now)).toBe('in 3 days');
  });
});

describe('needsReportLookup', () => {
  const absence = (from: string, isExcused: boolean | null, type = AbsenceType.Absence): AbsenceDto => ({ id: from, type, reason: 'x', from: `${from}T00:00:00Z`, until: `${from}T00:00:00Z`, isExcused, schoolUserId: 'u1' });
  it('asks only for a past or current unexcused absence', () => {
    expect(needsReportLookup([absence('2026-11-03', false)], '2026-11-06')).toBe(true);
    expect(needsReportLookup([absence('2026-11-06', false)], '2026-11-06')).toBe(true);
    expect(needsReportLookup([absence('2026-11-09', false)], '2026-11-06')).toBe(false);
    expect(needsReportLookup([absence('2026-11-03', true), absence('2026-11-02', null)], '2026-11-06')).toBe(false);
    expect(needsReportLookup([absence('2026-11-03', false, AbsenceType.Delay)], '2026-11-06')).toBe(false);
  });
});

describe('a reported absence on the Overview', () => {
  it("doesn't ask for an excuse once the student reported it", () => {
    const absence: AbsenceDto = { id: 'a1', type: AbsenceType.Absence, reason: 'Andere Absenz', from: '2026-11-03T00:00:00Z', until: '2026-11-03T00:00:00Z', isExcused: false, schoolUserId: 'u1', schoolId: 's1' };
    const context = { today: '2026-11-06', isBbb: () => true, website: () => 'https://schulnetz.bbbaden.ch' };
    const report = { dateFrom: '2026-11-03', dateTo: '2026-11-03', hourFrom: null, hourTo: null, reason: 'Andere Absenz', comment: null };
    expect(attentionItems(buildAbsenceRows([absence], [], context), [], now)).toHaveLength(1);
    expect(attentionItems(buildAbsenceRows([absence], [report], context), [], now)).toHaveLength(0);
  });
});
