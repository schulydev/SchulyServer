import { describe, expect, it } from 'vitest';
import { AbsenceDto, SemesterReportDto } from '../api';
import { absenceSteps, approvalState, rejectedLabel, waitingLabel } from './absence-steps';
import { AbsenceContext, ReportInput, absenceAnswer, absenceMonths, absenceSemesters, buildAbsenceRows, dayOf, daysMissed, lessonsMissed, semesterKeyOf } from './absence-view';

const TODAY = '2026-11-04';
const context = (bbb = false): AbsenceContext => ({ today: TODAY, isBbb: () => bbb, website: () => (bbb ? 'https://schulnetz.bbbaden.ch' : 'https://other.example') });
let id = 0;
const absence = (over: Partial<AbsenceDto> = {}): AbsenceDto => ({ id: `a${++id}`, reason: 'Krankheit', type: 'Absence' as AbsenceDto['type'], from: '2026-09-23T00:00:00Z', until: '2026-09-23T00:00:00Z', isExcused: true, ...over });
const report = (over: Partial<ReportInput> = {}): ReportInput => ({ dateFrom: '2026-11-05', dateTo: '2026-11-05', hourFrom: '12:00', hourTo: '17:30', reason: 'Andere Absenz', comment: 'Arzt', ...over });

describe('approvalState', () => {
  it('reads only the words it knows, however they are written', () => {
    expect(approvalState('Offen')).toBe('open');
    expect(approvalState(' BESTÄTIGT ')).toBe('confirmed');
    expect(approvalState('abgelehnt')).toBe('rejected');
    expect(approvalState('Entschuldigt')).toBe('excused');
    expect(approvalState('confirmed')).toBeNull();
    expect(approvalState('1')).toBeNull();
    expect(approvalState(null)).toBeNull();
  });
});

describe('absenceSteps', () => {
  const labels = (input: Parameters<typeof absenceSteps>[0]) => absenceSteps(input).map((s) => `${s.label}:${s.state}`);

  it('has no steps when nothing is known', () => {
    expect(absenceSteps({ reported: false })).toEqual([]);
    expect(absenceSteps({ reported: false, parentStatus: 'Unknown word', trainerStatus: '7' })).toEqual([]);
  });

  it('shows only the school after a report with no approval values', () => {
    expect(labels({ reported: true })).toEqual(['Reported:done', 'School:next']);
    expect(labels({ reported: true, trainerStatus: 'something new' })).toEqual(['Reported:done', 'School:next']);
  });

  it('shows the Lehrmeister only with a value, and stops at the open step', () => {
    const steps = absenceSteps({ reported: true, trainerStatus: 'Offen' });
    expect(steps.map((s) => `${s.label}:${s.state}`)).toEqual(['Reported:done', 'Lehrmeister:next', 'School:todo']);
    expect(waitingLabel(steps)).toBe('Waiting for Lehrmeister');
  });

  it('moves on to the school once the Lehrmeister confirmed', () => {
    const steps = absenceSteps({ reported: false, trainerStatus: 'Bestätigt' });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'next']);
    expect(waitingLabel(steps)).toBe('Waiting for school');
  });

  it('asks the parents first, and a rejection ends it', () => {
    expect(labels({ reported: true, parentStatus: 'Offen', trainerStatus: 'Offen' })).toEqual(['Reported:done', 'Parents:next', 'Lehrmeister:todo', 'School:todo']);
    const steps = absenceSteps({ reported: true, parentStatus: 'Abgelehnt' });
    expect(rejectedLabel(steps)).toBe('Rejected by parents');
    expect(waitingLabel(steps)).toBeNull();
  });
});

