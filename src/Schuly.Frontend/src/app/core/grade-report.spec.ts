import { describe, expect, it } from 'vitest';
import { ExamGrade, OTHER_GROUP, SemesterReport, allSemestersAverage, buildGradeGroups, cleanExamName, countsInAverage, halfGrade, isBbbWebsite, negativeDeviation, oneDecimal, promotionText, semesterAverage, semesterOfDate, subjectKey, subjectLabel, weightedMean } from './grade-report';

let id = 0;
const exam = (subject: string, date: string | null, score: number, weighting = 1, name = 'Test'): ExamGrade => ({ id: `e${++id}`, subject, exam: name, date, score, weighting, classAverage: 4.5, schoolId: 's1' });
const report = (className: string, schoolYearStart: number, semesterHalf: number, subjects: Record<string, number | string>, gradeAverage?: number): SemesterReport => ({
  schoolUserId: 'u1',
  programCode: className.slice(0, 2),
  schoolYearStart,
  semesterHalf,
  className,
  promotionDecision: 'def.',
  gradeAverage,
  unexcusedAbsences: 0,
  subjects: Object.entries(subjects).map(([subjectName, value]) => (typeof value === 'number' ? { subjectName, grade: value } : { subjectName, marker: value })),
});
const bbb = () => true;
const other = () => false;

describe('how a Zeugnis counts', () => {
  it('takes the plain mean of the subjects and prints one decimal', () => {
    expect(semesterAverage([5.5, 4, 3.5, 5.5])).toBe(4.625);
    expect(oneDecimal(4.625)).toBe('4.6');
    expect(semesterAverage([4, 5.5, 4, 3.5])).toBe(4.25);
    expect(oneDecimal(4.25)).toBe('4.3');
  });

  it('leaves IDAF out of the average', () => {
    const subjects = ['IDAF', 'Deutsch', 'Mathematik Grundlagen', 'Englisch', 'Französisch'];
    const grades = [5.5, 5, 4.5, 5.5, 4];
    const counted = grades.filter((_, i) => countsInAverage(subjects[i], true));
    expect(counted).toEqual([5, 4.5, 5.5, 4]);
    expect(semesterAverage(counted)).toBe(4.75);
    expect(oneDecimal(4.75)).toBe('4.8');
    expect(countsInAverage('Interdisziplinäres Arbeiten in den Fächern', true)).toBe(false);
    expect(countsInAverage('IDAF', false)).toBe(true);
  });

  it('adds up the points below 4', () => {
    expect(negativeDeviation([3, 5, 5])).toBe(1);
    expect(negativeDeviation([3.5, 5])).toBe(0.5);
    expect(negativeDeviation([4, 6])).toBe(0);
  });

  it('rounds a weighted subject to a half grade', () => {
    const rows = [
      { score: 5.2, weighting: 1 },
      { score: 4.0, weighting: 0.6 },
      { score: 4.1, weighting: 0.4 },
      { score: 5.1, weighting: 1 },
    ];
    expect(halfGrade(weightedMean(rows)!)).toBe(5);
  });

  it('ignores a score of 0, which means not graded', () => {
    expect(weightedMean([{ score: 0, weighting: 1 }])).toBeNull();
    expect(weightedMean([{ score: 0, weighting: 1 }, { score: 5, weighting: 1 }])).toBe(5);
  });
});

