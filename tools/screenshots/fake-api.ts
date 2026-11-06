// Stand-in for the Schuly API with made-up data, for the sign-in page screenshots of the Overview.
// Usage: bun tools/screenshots/fake-api.ts   (PORT=5048 by default; SHOTS_NOW=<ISO time> pins "now", which capture.ts sets)
// The school website picks which school's rules the web app applies, such as the absence fee on the Overview.
const website = 'https://schulnetz.bbbaden.ch';
const PORT = Number(process.env.PORT ?? 5048);
// Mia's made-up profile picture, sent as a data URL so the screenshot needs no image server.
const PFP = 'data:image/svg+xml;base64,' + Buffer.from(await Bun.file(import.meta.dir + '/pfp.svg').arrayBuffer()).toString('base64');
const now = () => (process.env.SHOTS_NOW ? new Date(process.env.SHOTS_NOW) : new Date());
const classes = new Map<string, string>();
const classId = (name: string) => {
  if (!classes.has(name)) classes.set(name, `c${classes.size + 1}`);
  return classes.get(name)!;
};
let n = 0;
const exam = (subject: string, name: string, date: string | null, score: number, cls = 4.5, weighting = 1) => ({
  id: `e${++n}`, name, description: null, type: 'Exam', date, classAverage: cls, classId: classId(subject), schoolId: 's1',
  grades: [{ id: `g${n}`, score, weighting, examId: `e${n}`, schoolUserId: 'u1' }],
});
const exams = [
  exam('Mathematik Schwerpunkt', 'Mathematik: Potenzfunktionen (22.10.2026)', '2026-10-22', 3.9, 4.6),
  exam('Mathematik Schwerpunkt', 'Mathematik:Polynomfunktionen (27.08.2026)', '2026-08-27', 3.6, 4.7),
  exam('Deutsch', 'BM23d - Mündliche Prüfung Projekt (22.10.2026)', '2026-10-22', 5.5, 5.2),
  exam('Deutsch', 'BM23d - Test Sprachnormen (03.09.2026)', '2026-09-03', 5.1, 4.4),
  exam('Wirtschaft und Recht', 'Test 2 Eherecht (15.10.2026)', '2026-10-15', 5.5, 4.9),
  exam('Wirtschaft und Recht', 'Test 1 Mietrecht (03.09.2026)', '2026-09-03', 3.6, 4.5),
  exam('Naturwissenschaften (Physik)', 'Elektrizität 2 (15.10.2026)', '2026-10-15', 5.6, 5.3),
  exam('Naturwissenschaften (Physik)', 'Energie und Grundlagen (10.09.2026)', '2026-09-10', 3.5, 4.2),
  exam('Geschichte und Politik', 'Erster Weltkrieg (20.08.2026)', '2026-08-20', 5.0, 4.9),
  exam('Interdisziplinäres Arbeiten in den Fächern', 'Zinseszins (25.09.2026)', '2026-09-25', 5.0, 4.8),
  exam('Mathematik Schwerpunkt', 'Mathematik: Semesterprüfung (10.06.2026)', '2026-06-10', 4.3, 5.0, 2),
  exam('Mathematik Schwerpunkt', 'Mathematik: Gleichungen (20.05.2026)', '2026-05-20', 5.1, 5.1),
  exam('Wirtschaft und Recht', 'Test 2a Organisation (22.10.2025)', '2025-10-22', 4.1, 4.9, 0.4),
  exam('Wirtschaft und Recht', 'Test 2b Organisation (29.10.2025)', '2025-10-29', 4.0, 3.9, 0.6),
  exam('Sport', 'IN23a-Fachkompetenz (01.09.2026)', '2026-09-01', 5.0, 5.1),
  exam('Modul 106 - Datenbanken abfragen IN2023-1A', 'Modul 106 - Datenbanken abfragen IN2023-1A', null, 0, 0),
  exam('Modul 294 - Frontend realisieren IN2023-1A', 'Modul 294 - Frontend realisieren IN2023-1A', null, 6, 6),
  exam('Modul 335 - Mobile-Applikation IN2023-1A', 'Modul 335 - Mobile-Applikation IN2023-1A', null, 5, 5),
  exam('183 Applikationssicherheit implementieren', 'M183 (02.10.2026)', '2026-10-02', 5.5, 5.15),
];
const report = (programCode: string, className: string, schoolYearStart: number, semesterHalf: number, subjects: Record<string, number | string>, gradeAverage: number | null, promotionDecision: string | null) => ({
  id: `${className}-${schoolYearStart}-${semesterHalf}`, schoolUserId: 'u1', programCode, schoolYearStart, semesterHalf, className, promotionDecision, gradeAverage, unexcusedAbsences: 0, excusedAbsences: 1, totalAbsences: 1,
  subjects: Object.entries(subjects).map(([subjectName, v], i) => ({ id: `s${i}`, semesterReportId: 'r', subjectCode: subjectName, subjectName, ...(typeof v === 'number' ? { grade: v } : { marker: v }) })),
});
const reports = [
  report('BM-TALS', 'BM23x', 2023, 1, { Deutsch: 4.5, Englisch: 5.5, Französisch: 4.5, 'Mathematik Grundlagen': 4, 'Naturwissenschaften (Chemie)': 5.5 }, 4.8, 'def.'),
  report('BM-TALS', 'BM23x', 2023, 2, { Deutsch: 4.5, Englisch: 5, Französisch: 5.5, 'Mathematik Grundlagen': 4, 'Naturwissenschaften (Chemie)': 5.5 }, 4.9, 'def.'),
  report('BM-TALS', 'BM23x', 2024, 1, { Deutsch: 5, Englisch: 5.5, Französisch: 4, 'Mathematik Grundlagen': 4.5, IDAF: 5.5 }, 4.75, 'def.'),
  report('BM-TALS', 'BM23x', 2024, 2, { Deutsch: 4, Englisch: 5.5, Französisch: 4, 'Mathematik Grundlagen': 3.5 }, 4.25, 'def.'),
  report('BM-TALS', 'BM23d', 2025, 1, { Deutsch: 5, 'Mathematik Schwerpunkt': 3, 'Naturwissenschaften (Physik)': 4, 'Wirtschaft und Recht': 5, 'Geschichte und Politik': 5 }, 4.4, 'def.'),
  report('BM-TALS', 'BM23d', 2025, 2, { 'Geschichte und Politik': 5.5, 'Mathematik Schwerpunkt': 4, 'Naturwissenschaften (Physik)': 3.5, 'Wirtschaft und Recht': 5.5 }, 4.63, 'def.'),
  report('IN', 'IN23a', 2024, 2, { Sport: 4.5, '294 Frontend realisieren': 6, '295 Backend realisieren': 6 }, null, 'kein Promotionsentscheid'),
  report('IN', 'IN23a', 2025, 1, { Allgemeinbildung: 'disp', '426 Software entwickeln': 5.5, Sport: 'bes' }, 5.5, 'kein Promotionsentscheid'),
  report('IN', 'IN23a', 2025, 2, { Sport: 5, '183 Applikationssicherheit implementieren': 5.5, '323 Funktional programmieren': 5.5 }, 5.38, null),
];
// Overview: today's lessons, a test in four days and the next events, all relative to now().
let scene = 'morning'; // morning, notimetable, calm: GET /__scene/<name>
const SLOTS: [string, number, number, string][] = [
  ['Deutsch', 0, 45, 'B 2.14'], ['Deutsch', 50, 95, 'B 2.14'], ['Mathematik Schwerpunkt', 110, 155, 'A 1.03'], ['Mathematik Schwerpunkt', 160, 205, 'A 1.03'],
  ['Wirtschaft und Recht', 300, 345, 'C 3.01'], ['Geschichte und Politik', 350, 395, 'C 3.01'],
];
const at = (base: number, min: number) => new Date(base + min * 60_000).toISOString();
const dayAt = (offset: number, h: number, m = 0) => { const d = now(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const dayIso = (offset: number) => { const d = now(); d.setDate(d.getDate() + offset); return `${d.toISOString().slice(0, 10)}T00:00:00Z`; };
function agenda() {
  // A fixed school day from 07:30 today; the time of day (SHOTS_NOW) decides which lesson is running.
  const t = now(); t.setHours(7, 30, 0, 0); const first = t.getTime();
  const lessons = scene === 'notimetable' ? [] : SLOTS.map(([title, from, to, place], i) => ({ id: `l${i}`, entryType: 'Lesson', title, place, date: at(first, from), endDate: at(first, to) }));
  const test = scene === 'notimetable' ? [] : [{ id: 't0', entryType: 'Test', classId: classId('Mathematik Schwerpunkt'), title: 'Logarithmen', place: 'A 1.03', date: at(first, 110), endDate: at(first, 155) }];
  const ahead = scene === 'calm' ? [] : [{ id: 't1', entryType: 'Test', classId: classId('Wirtschaft und Recht'), title: 'Test 3 Erbrecht', place: 'A 2.07', date: dayAt(4, 9, 25), endDate: dayAt(4, 10, 10) }];
  return [...lessons, ...test, ...ahead,
    { id: 'e1', entryType: 'Event', title: 'Berufliche Zukunft', place: 'Restaurant Martinsberg', date: dayAt(5, 18, 0), endDate: dayAt(5, 20, 0) },
    { id: 'e2', entryType: 'Event', title: 'Kulturwoche (Theater)', place: null, date: dayIso(10), endDate: dayIso(15) },
    { id: 'e3', entryType: 'Event', title: 'Volleynight BBB', place: 'Sporthallen', date: dayAt(21, 19, 0), endDate: dayAt(21, 22, 0) },
    { id: 'e4', entryType: 'Holiday', title: 'Weihnachtsferien 2026', place: null, date: dayIso(45), endDate: dayIso(59) }];
}
function absences() {
  if (scene === 'calm') return [{ id: 'a0', type: 'Absence', reason: 'Krankheit', from: dayIso(-30), until: dayIso(-30), isExcused: true, schoolUserId: 'u1', schoolId: 's1' }];
  return [{ id: 'a1', type: 'Absence', reason: 'Andere Absenz', from: dayIso(-3), until: dayIso(-3), isExcused: false, schoolUserId: 'u1', schoolId: 's1' }];
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(request) {
    const path = new URL(request.url).pathname.toLowerCase();
    if (path.startsWith('/__scene/')) { scene = path.slice(9); return json({ scene }); }
    if (path === '/auth/refresh') return json({ access_token: 'test-token', expires_in: 900, token_type: 'Bearer' });
    if (path === '/api/auth/me') return json({ id: 'u1', externalId: 'u1', email: 'mia@example.org', displayName: 'Mia Muster', profilePictureUrl: PFP, schoolUsers: [] });
    if (path === '/api/exams') return json(exams);
    if (path === '/api/class') return json([...classes].map(([name, id]) => ({ id, name, schoolId: 's1' })));
    if (path === '/api/semesterreports') return json(reports);
    if (path === '/api/agendas') return json(agenda());
    if (path === '/api/absences') return json(absences());
    if (path === '/api/schools/my-schools') return json([{ id: 's1', name: 'Beispielschule', email: 'mia@example.org', fullName: 'Mia Muster', website }]);
    if (path === '/api/linking/accounts') return json([{ providerId: 'schulware', providerName: 'Schulnetz', id: 'a1', title: 'Beispielschule', status: 'ok', capabilities: [{ kind: 'school_data', label: 'School data' }] }]);
    if (path === '/api/app') return json({ version: 'dev', registrationEnabled: true });
    return json([]);
  },
});
console.log(`fake overview api on ${PORT}`);
