using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class NotificationOutboxInterceptorTests
    {
        [Test]
        public async Task Adding_a_grade_produces_one_pending_GradeAdded_row_with_subject_and_score()
        {
            var dbName = nameof(Adding_a_grade_produces_one_pending_GradeAdded_row_with_subject_and_score);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");
            var testClass = new Class { Id = Guid.NewGuid(), Name = "C1", SchoolId = schoolId };
            var exam = new Exam { Id = Guid.NewGuid(), Name = "Math Test", Type = default, ClassId = testClass.Id };

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.Classes.Add(testClass);
                seed.Exams.Add(exam);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName);
            var gradeId = Guid.NewGuid();
            ctx.Grades.Add(new Grade { Id = gradeId, Score = 5, Weighting = 1, ExamId = exam.Id, SchoolUserId = schoolUser.Id });
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(1);
            await Assert.That(rows[0].Type).IsEqualTo(NotificationType.GradeAdded);
            await Assert.That(rows[0].ApplicationUserId).IsEqualTo(schoolUser.ApplicationUserId);
            await Assert.That(rows[0].EntityId).IsEqualTo(gradeId);
            await Assert.That(rows[0].SubjectName).IsEqualTo("Math Test");
            await Assert.That(rows[0].Status).IsEqualTo(NotificationOutboxStatus.Pending);
        }

        [Test]
        public async Task Modifying_only_score_produces_GradeChanged()
        {
            var dbName = nameof(Modifying_only_score_produces_GradeChanged);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");
            var testClass = new Class { Id = Guid.NewGuid(), Name = "C1", SchoolId = schoolId };
            var exam = new Exam { Id = Guid.NewGuid(), Name = "Math Test", Type = default, ClassId = testClass.Id };
            var grade = new Grade { Id = Guid.NewGuid(), Score = 4, Weighting = 1, ExamId = exam.Id, SchoolUserId = schoolUser.Id };

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.Classes.Add(testClass);
                seed.Exams.Add(exam);
                seed.Grades.Add(grade);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName);
            var tracked = ctx.Grades.Single(g => g.Id == grade.Id);
            tracked.Score = 5;
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(1);
            await Assert.That(rows[0].Type).IsEqualTo(NotificationType.GradeChanged);
        }

        [Test]
        public async Task Adding_an_absence_produces_AbsenceAdded()
        {
            var dbName = nameof(Adding_an_absence_produces_AbsenceAdded);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName);
            var absenceId = Guid.NewGuid();
            var from = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            ctx.Absences.Add(new Absence { Id = absenceId, Reason = "Sick", Type = default, From = from, Until = from.AddDays(1), SchoolUserId = schoolUser.Id });
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(1);
            await Assert.That(rows[0].Type).IsEqualTo(NotificationType.AbsenceAdded);
            await Assert.That(rows[0].Summary).IsNull();
            await Assert.That(rows[0].OccursAt).IsEqualTo(from);
        }

        [Test]
        public async Task Modifying_an_absence_produces_nothing()
        {
            var dbName = nameof(Modifying_an_absence_produces_nothing);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");
            var from = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            var absence = new Absence { Id = Guid.NewGuid(), Reason = "Sick", Type = default, From = from, Until = from.AddDays(1), SchoolUserId = schoolUser.Id };

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.Absences.Add(absence);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName);
            var tracked = ctx.Absences.Single(a => a.Id == absence.Id);
            tracked.Reason = "Changed";
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(0);
        }

        [Test]
        public async Task Adding_a_school_user_scoped_agenda_entry_produces_AgendaAdded()
        {
            var dbName = nameof(Adding_a_school_user_scoped_agenda_entry_produces_AgendaAdded);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName);
            var date = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            ctx.AgendaEntries.Add(new AgendaEntry { Id = Guid.NewGuid(), EntryType = default, Title = "Meeting", Date = date, SchoolUserId = schoolUser.Id });
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(1);
            await Assert.That(rows[0].Type).IsEqualTo(NotificationType.AgendaAdded);
            await Assert.That(rows[0].Summary).IsEqualTo("Meeting");
            await Assert.That(rows[0].OccursAt).IsEqualTo(date);
        }

        [Test]
        public async Task Changing_only_the_title_produces_nothing_but_changing_the_date_produces_AgendaChanged()
        {
            var dbName = nameof(Changing_only_the_title_produces_nothing_but_changing_the_date_produces_AgendaChanged);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");
            var date = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            var entry = new AgendaEntry { Id = Guid.NewGuid(), EntryType = default, Title = "Meeting", Date = date, SchoolUserId = schoolUser.Id };

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.AgendaEntries.Add(entry);
                seed.SaveChanges();
            }

            using (var ctx = TestDb.NewNotifyingContext(dbName))
            {
                var tracked = ctx.AgendaEntries.Single(a => a.Id == entry.Id);
                tracked.Title = "Renamed meeting";
                ctx.SaveChanges();

                await Assert.That(ctx.NotificationOutbox.Count()).IsEqualTo(0);
            }

            using (var ctx = TestDb.NewNotifyingContext(dbName))
            {
                var tracked = ctx.AgendaEntries.Single(a => a.Id == entry.Id);
                tracked.Date = date.AddDays(1);
                ctx.SaveChanges();

                var rows = ctx.NotificationOutbox.ToList();
                await Assert.That(rows.Count).IsEqualTo(1);
                await Assert.That(rows[0].Type).IsEqualTo(NotificationType.AgendaChanged);
            }
        }

        [Test]
        public async Task Class_scoped_agenda_entry_produces_one_row_per_student()
        {
            var dbName = nameof(Class_scoped_agenda_entry_produces_one_row_per_student);
            var schoolId = Guid.NewGuid();
            var alice = TestDb.NewSchoolUser(schoolId, "Alice");
            var bob = TestDb.NewSchoolUser(schoolId, "Bob");
            var testClass = new Class { Id = Guid.NewGuid(), Name = "C1", SchoolId = schoolId, Students = { alice, bob } };

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.Classes.Add(testClass);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName);
            var date = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            ctx.AgendaEntries.Add(new AgendaEntry { Id = Guid.NewGuid(), EntryType = default, Title = "Class event", Date = date, ClassId = testClass.Id });
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(2);
            await Assert.That(rows.Select(r => r.ApplicationUserId).OrderBy(x => x)).IsEquivalentTo(new[] { alice.ApplicationUserId, bob.ApplicationUserId }.OrderBy(x => x));
        }

        [Test]
        public async Task School_scoped_agenda_entry_produces_no_rows()
        {
            var dbName = nameof(School_scoped_agenda_entry_produces_no_rows);

            using var ctx = TestDb.NewNotifyingContext(dbName);
            var date = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            ctx.AgendaEntries.Add(new AgendaEntry { Id = Guid.NewGuid(), EntryType = default, Title = "School event", Date = date, SchoolId = Guid.NewGuid() });
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(0);
        }

        [Test]
        public async Task Adding_an_unrelated_entity_produces_no_rows()
        {
            var dbName = nameof(Adding_an_unrelated_entity_produces_no_rows);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName);
            ctx.StudentDocuments.Add(new StudentDocument { Id = Guid.NewGuid(), Title = "Doc", SchoolUserId = schoolUser.Id });
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(0);
        }

        [Test]
        public async Task User_initiated_saves_produce_no_rows()
        {
            var dbName = nameof(User_initiated_saves_produce_no_rows);
            var schoolId = Guid.NewGuid();
            var schoolUser = TestDb.NewSchoolUser(schoolId, "Alice");

            using (var seed = TestDb.NewContext(dbName))
            {
                seed.SchoolUsers.Add(schoolUser);
                seed.SaveChanges();
            }

            using var ctx = TestDb.NewNotifyingContext(dbName, userInitiated: true);
            var from = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            ctx.Absences.Add(new Absence { Id = Guid.NewGuid(), Reason = "Sick", Type = default, From = from, Until = from.AddDays(1), SchoolUserId = schoolUser.Id });
            ctx.SaveChanges();

            var rows = ctx.NotificationOutbox.ToList();
            await Assert.That(rows.Count).IsEqualTo(0);
        }
    }
}