describe('names', () => {
  it('matches a module however it is spelled', () => {
    expect(subjectKey('Modul 294 - Frontend einer Webapplikation IN2023-1A')).toBe(subjectKey('294 Frontend einer Webapplikation'));
    expect(subjectKey('323 Funktional programmieren')).toBe(subjectKey('323 Funktional Programmieren'));
    expect(subjectKey('Interdisziplinäres Arbeiten in den Fächern')).toBe(subjectKey('IDAF'));
    expect(subjectLabel('Modul 294 - Frontend realisieren IN2023-1A')).toBe('294 Frontend realisieren');
  });

  it('cleans exam names', () => {
    expect(cleanExamName('Test 2 Eherecht (15.10.2026)', 'Wirtschaft und Recht')).toBe('Test 2 Eherecht');
    expect(cleanExamName('Mathematik:Gleichungen 2 (20.05.2026)', 'Mathematik Schwerpunkt')).toBe('Gleichungen 2');
    expect(cleanExamName('BM23d - Essay (03.09.2025)', 'Deutsch', ['BM23d'])).toBe('Essay');
    expect(cleanExamName('IN23a-Selbstkompetenz (01.06.2026)', 'Sport', ['IN23a'])).toBe('Selbstkompetenz');
    expect(cleanExamName('Physik 2 (Elektrizität 2) (15.10.2026)', 'Naturwissenschaften (Physik)')).toBe('Physik 2 (Elektrizität 2)');
  });

  it('shows only a real promotion decision', () => {
    expect(promotionText('def.')).toBe('def.');
    expect(promotionText('kein Promotionsentscheid')).toBe('');
    expect(promotionText(null)).toBe('');
  });

  it('recognises BBB only by its own host', () => {
    expect(isBbbWebsite('https://schulnetz.bbbaden.ch')).toBe(true);
    expect(isBbbWebsite('https://schulnetz.bbbaden.ch.evil.example')).toBe(false);
    expect(isBbbWebsite(null)).toBe(false);
  });
});

describe('semesters', () => {
  it('runs August to January, then February to July', () => {
    expect(semesterOfDate('2026-08-20')).toEqual({ yearStart: 2026, half: 1 });
    expect(semesterOfDate('2026-01-15')).toEqual({ yearStart: 2025, half: 1 });
    expect(semesterOfDate('2026-02-01')).toEqual({ yearStart: 2025, half: 2 });
    expect(semesterOfDate('2026-07-31')).toEqual({ yearStart: 2025, half: 2 });
  });

  it('numbers semesters from the first report, across class renames', () => {
    const [group] = buildGradeGroups([], [report('BM23f', 2023, 1, { Deutsch: 4.5 }), report('BM23d', 2025, 2, { Deutsch: 5 })], bbb);
    expect(group.label).toBe('BM23d');
    expect(group.semesters.map((s) => s.number)).toEqual([1, 6]);
    expect(group.semesters[1].label).toBe('Semester 6 · 2025/26');
    const [late] = buildGradeGroups([], [report('BM24a', 2024, 2, { Deutsch: 5 })], bbb);
    expect(late.semesters[0].number).toBe(2);
  });
});

