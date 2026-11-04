/**
 * Turns exam grades and semester reports into what the Grades page shows, the way a Zeugnis counts.
 *
 * BBB's rules, worked out from real reports (other schools aren't confirmed, so they get no calculated overall number):
 * a subject is its weighted exam average rounded to a half grade, the semester average is the plain mean of the subjects, and
 * interdisciplinary work (IDAF, IDPA) stays out of it. A real report always wins over anything calculated here.
 */

export interface ExamGrade {
  id: string;
  subject: string;
  exam: string;
  date: string | null;
  score: number;
  weighting: number;
  classAverage: number | null;
  schoolId: string | null;
}

export interface ReportSubject {
  subjectName: string;
  grade?: number | null;
  marker?: string | null;
}

export interface SemesterReport {
  schoolUserId?: string | null;
  programCode: string;
  schoolYearStart: number;
  semesterHalf: number;
  className: string;
  promotionDecision?: string | null;
  gradeAverage?: number | null;
  deficiencyPoints?: number | null;
  unexcusedAbsences?: number | null;
  subjects?: ReportSubject[] | null;
}

export interface SubjectResult {
  key: string;
  name: string;
  /** The grade on the Zeugnis, or the expected one; an unrounded average at schools whose rules aren't confirmed. */
  grade: number | null;
  /** The report's text when it has no number, like "disp". */
  marker: string | null;
  /** The weighted average of the exams themselves. */
  exact: number | null;
  counted: boolean;
  rows: ExamGrade[];
}

export interface SemesterResult {
  key: string;
  yearStart: number;
  half: number;
  number: number;
  year: string;
  label: string;
  report: SemesterReport | null;
  /** Calculated with BBB's rules because the report doesn't exist yet. */
  expected: boolean;
  average: number | null;
  deviation: number | null;
  gradeCount: number;
  subjects: SubjectResult[];
}

export interface GradeGroup {
  key: string;
  label: string;
  bbbRules: boolean;
  semesters: SemesterResult[];
  /** Grades no semester can be worked out for. */
  undated: ExamGrade[];
}

export const OTHER_GROUP = 'other';
const DEFAULT_GROUP = 'all';

/** A score of 0 is how an ungraded entry arrives from the school. */
export const isGraded = (score: number | null | undefined): boolean => (score ?? 0) > 0;

export const halfGrade = (value: number): number => Math.round(value * 2) / 2;

/** How the printed Zeugnis shows an average: 4.25 is 4.3 and 4.625 is 4.6. */
export const oneDecimal = (value: number): string => (Math.round(value * 10 + 1e-9) / 10).toFixed(1);

export function weightedMean(rows: { score: number; weighting: number }[]): number | null {
  const graded = rows.filter((r) => isGraded(r.score));
  const weight = graded.reduce((sum, r) => sum + r.weighting, 0);
  return weight ? graded.reduce((sum, r) => sum + r.score * r.weighting, 0) / weight : null;
}

const INTERDISCIPLINARY = /^(idaf|idpa|interdisziplin)/i;
export const countsInAverage = (subject: string, bbbRules: boolean): boolean => !bbbRules || !INTERDISCIPLINARY.test(subject.trim());

/** Mean of the subject grades, every subject equal. */
export function semesterAverage(grades: number[]): number | null {
  return grades.length ? grades.reduce((sum, g) => sum + g, 0) / grades.length : null;
}

/** Points below 4 added up, the Zeugnis's "Negative Notenabweichung". */
export const negativeDeviation = (grades: number[]): number => grades.reduce((sum, g) => sum + Math.max(0, 4 - g), 0);

/** August to January is a school year's first half, February to July its second. */
export function semesterOfDate(iso: string): { yearStart: number; half: number } {
  const [year, month] = iso.split('-').map(Number);
  return { yearStart: month >= 8 ? year : year - 1, half: month >= 8 || month === 1 ? 1 : 2 };
}

/** The same subject is spelled differently in grades and reports: "Modul 294 - Frontend ... IN2023-1A" and "294 Frontend ...". */
export function subjectKey(name: string): string {
  const text = name.trim().toLowerCase();
  const module = /^(?:modul\s*)?(\d{3})\b/.exec(text);
  if (module) return `module:${module[1]}`;
  if (/^idaf\b/.test(text) || /^interdisziplin\S* arbeiten in den f/.test(text)) return 'idaf';
  return text.replace(/\s+/g, ' ');
}

export function subjectLabel(name: string): string {
  return name
    .trim()
    .replace(/^modul\s*(\d{3})\s*-?\s*/i, '$1 ')
    .replace(/\s+[A-Z]{2,}\d{2,4}-\w+$/, '');
}

