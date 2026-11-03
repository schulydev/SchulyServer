using Schuly.Domain;
using Schuly.Tests.TestHelpers;
using SUQ = Schuly.Application.Queries.SchoolUser;

namespace Schuly.Tests
{
    public class SchoolUserAccessTests
    {
        private static (Guid teacherUserId, Guid teacherSelf, Guid student, Guid outsider) Seed(string db)
        {
            var teacherUserId = Guid.NewGuid();
            var schoolId = Guid.NewGuid();
            var otherSchoolId = Guid.NewGuid();

            var student = TestDb.NewSchoolUser(schoolId, "Student");
            student.Grades.Add(new Grade { Score = 5, Weighting = 1, SchoolUserId = student.Id });
            student.Absences.Add(new Absence { Reason = "s", Type = default, From = default, Until = default, SchoolUserId = student.Id });

            var teacherSelf = TestDb.NewSchoolUser(schoolId, "Teacher");
            teacherSelf.ApplicationUserId = teacherUserId;
            teacherSelf.Grades.Add(new Grade { Score = 4, Weighting = 1, SchoolUserId = teacherSelf.Id });

            var outsider = TestDb.NewSchoolUser(otherSchoolId, "Outsider");

            var teacher = new Teacher
            {
                Id = Guid.NewGuid(),
                SchoolId = schoolId,
                FirstName = "T",
                LastName = "Eacher",
                Code = "TEA",
                ApplicationUserId = teacherUserId,
            };

            using var ctx = TestDb.NewContext(db);
            ctx.SchoolUsers.AddRange(student, teacherSelf, outsider);
            ctx.Teachers.Add(teacher);
            ctx.SaveChanges();
            return (teacherUserId, teacherSelf.Id, student.Id, outsider.Id);
        }

        [Test]
        public async Task A_user_only_gets_their_own_school_users()
        {
            var (teacherUserId, teacherSelf, student, outsider) = Seed(nameof(A_user_only_gets_their_own_school_users));
            using var ctx = TestDb.NewContext(nameof(A_user_only_gets_their_own_school_users));

            var handler = new SUQ.GetSchoolUsersQueryHandler(ctx, new FakeUserService() { CurrentUserId = teacherUserId }, new FakeAvatarUrlSigner());
            var result = await handler.Handle(new SUQ.GetSchoolUsersQuery(), CancellationToken.None);

            await Assert.That(result.Value!.Count).IsEqualTo(1);
            var mine = result.Value!.Single();
            await Assert.That(mine.Id).IsEqualTo(teacherSelf);
            await Assert.That(mine.Grades.Count).IsEqualTo(1);
            await Assert.That(result.Value!.Any(su => su.Id == student || su.Id == outsider)).IsFalse();
        }
    }
}