describe('buildGradeGroups', () => {
  it('uses the real report over anything calculated', () => {
    const [group] = buildGradeGroups([exam('Deutsch', '2025-09-03', 5.2)], [report('BM23d', 2025, 1, { Deutsch: 5 }, 4.4)], bbb);
    const [semester] = group.semesters;
    expect(semester.report).not.toBeNull();
    expect(semester.expected).toBe(false);
    expect(semester.average).toBe(4.4);
    expect(semester.subjects[0].grade).toBe(5);
    expect(semester.subjects[0].exact).toBe(5.2);
  });

  it('calculates the expected semester at BBB, without IDAF', () => {
    const grades = [exam('Deutsch', '2026-09-03', 5.1), exam('Deutsch', '2026-10-22', 4), exam('Mathematik Schwerpunkt', '2026-10-22', 3), exam('Interdisziplinäres Arbeiten in den Fächern', '2026-09-25', 5)];
    const [group] = buildGradeGroups(grades, [report('BM23d', 2025, 1, { Deutsch: 5, 'Mathematik Schwerpunkt': 3, IDAF: 5.5 }, 4.4)], bbb);
    const current = group.semesters[group.semesters.length - 1];
    expect(current.expected).toBe(true);
    expect(current.average).toBe(3.75);
    expect(current.deviation).toBe(1);
    expect(current.number).toBe(3);
    expect(current.subjects.find((s) => s.key === 'idaf')?.counted).toBe(false);
  });

  it('gives other schools no calculated overall number and no half-grade rounding', () => {
    const [group] = buildGradeGroups([exam('Deutsch', '2026-09-03', 5.2)], [], other);
    const [semester] = group.semesters;
    expect(group.bbbRules).toBe(false);
    expect(semester.expected).toBe(false);
    expect(semester.average).toBeNull();
    expect(semester.deviation).toBeNull();
    expect(semester.subjects[0].grade).toBe(5.2);
  });

  it('keeps the printed average of a report at other schools', () => {
    const [group] = buildGradeGroups([], [report('G1a', 2025, 1, { Deutsch: 5.25 }, 5.3)], other);
    expect(group.semesters[0].average).toBe(5.3);
    expect(group.semesters[0].subjects[0].grade).toBe(5.25);
  });

  it('leaves an ungraded score out of counts and averages but keeps it visible', () => {
    const [group] = buildGradeGroups([exam('Modul 106 - Datenbanken IN2023-1A', '2026-09-03', 0), exam('Sport', '2026-09-03', 5)], [], bbb);
    const [semester] = group.semesters;
    expect(semester.gradeCount).toBe(1);
    expect(semester.average).toBe(5);
    const module = semester.subjects.find((s) => s.key === 'module:106');
    expect(module?.grade).toBeNull();
    expect(module?.rows).toHaveLength(1);
  });

  it('places an undated grade through its report, or keeps it apart', () => {
    const reports = [report('IN23a', 2024, 2, { '294 Frontend realisieren': 6 })];
    const [group] = buildGradeGroups([exam('Modul 294 - Frontend realisieren IN2023-1A', null, 6), exam('Modul 999 - Unbekannt IN2023-1A', null, 5)], reports, bbb);
    expect(group.semesters[0].subjects[0].rows).toHaveLength(1);
    expect(group.undated.map((r) => r.subject)).toEqual(['Modul 999 - Unbekannt IN2023-1A']);
  });

  it('assigns subjects to their class through the reports', () => {
    const reports = [report('BM23d', 2025, 1, { Deutsch: 5 }), report('IN23a', 2025, 1, { Sport: 5 })];
    const groups = buildGradeGroups([exam('Deutsch', '2026-09-03', 5), exam('Sport', '2026-09-03', 5)], reports, bbb);
    const of = (subject: string) => groups.find((g) => g.semesters.some((s) => s.subjects.some((x) => x.name === subject && x.rows.length)))?.label;
    expect(of('Deutsch')).toBe('BM23d');
    expect(of('Sport')).toBe('IN23a');
  });

  it('uses the class in a name when the reports do not know the subject', () => {
    const reports = [report('BM23d', 2025, 1, { Deutsch: 5 }), report('IN23a', 2025, 1, { Sport: 5 })];
    const groups = buildGradeGroups([exam('Neues Fach', '2026-09-03', 5, 1, 'BM23d - Test'), exam('Modul 210 - Cloud IN2023-1A', '2026-09-03', 6)], reports, bbb);
    expect(groups.find((g) => g.label === 'BM23d')?.semesters.at(-1)?.subjects.map((s) => s.name)).toEqual(['Neues Fach']);
    expect(groups.find((g) => g.label === 'IN23a')?.semesters.at(-1)?.subjects.map((s) => s.name)).toEqual(['210 Cloud']);
  });

  it('shows what cannot be placed as other subjects', () => {
    const reports = [report('BM23d', 2025, 1, { Deutsch: 5 }), report('IN23a', 2025, 1, { Sport: 5 })];
    const groups = buildGradeGroups([exam('Unbekannt', '2026-09-03', 5)], reports, bbb);
    expect(groups[groups.length - 1].key).toBe(OTHER_GROUP);
    expect(groups[groups.length - 1].label).toBe('Other subjects');
  });

  it('survives having nothing at all', () => {
    expect(buildGradeGroups([], [], bbb)).toEqual([]);
  });

  it('averages all semesters from those that have a number', () => {
    const [group] = buildGradeGroups([], [report('BM23d', 2024, 1, { Deutsch: 5 }, 4), report('BM23d', 2024, 2, { Deutsch: 5 }, 5), report('BM23d', 2025, 1, { Deutsch: 5 })], bbb);
    expect(allSemestersAverage(group)).toBe(4.5);
  });
});
