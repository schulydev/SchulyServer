import { AbsenceDto, SemesterReportDto } from '../api';
import { AbsenceStep, absenceSteps, approvalState, rejectedLabel, waitingLabel } from './absence-steps';
import { uiLocale } from './date-format';

/** The parts of a reported, unprocessed absence the page needs. */
export interface ReportInput {
  dateFrom: string;
  dateTo: string;
  hourFrom: string | null;
  hourTo: string | null;
  reason: string | null;
  comment: string | null;
}

export type AbsenceState = 'excused' | 'needs-excuse' | 'unexcused' | 'waiting' | 'rejected' | 'upcoming' | 'unknown';

export interface AbsenceRow<R extends ReportInput = ReportInput> {
  key: string;
  isDelay: boolean;
  from: string;
  until: string;
  time: string | null;
  reason: string;
  note: string | null;
  state: AbsenceState;
  status: string;
  steps: AbsenceStep[];
  trainerComment: string | null;
  lessons: number | null;
  /** The report to withdraw, while the school hasn't processed it. */
  report: R | null;
  printUrl: string | null;
  bbb: boolean;
}

export interface AbsenceContext {
  today: string;
  /** BBB's rules are only confirmed there. Null is a report, which doesn't say which school it's from. */
  isBbb: (schoolId: string | null) => boolean;
  website: (schoolId: string | null) => string | null;
}

export const isBbbWebsite = (website: string | null | undefined): boolean => {
  try {
    return !!website && new URL(website).hostname.toLowerCase() === 'schulnetz.bbbaden.ch';
  } catch {
    return false;
  }
};

