using Schuly.Domain;
using Schuly.Tests.TestHelpers;
using CQ = Schuly.Application.Queries.Class;

namespace Schuly.Tests
{
    public class ClassAccessTests
    {
        private static (Guid alice, Guid classA, Guid classB) Seed(string db)
        {
            var schoolId = Guid.NewGuid();
            var alice = TestDb.NewSchoolUser(schoolId, "Alice");
            var bob = TestDb.NewSchoolUser(schoolId, "Bob");



            var classA = new Class { Name = "A", SchoolId = schoolId, Students = { alice, bob } };
            var classB = new Class { Name = "B", SchoolId = schoolId, Students = { bob } };

            var exam = new Exam { Name = "E1", Type = default, Class = classA };
            exam.Grades.Add(new Grade { Score = 5, Weighting = 1, SchoolUserId = alice.Id });
            exam.Grades.Add(new Grade { Score = 4, Weighting = 1, SchoolUserId = bob.Id });

            alice.Absences.Add(new Absence { Reason = "a", Type = default, From = default, Until = default, SchoolUserId = alice.Id });
            bob.Absences.Add(new Absence { Reason = "b", Type = default, From = default, Until = default, SchoolUserId = bob.Id });

            using var ctx = TestDb.NewContext(db);
            ctx.Classes.AddRange(classA, classB);
            ctx.Exams.Add(exam);
            ctx.SaveChanges();
            return (alice.Id, classA.Id, classB.Id);
        }

        [Test]
        public async Task Student_sees_only_enrolled_classes_with_only_their_own_grades_and_absences()
        {
            var (alice, _, _) = Seed(nameof(Student_sees_only_enrolled_classes_with_only_their_own_grades_and_absences));
            using var ctx = TestDb.NewContext(nameof(Student_sees_only_enrolled_classes_with_only_their_own_grades_and_absences));

            var handler = new CQ.GetClassesQueryHandler(ctx, new FakeUserService(alice), new FakeAvatarUrlSigner());
            var result = await handler.Handle(new CQ.GetClassesQuery(), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsTrue();
            await Assert.That(result.Value!.Count).IsEqualTo(1);
            var dto = result.Value!.Single();
            await Assert.That(dto.Students.Sum(s => s.Grades.Count)).IsEqualTo(1);
            await Assert.That(dto.Students.Sum(s => s.Absences.Count)).IsEqualTo(1);
            await Assert.That(dto.Exams.Sum(e => e.Grades.Count)).IsEqualTo(1);
        }

        [Test]
        public async Task Reading_a_class_the_student_is_not_enrolled_in_returns_not_found()
        {
            var (alice, _, classB) = Seed(nameof(Reading_a_class_the_student_is_not_enrolled_in_returns_not_found));
            using var ctx = TestDb.NewContext(nameof(Reading_a_class_the_student_is_not_enrolled_in_returns_not_found));

            var handler = new CQ.GetClassQueryHandler(ctx, new FakeUserService(alice), new FakeAvatarUrlSigner());
            var result = await handler.Handle(new CQ.GetClassQuery(classB), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsFalse();
        }

        [Test]
        public async Task Class_roster_does_not_leak_classmate_pii()
        {
            var (alice, _, _) = Seed(nameof(Class_roster_does_not_leak_classmate_pii));
            using var ctx = TestDb.NewContext(nameof(Class_roster_does_not_leak_classmate_pii));

            var handler = new CQ.GetClassesQueryHandler(ctx, new FakeUserService(alice), new FakeAvatarUrlSigner());
            var result = await handler.Handle(new CQ.GetClassesQuery(), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsTrue();
            var json = System.Text.Json.JsonSerializer.Serialize(result.Value);

            await Assert.That(json).DoesNotContain("Bob@example.com");
        }

    }
}
