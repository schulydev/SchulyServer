using Microsoft.EntityFrameworkCore;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Infrastructure.Plugins;
using Schuly.Plugin.Abstractions;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class PluginSchoolDataTests
    {
        private const string Source = "Schuly.Plugin.Test";

        private static async Task<(PluginSchoolData Data, Guid SchoolUserId)> ProvisionedAsync(string dbName, string source = Source)
        {
            var data = new PluginSchoolData(TestDb.NewContext(dbName), source);
            var schoolId = await data.EnsureSchoolAsync(new SchoolRecord("Test School", "https://school.example"));
            var schoolUserId = await data.EnsureStudentAsync(schoolId, Guid.NewGuid(), new StudentRecord { FirstName = "Alex", Email = "alex@school.example" });
            return (data, schoolUserId);
        }

        [Test]
        public async Task EnsureSchool_finds_an_existing_school_by_website()
        {
            var data = new PluginSchoolData(TestDb.NewContext(nameof(EnsureSchool_finds_an_existing_school_by_website)), Source);

            var first = await data.EnsureSchoolAsync(new SchoolRecord("Test School", "https://school.example"));
            var second = await data.EnsureSchoolAsync(new SchoolRecord("Renamed", "https://school.example", "https://school.example/logo.png"));

            await Assert.That(second).IsEqualTo(first);
            using var ctx = TestDb.NewContext(nameof(EnsureSchool_finds_an_existing_school_by_website));
            await Assert.That(await ctx.Schools.CountAsync()).IsEqualTo(1);
            await Assert.That((await ctx.Schools.SingleAsync()).LogoUrl).IsEqualTo("https://school.example/logo.png");
        }

        [Test]
        public async Task EnsureStudent_adopts_a_student_without_source_and_rejects_another_plugin()
        {
            const string db = nameof(EnsureStudent_adopts_a_student_without_source_and_rejects_another_plugin);
            var schoolId = Guid.NewGuid();
            var existing = TestDb.NewSchoolUser(schoolId);
            using (var ctx = TestDb.NewContext(db))
            {
                ctx.SchoolUsers.Add(existing);
                await ctx.SaveChangesAsync();
            }

            var adopted = await new PluginSchoolData(TestDb.NewContext(db), Source).EnsureStudentAsync(schoolId, existing.ApplicationUserId, new StudentRecord());
            await Assert.That(adopted).IsEqualTo(existing.Id);

            var other = new PluginSchoolData(TestDb.NewContext(db), "Schuly.Plugin.Other");
            await Assert.That(() => other.EnsureStudentAsync(schoolId, existing.ApplicationUserId, new StudentRecord())).Throws<UnauthorizedAccessException>();
        }

        [Test]
        public async Task SyncAgenda_upserts_by_external_id_and_stores_utc()
        {
            const string db = nameof(SyncAgenda_upserts_by_external_id_and_stores_utc);
            var (data, studentId) = await ProvisionedAsync(db);
            var swiss = TimeSpan.FromHours(2);

            var first = await data.SyncAgendaAsync(studentId, [
                new AgendaRecord("lesson-1", AgendaKind.Lesson, "Mathematik", new DateTimeOffset(2026, 10, 23, 8, 0, 0, swiss), new DateTimeOffset(2026, 10, 23, 9, 30, 0, swiss), "2.14"),
                new AgendaRecord("lesson-2", AgendaKind.Lesson, "Sport", new DateTimeOffset(2026, 10, 23, 9, 45, 0, swiss)),
            ]);
            var second = await data.SyncAgendaAsync(studentId, [
                new AgendaRecord("lesson-1", AgendaKind.Lesson, "Mathematik", new DateTimeOffset(2026, 10, 23, 8, 0, 0, swiss), new DateTimeOffset(2026, 10, 23, 9, 30, 0, swiss), "1.05"),
                new AgendaRecord("lesson-2", AgendaKind.Lesson, "Sport", new DateTimeOffset(2026, 10, 23, 9, 45, 0, swiss)),
            ]);

            await Assert.That(first).IsEqualTo(new SyncResult(2, 0));
            await Assert.That(second).IsEqualTo(new SyncResult(0, 1));

            using var ctx = TestDb.NewContext(db);
            var maths = await ctx.AgendaEntries.SingleAsync(a => a.ExternalId == "lesson-1");
            await Assert.That(maths.Date).IsEqualTo(new DateTime(2026, 10, 23, 6, 0, 0, DateTimeKind.Utc));
            await Assert.That(maths.Place).IsEqualTo("1.05");
            await Assert.That(maths.Source).IsEqualTo(Source);
            await Assert.That(maths.EntryType).IsEqualTo(AgendaEntryType.Lesson);
        }

        [Test]
        public async Task Sync_refuses_a_student_the_plugin_did_not_provision()
        {
            const string db = nameof(Sync_refuses_a_student_the_plugin_did_not_provision);
            var (_, studentId) = await ProvisionedAsync(db);
            var other = new PluginSchoolData(TestDb.NewContext(db), "Schuly.Plugin.Other");

            await Assert.That(async () => { await other.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow)]); }).Throws<UnauthorizedAccessException>();
        }

        [Test]
        public async Task Sync_adopts_a_student_provisioned_before_sources_existed()
        {
            const string db = nameof(Sync_adopts_a_student_provisioned_before_sources_existed);
            var student = TestDb.NewSchoolUser(Guid.NewGuid());
            using (var ctx = TestDb.NewContext(db))
            {
                ctx.SchoolUsers.Add(student);
                await ctx.SaveChangesAsync();
            }

            var result = await new PluginSchoolData(TestDb.NewContext(db), Source).SyncAbsencesAsync(student.Id, [new AbsenceRecord("a", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow)]);

            await Assert.That(result).IsEqualTo(new SyncResult(1, 0));
            using var check = TestDb.NewContext(db);
            await Assert.That((await check.SchoolUsers.SingleAsync()).Source).IsEqualTo(Source);
        }

        [Test]
        public async Task Sync_leaves_manual_rows_alone()
        {
            const string db = nameof(Sync_leaves_manual_rows_alone);
            var (data, studentId) = await ProvisionedAsync(db);
            using (var ctx = TestDb.NewContext(db))
            {
                ctx.Absences.Add(new Absence { SchoolUserId = studentId, Reason = "Doctor", Type = AbsenceType.Absence, From = DateTime.UtcNow, Until = DateTime.UtcNow, ExternalId = "a" });
                await ctx.SaveChangesAsync();
            }

            var result = await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, "Sick")]);

            await Assert.That(result).IsEqualTo(new SyncResult(1, 0));
            using var check = TestDb.NewContext(db);
            await Assert.That((await check.Absences.Where(a => a.Source == null).ToListAsync()).Count(a => a.Reason == "Doctor")).IsEqualTo(1);
        }

        [Test]
        public async Task SyncAbsences_keeps_what_a_later_page_leaves_out()
        {
            const string db = nameof(SyncAbsences_keeps_what_a_later_page_leaves_out);
            var (data, studentId) = await ProvisionedAsync(db);
            var day = new DateTimeOffset(2026, 11, 5, 0, 0, 0, TimeSpan.Zero);

            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", day, day, "Arzt") { TrainerStatus = "Offen", TrainerComment = "Geprüft", StartTime = "12:00", EndTime = "17:30", Lessons = 4 }]);
            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", day, day, "Arzt") { ExcuseDeadline = new DateOnly(2026, 11, 19), Comment = "Termin" }]);

            using var check = TestDb.NewContext(db);
            var row = await check.Absences.SingleAsync();
            await Assert.That(row.TrainerStatus).IsEqualTo("Offen");
            await Assert.That(row.TrainerComment).IsEqualTo("Geprüft");
            await Assert.That(row.StartTime).IsEqualTo("12:00");
            await Assert.That(row.Lessons).IsEqualTo(4);
            await Assert.That(row.ExcuseDeadline).IsEqualTo(new DateOnly(2026, 11, 19));
            await Assert.That(row.Comment).IsEqualTo("Termin");
        }

        [Test]
        public async Task SyncAbsences_removes_a_copy_left_behind_under_an_old_id()
        {
            const string db = nameof(SyncAbsences_removes_a_copy_left_behind_under_an_old_id);
            var (data, studentId) = await ProvisionedAsync(db);
            var from = new DateTimeOffset(2026, 8, 19, 0, 0, 0, TimeSpan.Zero);
            var until = from.AddDays(1);

            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", from, until, "Andere Absenz") { IsExcused = false }, new AbsenceRecord("a|profile-2", from, until, "Andere Absenz") { IsExcused = false }]);
            await new PluginSchoolData(TestDb.NewContext(db), Source).SyncAbsencesAsync(studentId, [new AbsenceRecord("a", from, until, "Andere Absenz") { IsExcused = true }]);

            using var check = TestDb.NewContext(db);
            var row = await check.Absences.SingleAsync();
            await Assert.That(row.ExternalId).IsEqualTo("a");
            await Assert.That(row.IsExcused).IsEqualTo(true);
        }

        [Test]
        public async Task SyncAbsences_deletes_nothing_when_a_sync_returns_an_empty_list()
        {
            const string db = nameof(SyncAbsences_deletes_nothing_when_a_sync_returns_an_empty_list);
            var (data, studentId) = await ProvisionedAsync(db);
            var day = new DateTimeOffset(2026, 8, 19, 0, 0, 0, TimeSpan.Zero);

            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", day, day, "Arzt"), new AbsenceRecord("b", day.AddDays(1), day.AddDays(1), "Arzt")]);
            await new PluginSchoolData(TestDb.NewContext(db), Source).SyncAbsencesAsync(studentId, []);

            using var check = TestDb.NewContext(db);
            await Assert.That(await check.Absences.CountAsync()).IsEqualTo(2);
        }

        [Test]
        public async Task SyncAbsences_keeps_the_same_reason_on_other_dates()
        {
            const string db = nameof(SyncAbsences_keeps_the_same_reason_on_other_dates);
            var (data, studentId) = await ProvisionedAsync(db);
            var day = new DateTimeOffset(2026, 8, 19, 0, 0, 0, TimeSpan.Zero);

            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", day, day, "Arzt"), new AbsenceRecord("b", day.AddDays(1), day.AddDays(1), "Arzt"), new AbsenceRecord("c", day, day.AddDays(1), "Arzt")]);
            await new PluginSchoolData(TestDb.NewContext(db), Source).SyncAbsencesAsync(studentId, [new AbsenceRecord("a", day, day, "Arzt")]);

            using var check = TestDb.NewContext(db);
            await Assert.That(await check.Absences.CountAsync()).IsEqualTo(3);
        }

        [Test]
        public async Task SyncAbsences_leaves_other_absences_on_the_same_dates_alone()
        {
            const string db = nameof(SyncAbsences_leaves_other_absences_on_the_same_dates_alone);
            var (data, studentId) = await ProvisionedAsync(db);
            var day = new DateTimeOffset(2026, 8, 19, 0, 0, 0, TimeSpan.Zero);
            using (var ctx = TestDb.NewContext(db))
            {
                ctx.Absences.Add(new Absence { SchoolUserId = studentId, Reason = "Andere Absenz", Type = AbsenceType.Absence, From = day.UtcDateTime, Until = day.UtcDateTime });
                await ctx.SaveChangesAsync();
            }

            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", day, day, "Arzt"), new AbsenceRecord("b", day, day, "Krank")]);
            await new PluginSchoolData(TestDb.NewContext(db), Source).SyncAbsencesAsync(studentId, [new AbsenceRecord("a", day, day, "Arzt")]);
            await new PluginSchoolData(TestDb.NewContext(db), Source).SyncAbsencesAsync(studentId, [new AbsenceRecord("c", day, day, "Andere Absenz")]);

            using var check = TestDb.NewContext(db);
            var reasons = await check.Absences.Select(a => a.Reason).ToListAsync();
            await Assert.That(reasons.Count).IsEqualTo(4);
        }

        [Test]
        public async Task SyncGrades_creates_subject_and_exam_once_and_enrols_the_student()
        {
            const string db = nameof(SyncGrades_creates_subject_and_exam_once_and_enrols_the_student);
            var (data, studentId) = await ProvisionedAsync(db);

            var first = await data.SyncGradesAsync(studentId, [
                new GradeRecord("m-1", "Mathematik", "Test 1", 5.5m, 1, new DateOnly(2026, 10, 9)),
                new GradeRecord("m-2", "Mathematik", "Test 2", 4.0m, 2),
            ]);
            var second = await data.SyncGradesAsync(studentId, [new GradeRecord("m-1", "Mathematik", "Test 1", 6.0m)]);

            await Assert.That(first).IsEqualTo(new SyncResult(2, 0));
            await Assert.That(second).IsEqualTo(new SyncResult(0, 1));

            using var ctx = TestDb.NewContext(db);
            await Assert.That(await ctx.Classes.CountAsync()).IsEqualTo(1);
            await Assert.That(await ctx.Exams.CountAsync()).IsEqualTo(2);
            var student = await ctx.SchoolUsers.Include(su => su.Classes).SingleAsync(su => su.Id == studentId);
            await Assert.That(student.Classes.Single().Name).IsEqualTo("Mathematik");
            await Assert.That((await ctx.Grades.SingleAsync(g => g.ExternalId == "m-1")).Score).IsEqualTo(6.0m);
        }

        [Test]
        public async Task SyncExams_adds_an_upcoming_exam_that_a_later_grade_reuses()
        {
            const string db = nameof(SyncExams_adds_an_upcoming_exam_that_a_later_grade_reuses);
            var (data, studentId) = await ProvisionedAsync(db);

            var exams = await data.SyncExamsAsync(studentId, [new ExamRecord("Mathematik", "Test 3 (12.11.2026)", new DateOnly(2026, 11, 12)) { Description = "Kapitel 4" }]);
            var again = await data.SyncExamsAsync(studentId, [new ExamRecord("Mathematik", "Test 3 (12.11.2026)", new DateOnly(2026, 11, 12)) { Description = "Kapitel 4" }]);
            await data.SyncGradesAsync(studentId, [new GradeRecord("m-3", "Mathematik", "Test 3 (12.11.2026)", 5.0m, 1, new DateOnly(2026, 11, 12)) { ClassAverage = 4.6m }]);

            await Assert.That(exams).IsEqualTo(new SyncResult(1, 0));
            await Assert.That(again).IsEqualTo(new SyncResult(0, 0));
            using var ctx = TestDb.NewContext(db);
            var exam = await ctx.Exams.SingleAsync();
            await Assert.That(exam.Description).IsEqualTo("Kapitel 4");
            await Assert.That(exam.ReportedClassAverage).IsEqualTo(4.6m);
            await Assert.That(await ctx.Grades.CountAsync(g => g.ExamId == exam.Id)).IsEqualTo(1);
            var student = await ctx.SchoolUsers.Include(su => su.Classes).SingleAsync(su => su.Id == studentId);
            await Assert.That(student.Classes.Single().Name).IsEqualTo("Mathematik");
        }

        [Test]
        public async Task SyncAbsences_keeps_the_excused_state_when_a_source_does_not_report_it()
        {
            const string db = nameof(SyncAbsences_keeps_the_excused_state_when_a_source_does_not_report_it);
            var (data, studentId) = await ProvisionedAsync(db);
            var from = new DateTimeOffset(2026, 9, 10, 0, 0, 0, TimeSpan.Zero);

            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a-1", from, from.AddDays(1), "Krank") { IsExcused = true }]);
            await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a-1", from, from.AddDays(1), "Krank")]);

            using var ctx = TestDb.NewContext(db);
            await Assert.That((await ctx.Absences.SingleAsync()).IsExcused == true).IsTrue();
        }

        [Test]
        public async Task SyncDocuments_keeps_the_stored_file_when_a_resync_has_none()
        {
            const string db = nameof(SyncDocuments_keeps_the_stored_file_when_a_resync_has_none);
            var (data, studentId) = await ProvisionedAsync(db);

            await data.SyncDocumentsAsync(studentId, [new DocumentRecord("zeugnis-1", "Zeugnis HS25", "zeugnis.pdf", File: new StoredFile("blob-1", 1234))]);
            await data.SyncDocumentsAsync(studentId, [new DocumentRecord("zeugnis-1", "Zeugnis HS25", "zeugnis.pdf")]);

            await Assert.That(await data.GetDocumentIdsAsync(studentId)).Contains("zeugnis-1");
            using var ctx = TestDb.NewContext(db);
            await Assert.That((await ctx.StudentDocuments.SingleAsync()).FileUrl).IsEqualTo("blob-1");
        }

        [Test]
        public async Task Sync_rejects_a_blank_external_id()
        {
            var (data, studentId) = await ProvisionedAsync(nameof(Sync_rejects_a_blank_external_id));

            await Assert.That(async () => { await data.SyncAgendaAsync(studentId, [new AgendaRecord(" ", AgendaKind.Event, "x", DateTimeOffset.UtcNow)]); }).Throws<ArgumentException>();
        }

        private static SemesterReportRecord Report(decimal mathGrade, params SemesterSubjectRecord[] extra) =>
            new("BM1TALS15", 2025, 1, "BM23d", [new SemesterSubjectRecord("M", "Mathematik", mathGrade, SubjectTypeMarker: "r"), .. extra], "def.", 4.8m, 3, 0);

        [Test]
        public async Task SyncSemesterReports_adds_then_updates_only_on_change()
        {
            const string db = nameof(SyncSemesterReports_adds_then_updates_only_on_change);
            var (data, studentId) = await ProvisionedAsync(db);

            var first = await data.SyncSemesterReportsAsync(studentId, [Report(5.0m, new SemesterSubjectRecord("EGK", "Erweiterte Grundkompetenzen", Marker: "disp"))]);
            var same = await data.SyncSemesterReportsAsync(studentId, [Report(5.0m, new SemesterSubjectRecord("EGK", "Erweiterte Grundkompetenzen", Marker: "disp"))]);
            var changed = await data.SyncSemesterReportsAsync(studentId, [Report(5.5m)]);

            await Assert.That(first).IsEqualTo(new SyncResult(1, 0));
            await Assert.That(same).IsEqualTo(new SyncResult(0, 0));
            await Assert.That(changed).IsEqualTo(new SyncResult(0, 1));

            using var ctx = TestDb.NewContext(db);
            var report = await ctx.SemesterReports.Include(r => r.Subjects).SingleAsync();
            await Assert.That(report.Source).IsEqualTo(Source);
            await Assert.That(report.TotalAbsences).IsEqualTo(3);
            await Assert.That(report.Subjects.Single().Grade).IsEqualTo(5.5m);
        }

        [Test]
        public async Task SyncSemesterReports_leaves_a_hand_entered_report_alone()
        {
            const string db = nameof(SyncSemesterReports_leaves_a_hand_entered_report_alone);
            var (data, studentId) = await ProvisionedAsync(db);
            using (var ctx = TestDb.NewContext(db))
            {
                ctx.SemesterReports.Add(new SemesterReport { SchoolUserId = studentId, ProgramCode = "BM1TALS15", SchoolYearStart = 2025, SemesterHalf = 1, ClassName = "mine" });
                await ctx.SaveChangesAsync();
            }

            var result = await data.SyncSemesterReportsAsync(studentId, [Report(4.0m)]);

            await Assert.That(result).IsEqualTo(new SyncResult(0, 0));
            using var check = TestDb.NewContext(db);
            await Assert.That((await check.SemesterReports.SingleAsync()).ClassName).IsEqualTo("mine");
        }

        [Test]
        public async Task An_unchanged_resync_produces_no_notifications()
        {
            const string db = nameof(An_unchanged_resync_produces_no_notifications);
            var (data, studentId) = await ProvisionedAsync(db);
            var lesson = new AgendaRecord("lesson-1", AgendaKind.Lesson, "Mathematik", new DateTimeOffset(2026, 10, 23, 8, 0, 0, TimeSpan.FromHours(2)));
            await data.SyncAgendaAsync(studentId, [lesson]);

            var notifying = new PluginSchoolData(TestDb.NewNotifyingContext(db), Source);
            var result = await notifying.SyncAgendaAsync(studentId, [lesson]);

            await Assert.That(result).IsEqualTo(new SyncResult(0, 0));
            using var ctx = TestDb.NewContext(db);
            await Assert.That(await ctx.NotificationOutbox.CountAsync()).IsEqualTo(0);
        }
    }
}