/** Drops the date a school repeats in the name, and a leading class or subject the page already shows. */
export function cleanExamName(exam: string, subject: string, classNames: string[] = []): string {
  let name = exam.trim().replace(/\s*\(\d{1,2}\.\d{1,2}\.\d{4}\)\s*$/, '');
  for (const code of classNames.filter(Boolean)) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    name = name.replace(new RegExp(`^${escaped}\\s*-\\s*`, 'i'), '');
  }
  const word = subject.trim().split(/[\s(]/)[0];
  if (word) name = name.replace(new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '');
  return name.trim() || exam.trim();
}

const semesterKey = (yearStart: number, half: number) => `${yearStart}-${half}`;
const yearLabel = (yearStart: number) => `${yearStart}/${String((yearStart + 1) % 100).padStart(2, '0')}`;

interface Candidate {
  group: string;
  semester: string;
  graded: boolean;
}

/** Every grade needs a class, but only reports know which subject belongs to which: the same subject in the same semester, else the latest. */
function pickReportMatch(candidates: Candidate[], semester: string | null): Candidate | null {
  const same = candidates.filter((c) => c.semester === semester);
  const pool = same.length ? same : candidates;
  const ordered = [...pool].sort((a, b) => Number(b.graded) - Number(a.graded) || b.semester.localeCompare(a.semester));
  return ordered[0] ?? null;
}

export function buildGradeGroups(grades: ExamGrade[], reports: SemesterReport[], usesBbbRules: (schoolId: string | null) => boolean): GradeGroup[] {
  const reportGroups = new Map<string, SemesterReport[]>();
  for (const report of reports) {
    const key = `${report.schoolUserId ?? ''}|${report.programCode}`;
    reportGroups.set(key, [...(reportGroups.get(key) ?? []), report]);
  }

  const bySubject = new Map<string, Candidate[]>();
  for (const [group, list] of reportGroups) {
    for (const report of list) {
      for (const subject of report.subjects ?? []) {
        const key = subjectKey(subject.subjectName);
        bySubject.set(key, [...(bySubject.get(key) ?? []), { group, semester: semesterKey(report.schoolYearStart, report.semesterHalf), graded: subject.grade != null }]);
      }
    }
  }

  const classHint = (grade: ExamGrade): string | null => {
    const text = `${grade.exam} ${grade.subject}`.toLowerCase();
    const code = /\b([A-Z]{2,})\d{2,4}-\w+$/.exec(grade.subject.trim())?.[1].toLowerCase();
    for (const [group, list] of reportGroups) {
      if (list.some((r) => r.className && text.includes(r.className.toLowerCase()))) return group;
      if (code && list.some((r) => r.className.toLowerCase().startsWith(code))) return group;
    }
    return null;
  };

  const placed = new Map<string, { semester: string | null; row: ExamGrade }[]>();
  for (const grade of grades) {
    const dated = grade.date ? semesterOfDate(grade.date) : null;
    const semester = dated ? semesterKey(dated.yearStart, dated.half) : null;
    const match = pickReportMatch(bySubject.get(subjectKey(grade.subject)) ?? [], semester);
    const group = match?.group ?? classHint(grade) ?? (reportGroups.size === 0 ? DEFAULT_GROUP : reportGroups.size === 1 ? [...reportGroups.keys()][0] : OTHER_GROUP);
    placed.set(group, [...(placed.get(group) ?? []), { semester: semester ?? match?.semester ?? null, row: grade }]);
  }

  const result: GradeGroup[] = [];
  for (const key of new Set([...reportGroups.keys(), ...placed.keys()])) {
    const list = reportGroups.get(key) ?? [];
    const entries = placed.get(key) ?? [];
    // What couldn't be placed in a class isn't a Zeugnis, so nothing is predicted for it.
    const bbbRules = key !== OTHER_GROUP && (entries.length ? entries.some((e) => usesBbbRules(e.row.schoolId)) : usesBbbRules(null));
    const keys = new Set([...list.map((r) => semesterKey(r.schoolYearStart, r.semesterHalf)), ...entries.flatMap((e) => (e.semester ? [e.semester] : []))]);
    const ordered = [...keys].sort();
    const parse = (k: string) => k.split('-').map(Number);
    // Numbered within school years, as a Zeugnis is: an odd semester is always a first half, even for someone who joined in a second one.
    const [firstYear] = parse(ordered[0] ?? '0-1');

    const semesters = ordered.map((semester): SemesterResult => {
      const [yearStart, half] = parse(semester);
      const report = list.find((r) => semesterKey(r.schoolYearStart, r.semesterHalf) === semester) ?? null;
      const rows = entries.filter((e) => e.semester === semester).map((e) => e.row);
      const number = (yearStart - firstYear) * 2 + half;

      const subjects = new Map<string, SubjectResult>();
      for (const subject of report?.subjects ?? []) {
        const name = subjectLabel(subject.subjectName);
        subjects.set(subjectKey(subject.subjectName), { key: subjectKey(subject.subjectName), name, grade: subject.grade ?? null, marker: subject.marker ?? null, exact: null, counted: countsInAverage(name, bbbRules), rows: [] });
      }
      for (const row of rows) {
        const id = subjectKey(row.subject);
        const name = subjectLabel(row.subject);
        const entry = subjects.get(id) ?? { key: id, name, grade: null, marker: null, exact: null, counted: countsInAverage(name, bbbRules), rows: [] };
        entry.rows.push(row);
        subjects.set(id, entry);
      }
      for (const entry of subjects.values()) {
        entry.exact = weightedMean(entry.rows);
        if (entry.grade == null && !entry.marker && entry.exact != null) entry.grade = bbbRules ? halfGrade(entry.exact) : entry.exact;
      }

      const counted = [...subjects.values()].filter((s) => s.counted && s.grade != null).map((s) => s.grade as number);
      const expected = !report && bbbRules && rows.length > 0;
      return {
        key: semester,
        yearStart,
        half,
        number,
        year: yearLabel(yearStart),
        label: `Semester ${number} · ${yearLabel(yearStart)}`,
        report,
        expected,
        average: report ? (report.gradeAverage ?? null) : expected ? semesterAverage(counted) : null,
        deviation: bbbRules ? negativeDeviation(counted) : (report?.deficiencyPoints ?? null),
        gradeCount: rows.filter((r) => isGraded(r.score)).length,
        subjects: [...subjects.values()],
      };
    });

    const latest = [...list].sort((a, b) => semesterKey(b.schoolYearStart, b.semesterHalf).localeCompare(semesterKey(a.schoolYearStart, a.semesterHalf)))[0];
    result.push({
      key,
      label: key === OTHER_GROUP ? 'Other subjects' : (latest?.className ?? ''),
      bbbRules,
      semesters,
      undated: entries.filter((e) => e.semester === null).map((e) => e.row),
    });
  }

  // The newest class first; "Other subjects" is what couldn't be placed, so it stays last.
  const newest = (g: GradeGroup) => g.semesters[g.semesters.length - 1]?.key ?? '';
  return result.sort((a, b) => Number(a.key === OTHER_GROUP) - Number(b.key === OTHER_GROUP) || newest(b).localeCompare(newest(a)));
}

