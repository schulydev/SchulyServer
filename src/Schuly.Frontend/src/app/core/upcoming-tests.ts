import { AgendaEntryDto } from '../api';
import { dateOnly } from './calendar';
import { subjectKey } from './grade-report';

export interface UpcomingTest {
  key: string;
  title: string;
  subject: string;
  /** Local start; midnight for a test without a time. */
  start: Date;
  end: Date | null;
  allDay: boolean;
  room: string | null;
}

/** An exam the school listed, which may not be in the agenda. */
export interface ExamInput {
  id: string;
  name: string;
  subject: string;
  date: string | null;
  score: number | null;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * Tests from today on that aren't graded yet, soonest first. The agenda knows the time and room; an exam the agenda
 * doesn't have (same subject, same day) still counts, with its date only.
 */
export function upcomingTests(agenda: AgendaEntryDto[], exams: ExamInput[], subjectOf: (classId: string | null | undefined) => string, now: Date): UpcomingTest[] {
  const today = startOfDay(now).getTime();
  const tests: UpcomingTest[] = [];
  for (const entry of agenda) {
    if (entry.entryType !== 'Test') continue;
    const day = dateOnly(entry.date);
    const allDay = day !== null && (!entry.endDate || dateOnly(entry.endDate) !== null);
    const start = allDay ? day! : new Date(entry.date);
    if (Number.isNaN(start.getTime()) || startOfDay(start).getTime() < today) continue;
    tests.push({ key: `agenda|${entry.id ?? entry.date}`, title: entry.title, subject: subjectOf(entry.classId), start, end: !allDay && entry.endDate ? new Date(entry.endDate) : null, allDay, room: entry.place || null });
  }
  const known = new Set(tests.map((t) => `${subjectKey(t.subject)}|${dayKey(t.start)}`));
  for (const exam of exams) {
    if (exam.score != null || !exam.date) continue;
    const day = dateOnly(exam.date) ?? new Date(exam.date);
    if (Number.isNaN(day.getTime()) || startOfDay(day).getTime() < today) continue;
    const allDay = dateOnly(exam.date) !== null;
    if (known.has(`${subjectKey(exam.subject)}|${dayKey(day)}`)) continue;
    tests.push({ key: `exam|${exam.id}`, title: exam.name, subject: exam.subject, start: day, end: null, allDay, room: null });
  }
  return tests.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The next test for each subject, by the same key the Grades page groups subjects with. */
export function nextTestBySubject(tests: UpcomingTest[]): Map<string, UpcomingTest> {
  const next = new Map<string, UpcomingTest>();
  for (const test of tests) {
    const key = subjectKey(test.subject);
    if (test.subject && !next.has(key)) next.set(key, test);
  }
  return next;
}