describe('buildAbsenceRows', () => {
  it('shows no time for a date-only absence, and the real one when the school sent it', () => {
    const [dateOnly] = buildAbsenceRows([absence()], [], context());
    expect(dateOnly.time).toBeNull();
    expect(dateOnly.from).toBe('2026-09-23');
    const [timed] = buildAbsenceRows([absence({ startTime: '12:00', endTime: '17:30' })], [], context());
    expect(timed.time).toBe('12:00 – 17:30');
  });

  it('shows a delay at its time in Switzerland', () => {
    const [delay] = buildAbsenceRows([absence({ type: 'Delay' as AbsenceDto['type'], from: '2026-09-15T06:20:00Z', until: '2026-09-15T06:20:00Z' })], [], context());
    expect(delay.time).toBe('08:20');
    expect(delay.isDelay).toBe(true);
  });

  it('merges a copy of the same absence, and the excused one wins', () => {
    const rows = buildAbsenceRows([absence({ isExcused: false }), absence({ isExcused: true })], [], context());
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('excused');
  });

  it('keeps different reasons on the same date apart', () => {
    expect(buildAbsenceRows([absence(), absence({ reason: 'Arzt' })], [], context())).toHaveLength(2);
  });

  it('makes one row of a report and its unexcused absence, and keeps the report for Withdraw', () => {
    const r = report();
    const rows = buildAbsenceRows([absence({ from: '2026-11-05T00:00:00Z', until: '2026-11-05T00:00:00Z', reason: 'Andere Absenz', isExcused: false })], [r], context());
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('waiting');
    expect(rows[0].status).toBe('Waiting for school');
    expect(rows[0].report).toBe(r);
    expect(rows[0].note).toBe('Arzt');
    expect(rows[0].time).toBe('12:00 – 17:30');
  });

  it('shows a report with no absence yet as its own row', () => {
    const rows = buildAbsenceRows([], [report()], context());
    expect(rows[0].reason).toBe('Andere Absenz');
    expect(rows[0].state).toBe('waiting');
  });

  it("doesn't ask to excuse an absence in the future", () => {
    const [row] = buildAbsenceRows([absence({ from: '2026-11-05T00:00:00Z', until: '2026-11-05T00:00:00Z', isExcused: false })], [], context(true));
    expect(row.state).toBe('upcoming');
    expect(row.printUrl).toBeNull();
  });

  it('uses the 14-day rule only at BBB, and calls it expected', () => {
    const unexcused = absence({ from: '2026-10-27T00:00:00Z', until: '2026-10-27T00:00:00Z', isExcused: false });
    const [bbb] = buildAbsenceRows([unexcused], [], context(true));
    expect(bbb.state).toBe('needs-excuse');
    expect(bbb.status).toContain('10.11.');
    expect(bbb.status).toContain('(expected)');
    expect(bbb.printUrl).toBe('https://schulnetz.bbbaden.ch');
    const [other] = buildAbsenceRows([unexcused], [], context());
    expect(other.state).toBe('unexcused');
    expect(other.status).toBe('Not excused');
    expect(other.printUrl).toBeNull();
  });

  it('prefers the real deadline, anywhere', () => {
    const [row] = buildAbsenceRows([absence({ isExcused: false, excuseDeadline: '2026-11-12' })], [], context());
    expect(row.state).toBe('needs-excuse');
    expect(row.status).toContain('12.11.');
    expect(row.status).not.toContain('expected');
  });

  it('no longer asks for an excuse once the deadline passed', () => {
    const [row] = buildAbsenceRows([absence({ from: '2026-09-01T00:00:00Z', until: '2026-09-01T00:00:00Z', isExcused: false })], [], context(true));
    expect(row.state).toBe('unexcused');
  });

  it('hides the print option once the Lehrmeister confirmed', () => {
    const [row] = buildAbsenceRows([absence({ from: '2026-10-27T00:00:00Z', until: '2026-10-27T00:00:00Z', isExcused: false, trainerStatus: 'Bestätigt' })], [], context(true));
    expect(row.status).toBe('Waiting for school');
    expect(row.printUrl).toBeNull();
  });

  it('shows no steps and only the excused state for words it does not know', () => {
    const [row] = buildAbsenceRows([absence({ isExcused: false, parentStatus: 'pending-x', trainerStatus: 'x' })], [], context());
    expect(row.steps).toEqual([]);
    expect(row.status).toBe('Not excused');
    const [none] = buildAbsenceRows([absence({ isExcused: null })], [], context());
    expect(none.state).toBe('unknown');
    expect(none.status).toBe('');
  });
});