const SWISS = 'Europe/Zurich';
const swissDay = new Intl.DateTimeFormat('en-CA', { timeZone: SWISS, year: 'numeric', month: '2-digit', day: '2-digit' });
const swissTime = new Intl.DateTimeFormat('en-GB', { timeZone: SWISS, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const todayInSwitzerland = (now = new Date()): string => swissDay.format(now);

/** Schuly stores a date-only absence as midnight UTC, which isn't a time anyone was absent. */
const isDateOnly = (iso: string): boolean => /T00:00:00(\.0+)?(Z|\+00:00)?$/.test(iso);

export const dayOf = (iso: string): string => (isDateOnly(iso) ? iso.slice(0, 10) : swissDay.format(new Date(iso)));

const timeOf = (a: AbsenceDto): string | null => {
  if (a.startTime && a.endTime) return `${a.startTime} – ${a.endTime}`;
  if (isDateOnly(a.from)) return null;
  const start = swissTime.format(new Date(a.from));
  const end = swissTime.format(new Date(a.until));
  return start === end ? start : `${start} – ${end}`;
};

const addDays = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const label = (day: string, options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(uiLocale(), { ...options, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

/** 09.11., the way a Zeugnis writes it whatever the browser's language. */
const shortDate = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

/** Mo, 09.11. */
export const shortDay = (day: string): string => `${label(day, { weekday: 'short' }).replace(/\.$/, '')}, ${shortDate(day)}`;

/** BBB: unforeseen absences within 14 days after the absence. */
const BBB_EXCUSE_DAYS = 14;

/** The same absence listed twice before the sync stopped doing that: an excused copy is the newer one. */
function mergeCopies(absences: AbsenceDto[]): AbsenceDto[] {
  const byIdentity = new Map<string, AbsenceDto>();
  for (const absence of absences) {
    const key = [absence.type, absence.from, absence.until, absence.reason.trim()].join('|');
    const seen = byIdentity.get(key);
    if (!seen) {
      byIdentity.set(key, absence);
    } else if (absence.isExcused === true && seen.isExcused !== true) {
      byIdentity.set(key, { ...seen, isExcused: true });
    }
  }
  return [...byIdentity.values()];
}

function buildRow<R extends ReportInput>(absence: AbsenceDto | null, report: R | null, context: AbsenceContext): AbsenceRow<R> {
  const from = absence ? dayOf(absence.from) : (report as R).dateFrom.slice(0, 10);
  const until = absence ? dayOf(absence.until) : (report as R).dateTo.slice(0, 10);
  const isDelay = absence?.type === 'Delay';
  const schoolId = absence?.schoolId ?? null;
  const bbb = context.isBbb(schoolId);
  const excused = absence?.isExcused === true;
  const steps = excused || isDelay ? [] : absenceSteps({ reported: !!report, parentStatus: absence?.parentStatus, trainerStatus: absence?.trainerStatus });
  const rejected = rejectedLabel(steps);
  const waiting = waitingLabel(steps);
  const future = from > context.today;
  const deadline = absence?.excuseDeadline ?? (bbb && !isDelay ? addDays(until, BBB_EXCUSE_DAYS) : null);
  const expected = !absence?.excuseDeadline;

  let state: AbsenceState;
  let status: string;
  if (excused) {
    [state, status] = ['excused', 'Excused'];
  } else if (rejected) {
    [state, status] = ['rejected', rejected];
  } else if (waiting) {
    [state, status] = ['waiting', waiting];
  } else if (future) {
    [state, status] = ['upcoming', 'Upcoming'];
  } else if (absence?.isExcused === false && !isDelay && deadline && deadline >= context.today) {
    [state, status] = ['needs-excuse', `Needs an excuse by ${shortDate(deadline)}${expected ? ' (expected)' : ''}`];
  } else if (absence?.isExcused === false) {
    [state, status] = ['unexcused', 'Not excused'];
  } else {
    [state, status] = ['unknown', ''];
  }

  const trainer = approvalState(absence?.trainerStatus);
  const trainerDone = trainer === 'confirmed' || trainer === 'excused';
  const website = context.website(schoolId);
  const canPrint = bbb && !isDelay && !trainerDone && (state === 'needs-excuse' || state === 'waiting');

  return {
    key: absence?.id ?? `report|${from}|${until}|${report?.reason ?? ''}`,
    isDelay,
    from,
    until,
    time: absence ? (timeOf(absence) ?? (report?.hourFrom && report.hourTo ? `${report.hourFrom} – ${report.hourTo}` : null)) : report?.hourFrom && report.hourTo ? `${report.hourFrom} – ${report.hourTo}` : null,
    reason: absence?.reason || report?.reason || 'Absent',
    note: absence?.comment || report?.comment || null,
    state,
    status,
    steps,
    trainerComment: absence?.trainerComment || null,
    lessons: absence?.lessons ?? null,
    report,
    printUrl: canPrint ? website : null,
    bbb,
  };
}

/** One row per absence: a report and the absence it became are the same thing, so they share a row and keep the Withdraw action. */
export function buildAbsenceRows<R extends ReportInput>(absences: AbsenceDto[], reports: R[], context: AbsenceContext): AbsenceRow<R>[] {
  const unmatched = mergeCopies(absences);
  const rows: AbsenceRow<R>[] = [];
  for (const report of reports) {
    const sameDates = unmatched.filter((a) => a.type !== 'Delay' && dayOf(a.from) === report.dateFrom.slice(0, 10) && dayOf(a.until) === report.dateTo.slice(0, 10));
    const match = sameDates.find((a) => a.reason === report.reason) ?? sameDates[0] ?? null;
    if (match) unmatched.splice(unmatched.indexOf(match), 1);
    rows.push(buildRow(match, report, context));
  }
  for (const absence of unmatched) rows.push(buildRow<R>(absence, null, context));
  return rows.sort((a, b) => b.from.localeCompare(a.from) || b.key.localeCompare(a.key));
}

export interface AbsenceSemester {
  key: string;
  year: number;
  half: number;
  label: string;
}

/** A school year's first half runs August to January, the second February to July. */
export function semesterKeyOf(day: string): string {
  const [year, month] = day.split('-').map(Number);
  const start = month >= 8 ? year : year - 1;
  return `${start}-${month >= 8 || month === 1 ? 1 : 2}`;
}

/** Newest first, always with the current semester. Numbers count from the first report or absence, as the Zeugnis does. */
export function absenceSemesters(rows: { from: string }[], reports: SemesterReportDto[], today: string): AbsenceSemester[] {
  const keys = new Set([semesterKeyOf(today), ...rows.map((r) => semesterKeyOf(r.from))]);
  for (const report of reports) keys.add(`${report.schoolYearStart}-${report.semesterHalf}`);
  const parsed = [...keys].map((key) => key.split('-').map(Number));
  const firstYear = Math.min(...parsed.map(([year]) => year));
  return parsed
    .map(([year, half]) => ({ key: `${year}-${half}`, year, half, label: `Semester ${(year - firstYear) * 2 + half} · ${year}/${String(year + 1).slice(2)}` }))
    .sort((a, b) => b.year - a.year || b.half - a.half);
}

/** Weekdays someone was absent up to today, each counted once, from the dates alone. */
export function daysMissed(rows: { isDelay: boolean; from: string; until: string }[], today: string): number {
  const days = new Set<string>();
  for (const row of rows) {
    if (row.isDelay) continue;
    for (let day = row.from; day <= row.until && day <= today; day = addDays(day, 1)) {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6) days.add(day);
    }
  }
  return days.size;
}

/** The Zeugnis counts lessons once it exists; before that, what the school sent per absence; otherwise nothing is known. */
export function lessonsMissed(rows: { lessons: number | null }[], reports: SemesterReportDto[]): number | null {
  const fromReports = reports
    .map((r) => r.totalAbsences ?? (r.excusedAbsences == null && r.unexcusedAbsences == null ? null : (r.excusedAbsences ?? 0) + (r.unexcusedAbsences ?? 0)))
    .filter((n): n is number => n != null);
  if (fromReports.length) return fromReports.reduce((sum, n) => sum + n, 0);
  const fromRows = rows.map((r) => r.lessons).filter((n): n is number => n != null);
  return fromRows.length ? fromRows.reduce((sum, n) => sum + n, 0) : null;
}

export interface AbsenceAnswer {
  text: string;
  tone: 'bad' | 'none';
  hint: string;
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The first thing the page says: does this student have to do anything? */
export function absenceAnswer(rows: AbsenceRow[]): AbsenceAnswer {
  const of = (state: AbsenceState) => rows.filter((r) => r.state === state);
  const needs = of('needs-excuse');
  const rejected = of('rejected');
  const unexcused = of('unexcused');
  const waiting = of('waiting');
  const upcoming = of('upcoming');
  const atBbb = rows.some((r) => r.bbb);

  if (needs.length) {
    return { text: count(needs.length, 'absence needs an excuse', 'absences need an excuse'), tone: 'bad', hint: needs.some((r) => r.bbb) ? 'Within 14 days after the absence. CHF 10 per lesson if it stays unexcused.' : 'Excuse it the way your school asks.' };
  }
  if (rejected.length) {
    return { text: count(rejected.length, 'absence was rejected', 'absences were rejected'), tone: 'bad', hint: 'Check with whoever rejected it, or with your school.' };
  }
  if (unexcused.length) {
    return { text: unexcused.length === 1 ? "1 absence isn't excused" : `${unexcused.length} absences aren't excused`, tone: 'bad', hint: atBbb ? 'Unexcused absences cost CHF 10 per lesson and go on the Zeugnis.' : "Your school's rules decide what happens next." };
  }
  if (waiting.length) {
    const byStatus = new Map<string, number>();
    for (const row of waiting) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    return { text: 'Nothing to do right now', tone: 'none', hint: `${[...byStatus].map(([status, n]) => `${n} ${status.charAt(0).toLowerCase()}${status.slice(1)}`).join(', ')}.` };
  }
  if (upcoming.length) {
    return { text: 'Nothing to do right now', tone: 'none', hint: atBbb ? 'Planned absences go into Schulnetz at least 7 days before.' : `${count(upcoming.length, 'absence', 'absences')} coming up.` };
  }
  if (rows.some((r) => r.state === 'excused') && rows.every((r) => r.state === 'excused' || r.isDelay)) {
    return { text: 'All excused', tone: 'none', hint: 'Every absence this semester is excused.' };
  }
  if (!rows.length) return { text: 'No absences this semester', tone: 'none', hint: 'Absences and delays recorded by your school show up here.' };
  return { text: 'Nothing marked as open', tone: 'none', hint: "Your school doesn't say whether all of these are excused." };
}

export interface AbsenceMonth<R extends ReportInput = ReportInput> {
  key: string;
  label: string;
  rows: AbsenceRow<R>[];
}

export function absenceMonths<R extends ReportInput>(rows: AbsenceRow<R>[]): AbsenceMonth<R>[] {
  const months: AbsenceMonth<R>[] = [];
  for (const row of rows) {
    const key = row.from.slice(0, 7);
    let month = months.find((m) => m.key === key);
    if (!month) {
      month = { key, label: label(row.from, { month: 'long', year: 'numeric' }), rows: [] };
      months.push(month);
    }
    month.rows.push(row);
  }
  return months;
}