/** The class names a school may repeat in front of an exam name. */
export const groupClassNames = (group: GradeGroup): string[] => [...new Set(group.semesters.flatMap((s) => (s.report?.className ? [s.report.className] : [])).concat(group.label))];

export const allSemestersAverage = (group: GradeGroup): number | null => semesterAverage(group.semesters.flatMap((s) => (s.average != null ? [s.average] : [])));

/** "kein Promotionsentscheid" is a sentence in a one-word column, and means there's nothing to show. */
export const promotionText = (decision: string | null | undefined): string => (decision && !/^kein/i.test(decision) ? decision : '');

/**
 * What Schuly can honestly say about a class, read from the data: BBB's rules are confirmed, a school's real reports can only be quoted,
 * and without an average on them there's no overall number to show. When unsure, the version without a number wins.
 */
export type GradeCase = 'bbb' | 'reports-average' | 'reports-no-average' | 'no-reports' | 'none';

export function chooseGradeCase(group: GradeGroup | null): GradeCase {
  if (!group) return 'none';
  const hasGrades = group.undated.some((r) => isGraded(r.score)) || group.semesters.some((s) => s.gradeCount > 0);
  const hasReports = group.semesters.some((s) => s.report);
  if (!hasGrades && !hasReports) return 'none';
  if (group.bbbRules) return 'bbb';
  if (!hasReports) return 'no-reports';
  return group.semesters.some((s) => s.report?.gradeAverage != null) ? 'reports-average' : 'reports-no-average';
}

/** Only a class whose real reports carry a decision gets promoted at all: an apprenticeship's say "kein Promotionsentscheid" or nothing. */
export const hasPromotionDecisions = (group: GradeGroup): boolean => group.semesters.some((s) => !!promotionText(s.report?.promotionDecision));