describe('absenceAnswer', () => {
  const rows = (absences: AbsenceDto[], reports: ReportInput[] = [], bbb = false) => buildAbsenceRows(absences, reports, context(bbb));
  const open = absence({ from: '2026-10-27T00:00:00Z', until: '2026-10-27T00:00:00Z', isExcused: false });

  it('says what needs doing first, with the BBB rule', () => {
    const answer = absenceAnswer(rows([open, absence()], [], true));
    expect(answer.text).toBe('1 absence needs an excuse');
    expect(answer.tone).toBe('bad');
    expect(answer.hint).toContain('CHF 10');
  });

  it('leaves the CHF 10 out for other schools', () => {
    const answer = absenceAnswer(rows([open]));
    expect(answer.text).toBe("1 absence isn't excused");
    expect(answer.hint).not.toContain('CHF');
  });

  it('counts what is waiting, and on whom', () => {
    const answer = absenceAnswer(rows([absence({ from: '2026-11-03T00:00:00Z', until: '2026-11-03T00:00:00Z', isExcused: false, trainerStatus: 'Offen' })], [report()]));
    expect(answer.text).toBe('Nothing to do right now');
    expect(answer.hint).toBe('1 waiting for school, 1 waiting for Lehrmeister.');
  });

  it('gives the 7-day rule for planned absences only at BBB', () => {
    const planned = absence({ from: '2026-12-01T00:00:00Z', until: '2026-12-01T00:00:00Z', isExcused: false });
    expect(absenceAnswer(rows([planned], [], true)).hint).toContain('7 days');
    expect(absenceAnswer(rows([planned])).hint).not.toContain('7 days');
  });

  it('knows all excused, nothing, and not knowing', () => {
    expect(absenceAnswer(rows([absence()])).text).toBe('All excused');
    expect(absenceAnswer([]).text).toBe('No absences this semester');
    expect(absenceAnswer(rows([absence({ isExcused: null })])).text).toBe('Nothing marked as open');
  });
});

describe('semesters and counts', () => {
  const report2 = (year: number, half: number, over: Partial<SemesterReportDto> = {}): SemesterReportDto => ({ programCode: 'BM', schoolYearStart: year, semesterHalf: half, className: 'BM23d', ...over });

  it('finds the semester of a date', () => {
    expect(semesterKeyOf('2026-08-01')).toBe('2026-1');
    expect(semesterKeyOf('2027-01-31')).toBe('2026-1');
    expect(semesterKeyOf('2027-02-01')).toBe('2026-2');
    expect(semesterKeyOf('2026-07-31')).toBe('2025-2');
  });

  it('numbers semesters from the first report, newest first', () => {
    const semesters = absenceSemesters([{ from: '2026-09-23' }], [report2(2023, 1), report2(2025, 2)], TODAY);
    expect(semesters[0].label).toBe('Semester 7 · 2026/27');
    expect(semesters.at(-1)?.label).toBe('Semester 1 · 2023/24');
  });

  it('always offers the current semester', () => {
    expect(absenceSemesters([], [], TODAY).map((s) => s.key)).toEqual(['2026-1']);
  });

  it('counts each weekday once, up to today, and no delays', () => {
    const row = (from: string, until: string, isDelay = false) => ({ from, until, isDelay });
    expect(daysMissed([row('2026-08-19', '2026-08-20'), row('2026-08-19', '2026-08-20')], TODAY)).toBe(2);
    expect(daysMissed([row('2026-10-30', '2026-11-02')], TODAY)).toBe(2);
    expect(daysMissed([row('2026-11-05', '2026-11-05')], TODAY)).toBe(0);
    expect(daysMissed([row('2026-10-01', '2026-10-01', true)], TODAY)).toBe(0);
  });

  it('prefers the Zeugnis for lessons, then the absences, else unknown', () => {
    expect(lessonsMissed([{ lessons: 3 }], [report2(2025, 2, { excusedAbsences: 4, unexcusedAbsences: 1 })])).toBe(5);
    expect(lessonsMissed([{ lessons: 3 }, { lessons: 2 }], [report2(2025, 2)])).toBe(5);
    expect(lessonsMissed([{ lessons: null }], [])).toBeNull();
  });

  it('groups rows by month, newest first', () => {
    const months = absenceMonths(buildAbsenceRows([absence(), absence({ from: '2026-10-27T00:00:00Z', until: '2026-10-27T00:00:00Z' })], [], context()));
    expect(months.map((m) => m.key)).toEqual(['2026-10', '2026-09']);
  });


  it('reads a date-only value as its date', () => {
    expect(dayOf('2026-11-05T00:00:00Z')).toBe('2026-11-05');
    expect(dayOf('2026-11-05T23:30:00Z')).toBe('2026-11-06');
  });
});
