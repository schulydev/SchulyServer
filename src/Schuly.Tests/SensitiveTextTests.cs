using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Plugins;
using Schuly.Infrastructure.Services;
using Schuly.Plugin.Abstractions;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class SensitiveTextTests
    {
        [Test]
        public async Task A_value_round_trips_and_no_two_encryptions_look_alike()
        {
            var first = SensitiveText.Protect("Krank");
            var second = SensitiveText.Protect("Krank");

            await Assert.That(first).StartsWith(SensitiveText.Prefix);
            await Assert.That(first).DoesNotContain("Krank");
            await Assert.That(first).IsNotEqualTo(second);
            await Assert.That(SensitiveText.Reveal(first)).IsEqualTo("Krank");
        }

        [Test]
        public async Task A_row_from_before_encryption_reads_as_it_was()
        {
            await Assert.That(SensitiveText.Reveal("Arzttermin")).IsEqualTo("Arzttermin");
        }

        [Test]
        public async Task A_value_written_with_another_key_does_not_break_reading()
        {
            await Assert.That(SensitiveText.Reveal(SensitiveText.Prefix + Convert.ToBase64String(new byte[40]))).IsEqualTo(SensitiveText.Unreadable);
            await Assert.That(SensitiveText.Reveal(SensitiveText.Prefix + "not base64")).IsEqualTo(SensitiveText.Unreadable);
        }

        [Test]
        public async Task A_value_on_the_current_key_counts_and_a_foreign_one_does_not()
        {
            await Assert.That(SensitiveText.IsOnCurrentKey(SensitiveText.Protect("x"))).IsTrue();
            await Assert.That(SensitiveText.IsOnCurrentKey("plain")).IsTrue();
            await Assert.That(SensitiveText.IsOnCurrentKey(SensitiveText.Prefix + Convert.ToBase64String(new byte[40]))).IsFalse();
        }

        [Test]
        public async Task Reasons_and_document_metadata_are_mapped_through_the_cipher()
        {
            using var ctx = TestDb.NewContext(nameof(Reasons_and_document_metadata_are_mapped_through_the_cipher));
            var mapped = new[]
            {
                ctx.Model.FindEntityType(typeof(Absence))!.FindProperty(nameof(Absence.Reason)),
                ctx.Model.FindEntityType(typeof(StudentDocument))!.FindProperty(nameof(StudentDocument.Title)),
                ctx.Model.FindEntityType(typeof(StudentDocument))!.FindProperty(nameof(StudentDocument.Comment)),
                ctx.Model.FindEntityType(typeof(StudentDocument))!.FindProperty(nameof(StudentDocument.Category)),
                ctx.Model.FindEntityType(typeof(StudentDocument))!.FindProperty(nameof(StudentDocument.EnteredBy)),
                ctx.Model.FindEntityType(typeof(StudentDocument))!.FindProperty(nameof(StudentDocument.FileName)),
                ctx.Model.FindEntityType(typeof(StudentDocument))!.FindProperty(nameof(StudentDocument.FollowUpAction)),
            };

            foreach (var property in mapped)
                await Assert.That(property!.GetValueConverter()).IsEqualTo(SensitiveText.Converter);
        }

        [Test]
        public async Task A_resync_with_the_same_reason_is_not_an_update()
        {
            const string db = nameof(A_resync_with_the_same_reason_is_not_an_update);
            var data = new PluginSchoolData(TestDb.NewContext(db), "Schuly.Plugin.Test");
            var schoolId = await data.EnsureSchoolAsync(new SchoolRecord("School", "https://school.example"));
            var studentId = await data.EnsureStudentAsync(schoolId, Guid.NewGuid(), new StudentRecord { FirstName = "A", Email = "a@school.example" });
            var at = DateTimeOffset.UtcNow;

            await Assert.That(await data.SyncAbsencesAsync(studentId, [new AbsenceRecord("a", at, at, "Krank")])).IsEqualTo(new SyncResult(1, 0));
            await Assert.That(await new PluginSchoolData(TestDb.NewContext(db), "Schuly.Plugin.Test").SyncAbsencesAsync(studentId, [new AbsenceRecord("a", at, at, "Krank")])).IsEqualTo(new SyncResult(0, 0));
        }

        /// <summary>Set SCHULY_TEST_POSTGRES to a throwaway database: this resets its schema.</summary>
        [Test]
        [NotInParallel("RetentionIntegration")]
        public async Task The_backfill_encrypts_old_rows_on_postgres_and_can_run_twice()
        {
            var connectionString = Environment.GetEnvironmentVariable("SCHULY_TEST_POSTGRES");
            if (string.IsNullOrEmpty(connectionString))
                Skip.Test("SCHULY_TEST_POSTGRES is not set.");

            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync();
                await using var reset = new NpgsqlCommand("DROP SCHEMA public CASCADE; CREATE SCHEMA public;", connection);
                await reset.ExecuteNonQueryAsync();
            }

            await using var db = new SchulyDbContext(new DbContextOptionsBuilder<SchulyDbContext>().UseNpgsql(connectionString).Options);
            await db.Database.MigrateAsync();

            var school = new School { Name = "S" };
            var user = new ApplicationUser { ExternalId = Guid.NewGuid().ToString(), Email = "u@example.com" };
            var student = new SchoolUser { ApplicationUser = user, School = school, FirstName = "A", LastName = "B", Email = "a@example.com", EntryDate = default, Role = Roles.Student };
            db.SchoolUsers.Add(student);
            await db.SaveChangesAsync();

            var plainId = Guid.NewGuid();
            await db.Database.ExecuteSqlRawAsync("INSERT INTO \"Absences\" (\"Id\", \"Reason\", \"Type\", \"From\", \"Until\", \"SchoolUserId\", \"CreatedAt\", \"UpdatedAt\") VALUES ({0}, 'Krank', 0, now(), now(), {1}, now(), now())", plainId, student.Id);
            var docId = Guid.NewGuid();
            await db.Database.ExecuteSqlRawAsync("INSERT INTO \"StudentDocuments\" (\"Id\", \"SchoolUserId\", \"Title\", \"Comment\", \"CreatedAt\", \"UpdatedAt\") VALUES ({0}, {1}, 'Verweis', 'Disziplin', now(), now())", docId, student.Id);

            await Assert.That((await db.Absences.AsNoTracking().SingleAsync(a => a.Id == plainId)).Reason).IsEqualTo("Krank");

            var backfill = new SensitiveTextBackfill(db, NullLogger<SensitiveTextBackfill>.Instance);
            await Assert.That(await backfill.RunAsync()).IsEqualTo(3);
            await Assert.That(await backfill.RunAsync()).IsEqualTo(0);

            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync();
                await using var read = new NpgsqlCommand("SELECT \"Reason\" FROM \"Absences\"", connection);
                await Assert.That((string)(await read.ExecuteScalarAsync())!).StartsWith(SensitiveText.Prefix);
            }

            await Assert.That((await db.Absences.AsNoTracking().SingleAsync(a => a.Id == plainId)).Reason).IsEqualTo("Krank");
            var doc = await db.StudentDocuments.AsNoTracking().SingleAsync(d => d.Id == docId);
            await Assert.That(doc.Title).IsEqualTo("Verweis");
            await Assert.That(doc.Comment).IsEqualTo("Disziplin");
        }
    }
}