export interface PromotionOutlook {
  atRisk: boolean;
  text: string;
}

/** BM's pass rule applied to a semester so far: at most 2 grades below 4, at most 2 points below 4, and an average of at least 4 once rounded to one decimal, so 3.95 counts as 4.0. */
export function promotionOutlook(grades: number[]): PromotionOutlook | null {
  const average = semesterAverage(grades);
  if (average == null) return null;
  const below = grades.filter((g) => g < 4).length;
  const points = negativeDeviation(grades);
  const risk = below > 2 ? `${below} subjects below 4, the limit is 2` : points > 2 ? `${points.toFixed(1)} points below 4, the limit is 2` : Number(oneDecimal(average)) < 4 ? 'the average is below 4' : '';
  return { atRisk: !!risk, text: risk ? `Promotion at risk: ${risk}` : 'On track for promotion' };
}

export const countedGrades = (semester: SemesterResult): number[] => semester.subjects.flatMap((s) => (s.counted && s.grade != null ? [s.grade] : []));

export const subjectsBelowFour = (subjects: SubjectResult[]): number => subjects.filter((s) => s.counted && (s.grade ?? 6) < 4).length;

export interface GradeHeadline {
  label: string;
  value: number | null;
  state: string;
  tone: 'good' | 'bad' | '';
  hint: string;
}

const belowText = (count: number) => (count ? `${count} ${count === 1 ? 'subject' : 'subjects'} below 4 so far` : 'No subject below 4 so far');
const NO_AVERAGE_HINT = "Your school's reports have no overall average, so Schuly doesn't show one.";

/** The top of the page for one semester, or for all of them when `semester` is null. */
export function gradeHeadline(group: GradeGroup, semester: SemesterResult | null, below: number, classSuffix = ''): GradeHeadline {
  const gradeCase = chooseGradeCase(group);
  const none: GradeHeadline = { label: '', value: null, state: '', tone: '', hint: '' };
  if (!semester) {
    const value = gradeCase === 'bbb' || gradeCase === 'reports-average' ? allSemestersAverage(group) : null;
    return { ...none, label: `All semesters${classSuffix}`, value, hint: value != null ? 'Average of the semester averages.' : '' };
  }
  const label = `${semester.label}${classSuffix}`;
  const promotion = promotionText(semester.report?.promotionDecision);
  const fromReport = { state: promotion ? `Promotion: ${promotion}` : '', tone: '' as const };

  if (semester.expected) {
    const outlook = hasPromotionDecisions(group) ? promotionOutlook(countedGrades(semester)) : null;
    const basis = `Expected, based on ${semester.gradeCount} ${semester.gradeCount === 1 ? 'grade' : 'grades'} so far.`;
    return { label, value: semester.average, state: outlook?.text ?? '', tone: outlook ? (outlook.atRisk ? 'bad' : 'good') : '', hint: outlook ? `${basis} Your school decides.` : basis };
  }
  if (semester.report && (gradeCase === 'bbb' || gradeCase === 'reports-average')) {
    return { ...none, ...fromReport, label, value: semester.report.gradeAverage ?? null, hint: 'From your Zeugnis.' };
  }
  if (semester.report) {
    return promotion ? { ...none, ...fromReport, label, hint: `From your Zeugnis. ${NO_AVERAGE_HINT}` } : { ...none, label, state: belowText(below).replace(' so far', ''), tone: below ? 'bad' : '', hint: NO_AVERAGE_HINT };
  }
  if (gradeCase === 'reports-average') {
    const last = [...group.semesters].reverse().find((s) => s.key < semester.key && s.report?.gradeAverage != null);
    const pending = `This semester's average appears when the Zeugnis is out. ${belowText(below)}.`;
    return last ? { ...none, label: `Last Zeugnis, ${last.label}${classSuffix}`, value: last.report?.gradeAverage ?? null, hint: pending } : { ...none, label, hint: pending };
  }
  const hint = group.key === OTHER_GROUP ? "Schuly couldn't match these subjects to a class." : gradeCase === 'reports-no-average' ? NO_AVERAGE_HINT : group.semesters.length > 1 ? 'Schuly has no Zeugnis for you yet.' : 'Your first Zeugnis comes at the end of this semester.';
  return { ...none, label, state: belowText(below), tone: below ? 'bad' : '', hint };
}

export function isBbbWebsite(website: string | null | undefined): boolean {
  if (!website) return false;
  try {
    return new URL(website).hostname.toLowerCase() === 'schulnetz.bbbaden.ch';
  } catch {
    return false;
  }
}
