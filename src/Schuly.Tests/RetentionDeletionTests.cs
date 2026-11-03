using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;
using Schuly.Tests.TestHelpers;
using Toamaisutaa.Abstractions;

namespace Schuly.Tests
{
    public class RetentionDeletionTests
    {
        private sealed class Env : IDisposable
        {
            public SchulyDbContext Db { get; } = TestDb.NewContext(Guid.NewGuid().ToString());
            public FakeDocumentStorage Storage { get; } = new();
            public FakePluginPurger Plugins { get; } = new();
            public FakeUserStore SignIns { get; } = new();
            public FakeWarningSender Warnings { get; } = new();
            public RetentionOptions Options { get; } = new();

            public RetentionSweeper Sweeper() => new(Db, new AccountPurger(Db, Storage, TestVault.Factory(), Plugins, NullLogger<AccountPurger>.Instance), Plugins, SignIns, Storage, Warnings, Microsoft.Extensions.Options.Options.Create(Options), NullLogger<RetentionSweeper>.Instance);

            public Task<RetentionSweepResult> SweepAsync() => Sweeper().SweepAsync(CancellationToken.None);

            /// <summary>An account with a sign-in row, last active the given time ago.</summary>
            public async Task<(ApplicationUser User, Guid LoginId)> AccountAsync(DateTime lastActive, string? verifiedEmail = "owner@example.com", string? unverifiedEmail = null)
            {
                var loginId = Guid.CreateVersion7();
                var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = loginId.ToString(), Email = "profile@example.com" };
                Db.ApplicationUsers.Add(user);
                AddSignIn(loginId, lastActive, verifiedEmail, unverifiedEmail);
                await Db.SaveChangesAsync();
                user.LastSeenAt = lastActive;
                await Db.SaveChangesAsync();
                return (user, loginId);
            }

            public void AddSignIn(Guid loginId, DateTime updatedAt, string? verifiedEmail, string? unverifiedEmail = null)
            {
                Db.Set<ToamaisutaaUser>().Add(new ToamaisutaaUser { Id = loginId, SecurityStamp = "stamp", CreatedAt = updatedAt, UpdatedAt = updatedAt });
                if (verifiedEmail is not null || unverifiedEmail is not null)
                    Db.Set<ToamaisutaaPasswordCredential>().Add(new ToamaisutaaPasswordCredential { UserId = loginId, UserName = loginId.ToString(), NormalizedUserName = loginId.ToString(), Email = verifiedEmail ?? unverifiedEmail, EmailConfirmedAt = verifiedEmail is null ? null : updatedAt, PasswordHash = "x", CreatedAt = updatedAt, UpdatedAt = updatedAt });
                SignIns.Existing.Add(loginId);
            }

            public async Task<SchoolUser> SchoolUserAsync(Guid applicationUserId, string? source, DateOnly? leaveDate, string? picture = null)
            {
                var school = new School { Id = Guid.NewGuid(), Name = $"School {Guid.NewGuid()}" };
                Db.Schools.Add(school);
                var schoolUser = TestDb.NewSchoolUser(school.Id);
                schoolUser.ApplicationUserId = applicationUserId;
                schoolUser.Source = source;
                schoolUser.LeaveDate = leaveDate;
                schoolUser.ProfilePictureUrl = picture;
                Db.SchoolUsers.Add(schoolUser);
                await Db.SaveChangesAsync();
                return schoolUser;
            }

            public void Dispose() => Db.Dispose();
        }

        private static DateTime MonthsAgo(int months) => DateTime.UtcNow.AddMonths(-months);
        private static DateOnly LeftMonthsAgo(int months) => DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-months);

        // --- O5: school rows without an owner

        [Test]
        public async Task A_class_nobody_attends_goes_with_its_exams_agenda_and_unlinked_teacher()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            var student = await env.SchoolUserAsync(user.Id, null, null);

            var orphanTeacher = new Teacher { SchoolId = student.SchoolId, FirstName = "T", LastName = "O", Code = "TO" };
            var orphan = new Class { Name = "Gone", SchoolId = student.SchoolId, Teachers = { orphanTeacher } };
            var orphanExam = new Exam { Name = "Old", Class = orphan };
            var orphanAgenda = new AgendaEntry { Title = "Trip", Date = DateTime.UtcNow, EntryType = default, Class = orphan };
            var liveTeacher = new Teacher { SchoolId = student.SchoolId, FirstName = "T", LastName = "L", Code = "TL" };
            var live = new Class { Name = "Live", SchoolId = student.SchoolId, Students = { student }, Teachers = { liveTeacher } };
            var liveExam = new Exam { Name = "Upcoming", Class = live };
            var linkedTeacher = new Teacher { SchoolId = student.SchoolId, FirstName = "T", LastName = "M", Code = "TM", ApplicationUserId = user.Id };
            env.Db.AddRange(orphanExam, orphanAgenda, liveExam, linkedTeacher);
            await env.Db.SaveChangesAsync();

            var result = await env.SweepAsync();

            await Assert.That(env.Db.Classes.Select(c => c.Name).ToList()).IsEquivalentTo(new[] { "Live" });
            await Assert.That(env.Db.Exams.Select(e => e.Name).ToList()).IsEquivalentTo(new[] { "Upcoming" });
            await Assert.That(env.Db.AgendaEntries.Any(a => a.Title == "Trip")).IsFalse();
            await Assert.That(env.Db.Teachers.Select(t => t.Code).ToList()).IsEquivalentTo(new[] { "TL", "TM" });
            await Assert.That(result.OrphanedSchoolRows).IsEqualTo(3);
        }

        [Test]
        public async Task A_class_whose_exam_still_has_a_grade_stays()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            var student = await env.SchoolUserAsync(user.Id, null, null);
            var cls = new Class { Name = "Graded", SchoolId = student.SchoolId };
            env.Db.Exams.Add(new Exam { Name = "E", Class = cls, Grades = { new Grade { Score = 5, Weighting = 1, SchoolUserId = student.Id } } });
            await env.Db.SaveChangesAsync();

            await env.SweepAsync();

            await Assert.That(env.Db.Classes.Any(c => c.Name == "Graded")).IsTrue();
        }

        [Test]
        public async Task Teachers_have_no_stored_email()
        {
            await Assert.That(typeof(Teacher).GetProperty("Email")).IsNull();
            await Assert.That(typeof(Schuly.Application.Dtos.TeacherDto).GetProperty("Email")).IsNull();
        }

        // --- S5: warning and deletion

        [Test]
        public async Task An_account_nearing_the_limit_is_warned_and_not_deleted()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(MonthsAgo(12).AddDays(20));

            var result = await env.SweepAsync();

            await Assert.That(result.WarningsSent).IsEqualTo(1);
            await Assert.That(env.Warnings.Sent.Single().Email).IsEqualTo("owner@example.com");
            await Assert.That(env.Warnings.Sent.Single().DeleteAfter >= DateTime.UtcNow.AddDays(29)).IsTrue();
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsTrue();
        }

        [Test]
        public async Task An_already_overdue_verified_account_gets_its_warning_period_before_deletion()
        {
            using var env = new Env();
            var (user, loginId) = await env.AccountAsync(MonthsAgo(14));

            await env.SweepAsync();
            var second = await env.SweepAsync();

            await Assert.That(env.Warnings.Sent.Count).IsEqualTo(1);
            await Assert.That(second.AccountsPurged).IsEqualTo(0);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsTrue();
            await Assert.That(env.SignIns.Deleted).DoesNotContain(loginId);
        }

        [Test]
        public async Task A_warning_period_set_too_low_is_raised_to_fourteen_days()
        {
            using var env = new Env();
            env.Options.InactivityWarningDays = 3;
            await env.AccountAsync(MonthsAgo(14));

            await env.SweepAsync();

            await Assert.That(env.Warnings.Sent.Single().DeleteAfter >= DateTime.UtcNow.AddDays(13.9)).IsTrue();
        }

        [Test]
        public async Task After_the_warning_period_the_data_and_the_sign_in_row_are_deleted()
        {
            using var env = new Env();
            var (user, loginId) = await env.AccountAsync(MonthsAgo(14));
            await env.SweepAsync();
            var warning = await env.Db.InactivityWarnings.SingleAsync();
            warning.DeleteAfter = DateTime.UtcNow.AddMinutes(-1);
            await env.Db.SaveChangesAsync();

            var result = await env.SweepAsync();

            await Assert.That(result.AccountsPurged).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsFalse();
            await Assert.That(env.SignIns.Deleted).Contains(loginId);
            await Assert.That(env.Db.InactivityWarnings.Any()).IsFalse();
        }

        [Test]
        public async Task An_account_without_a_verified_address_is_deleted_on_schedule_without_mail()
        {
            using var env = new Env();
            var (overdue, overdueLogin) = await env.AccountAsync(MonthsAgo(13), verifiedEmail: null, unverifiedEmail: "typo@example.com");
            var (nearing, _) = await env.AccountAsync(MonthsAgo(12).AddDays(20), verifiedEmail: null);

            var result = await env.SweepAsync();

            await Assert.That(env.Warnings.Sent).IsEmpty();
            await Assert.That(result.AccountsPurged).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == overdue.Id)).IsFalse();
            await Assert.That(env.SignIns.Deleted).Contains(overdueLogin);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == nearing.Id)).IsTrue();
        }

        [Test]
        public async Task A_warning_from_before_the_last_activity_does_not_count()
        {
            using var env = new Env();
            var (user, loginId) = await env.AccountAsync(MonthsAgo(13));
            env.Db.InactivityWarnings.Add(new InactivityWarning { LoginId = loginId, SentAt = MonthsAgo(26), DeleteAfter = MonthsAgo(25) });
            await env.Db.SaveChangesAsync();

            var result = await env.SweepAsync();

            await Assert.That(result.AccountsPurged).IsEqualTo(0);
            await Assert.That(env.Warnings.Sent.Count).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsTrue();
            await Assert.That((await env.Db.InactivityWarnings.AsNoTracking().SingleAsync()).SentAt > MonthsAgo(1)).IsTrue();
        }

        [Test]
        public async Task An_account_that_came_back_loses_its_warning_and_stays()
        {
            using var env = new Env();
            var (user, loginId) = await env.AccountAsync(DateTime.UtcNow.AddDays(-1));
            env.Db.InactivityWarnings.Add(new InactivityWarning { LoginId = loginId, SentAt = DateTime.UtcNow.AddDays(-20), DeleteAfter = DateTime.UtcNow.AddDays(-1) });
            await env.Db.SaveChangesAsync();

            await env.SweepAsync();

            await Assert.That(env.Db.InactivityWarnings.Any()).IsFalse();
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsTrue();
        }

        [Test]
        public async Task A_warning_that_cannot_be_sent_holds_the_deletion_and_is_retried()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(MonthsAgo(14));
            env.Warnings.Fail = true;

            var failed = await env.SweepAsync();

            await Assert.That(failed.FailedSteps).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsTrue();
            await Assert.That(env.Db.InactivityWarnings.Any()).IsFalse();

            env.Warnings.Fail = false;
            await env.SweepAsync();

            await Assert.That(env.Warnings.Sent.Count).IsEqualTo(1);
        }

        [Test]
        public async Task A_sign_in_row_that_never_reached_the_api_is_swept_too()
        {
            using var env = new Env();
            var abandoned = Guid.CreateVersion7();
            var recent = Guid.CreateVersion7();
            env.AddSignIn(abandoned, MonthsAgo(13), verifiedEmail: null);
            env.AddSignIn(recent, DateTime.UtcNow, verifiedEmail: null);
            await env.Db.SaveChangesAsync();

            await env.SweepAsync();

            await Assert.That(env.SignIns.Deleted).Contains(abandoned);
            await Assert.That(env.SignIns.Deleted).DoesNotContain(recent);
        }

        // --- N1, N3: orphans

        [Test]
        public async Task Plugin_data_is_purged_only_for_owners_that_no_longer_exist_and_repeats_harmlessly()
        {
            using var env = new Env();
            var (alive, _) = await env.AccountAsync(DateTime.UtcNow);
            var gone = Guid.NewGuid();
            env.Plugins.Owners.AddRange([alive.Id, gone]);

            var result = await env.SweepAsync();
            await env.SweepAsync();

            await Assert.That(result.OrphanedOwnersPurged).IsEqualTo(1);
            await Assert.That(env.Plugins.Purged.Select(p => p.UserId).Distinct()).IsEquivalentTo(new[] { gone });
        }

        [Test]
        public async Task Plugin_data_is_left_alone_when_the_host_has_no_users_at_all()
        {
            using var env = new Env();
            env.Plugins.Owners.Add(Guid.NewGuid());

            await env.SweepAsync();

            await Assert.That(env.Plugins.Purged).IsEmpty();
        }

        [Test]
        public async Task A_failing_orphan_purge_is_queued_once_and_counted()
        {
            using var env = new Env();
            await env.AccountAsync(DateTime.UtcNow);
            env.Plugins.Owners.Add(Guid.NewGuid());
            env.Plugins.FailingSources.Add("Schuly.Plugin.OdaOrg");

            await env.SweepAsync();
            var second = await env.SweepAsync();

            await Assert.That(env.Db.PendingPurges.Count()).IsEqualTo(1);
            await Assert.That(second.PendingFailing).IsEqualTo(1);
        }

        [Test]
        public async Task An_account_whose_sign_in_is_gone_is_purged_but_an_account_from_before_the_built_in_sign_in_is_not()
        {
            using var env = new Env();
            await env.AccountAsync(DateTime.UtcNow);
            var recreated = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = Guid.CreateVersion7().ToString(), Email = "gone@example.com", LastSeenAt = DateTime.UtcNow };
            var legacy = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = Guid.NewGuid().ToString(), Email = "legacy@example.com", LastSeenAt = DateTime.UtcNow };
            env.Db.ApplicationUsers.AddRange(recreated, legacy);
            await env.Db.SaveChangesAsync();

            var result = await env.SweepAsync();

            await Assert.That(result.OrphanedAccountsPurged).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == recreated.Id)).IsFalse();
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == legacy.Id)).IsTrue();
        }

        [Test]
        public async Task Only_old_unreferenced_blobs_with_our_key_shape_are_deleted()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            var keep = $"{Guid.NewGuid():N}/avatar.png";
            var orphan = $"{Guid.NewGuid():N}/avatar.png";
            var young = $"{Guid.NewGuid():N}/doc.pdf";
            user.ProfilePictureUrl = keep;
            await env.Db.SaveChangesAsync();
            var old = DateTime.UtcNow.AddDays(-30);
            env.Storage.Stored.AddRange([new StoredBlob(keep, old), new StoredBlob(orphan, old), new StoredBlob(young, DateTime.UtcNow), new StoredBlob("someone-elses/file.txt", old)]);

            var result = await env.SweepAsync();

            await Assert.That(result.OrphanedBlobsDeleted).IsEqualTo(1);
            await Assert.That(env.Storage.Deleted).IsEquivalentTo(new[] { orphan });
        }

        [Test]
        public async Task No_blob_is_deleted_without_any_references_or_with_the_sweep_off()
        {
            using var env = new Env();
            env.Storage.Stored.Add(new StoredBlob($"{Guid.NewGuid():N}/avatar.png", DateTime.UtcNow.AddDays(-30)));
            await env.SweepAsync();
            await Assert.That(env.Storage.Deleted).IsEmpty();

            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            user.ProfilePictureUrl = $"{Guid.NewGuid():N}/kept.png";
            await env.Db.SaveChangesAsync();
            env.Options.SweepOrphanBlobs = false;
            await env.SweepAsync();
            await Assert.That(env.Storage.Deleted).IsEmpty();
        }

        // --- N3: finishing a deletion

        [Test]
        public async Task A_purge_deletes_stored_avatars_and_ignores_remote_pictures()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            user.ProfilePictureUrl = "user-avatar-key";
            await env.Db.SaveChangesAsync();
            await env.SchoolUserAsync(user.Id, "Schuly.Plugin.OdaOrg", null, "school-avatar-key");
            await env.SchoolUserAsync(user.Id, "Schuly.Plugin.Schulware", null, "https://school.example/me.png");

            await new AccountPurger(env.Db, env.Storage, TestVault.Factory(), env.Plugins, NullLogger<AccountPurger>.Instance).PurgeApplicationUserAsync(user.Id);

            await Assert.That(env.Storage.Deleted).IsEquivalentTo(new[] { "user-avatar-key", "school-avatar-key" });
        }

        [Test]
        public async Task A_failed_blob_delete_is_retried_by_the_sweep_until_it_succeeds()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            user.ProfilePictureUrl = "user-avatar-key";
            await env.Db.SaveChangesAsync();
            env.Storage.ThrowOnDelete = true;

            var summary = await new AccountPurger(env.Db, env.Storage, TestVault.Factory(), env.Plugins, NullLogger<AccountPurger>.Instance).PurgeApplicationUserAsync(user.Id);

            await Assert.That(summary.BlobsFailed).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsFalse();
            await Assert.That((await env.Db.PendingPurges.SingleAsync()).Target).IsEqualTo("user-avatar-key");

            var stillFailing = await env.SweepAsync();
            await Assert.That(stillFailing.PendingFailing).IsEqualTo(1);
            await Assert.That((await env.Db.PendingPurges.SingleAsync()).Attempts).IsEqualTo(2);

            env.Storage.ThrowOnDelete = false;
            var done = await env.SweepAsync();

            await Assert.That(done.PendingCompleted).IsEqualTo(1);
            await Assert.That(env.Storage.Deleted).Contains("user-avatar-key");
            await Assert.That(env.Db.PendingPurges.Any()).IsFalse();
        }

        [Test]
        public async Task A_failed_plugin_purge_does_not_stop_the_deletion_and_is_retried_for_that_plugin()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            env.Plugins.FailingSources.Add("Schuly.Plugin.OdaOrg");

            var summary = await new AccountPurger(env.Db, env.Storage, TestVault.Factory(), env.Plugins, NullLogger<AccountPurger>.Instance).PurgeApplicationUserAsync(user.Id);

            await Assert.That(summary.PluginPurgesFailed).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsFalse();

            env.Plugins.FailingSources.Clear();
            env.Plugins.Purged.Clear();
            var done = await env.SweepAsync();

            await Assert.That(done.PendingCompleted).IsEqualTo(1);
            await Assert.That(env.Plugins.Purged).Contains((user.Id, (string?)"Schuly.Plugin.OdaOrg"));
            await Assert.That(env.Db.PendingPurges.Any()).IsFalse();
        }

        // --- N5: leavers

        [Test]
        public async Task A_leaver_loses_the_owning_plugins_data_and_only_that_plugins()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            var leaver = await env.SchoolUserAsync(user.Id, "Schuly.Plugin.Schulware", LeftMonthsAgo(7), "school-avatar-key");

            var result = await env.SweepAsync();

            await Assert.That(result.SchoolUsersPurged).IsEqualTo(1);
            await Assert.That(env.Plugins.Purged).IsEquivalentTo(new[] { (user.Id, (string?)"Schuly.Plugin.Schulware") });
            await Assert.That(env.Storage.Deleted).Contains("school-avatar-key");
            await Assert.That(env.Db.SchoolUsers.Any(su => su.Id == leaver.Id)).IsFalse();
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsTrue();
        }

        [Test]
        public async Task A_leaver_still_at_another_school_through_the_same_plugin_keeps_the_plugin_data()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            var leaver = await env.SchoolUserAsync(user.Id, "Schuly.Plugin.Schulware", LeftMonthsAgo(7));
            var enrolled = await env.SchoolUserAsync(user.Id, "Schuly.Plugin.Schulware", null);

            await env.SweepAsync();

            await Assert.That(env.Plugins.Purged).IsEmpty();
            await Assert.That(env.Db.SchoolUsers.Any(su => su.Id == leaver.Id)).IsFalse();
            await Assert.That(env.Db.SchoolUsers.Any(su => su.Id == enrolled.Id)).IsTrue();
        }

        [Test]
        public async Task A_leaver_loses_the_outbox_rows_of_that_school_only()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(DateTime.UtcNow);
            var leaver = await env.SchoolUserAsync(user.Id, "Schuly.Plugin.Schulware", LeftMonthsAgo(7));
            var enrolled = await env.SchoolUserAsync(user.Id, "Schuly.Plugin.OdaOrg", null);
            var from = DateTime.UtcNow;
            var leaverAbsence = new Absence { Id = Guid.NewGuid(), Reason = "r", Type = AbsenceType.Absence, From = from, Until = from, SchoolUserId = leaver.Id };
            var enrolledAbsence = new Absence { Id = Guid.NewGuid(), Reason = "r", Type = AbsenceType.Absence, From = from, Until = from, SchoolUserId = enrolled.Id };
            env.Db.Absences.AddRange(leaverAbsence, enrolledAbsence);
            env.Db.NotificationOutbox.Add(new NotificationOutbox { ApplicationUserId = user.Id, Type = NotificationType.AbsenceAdded, EntityId = leaverAbsence.Id, NextAttemptAt = from });
            env.Db.NotificationOutbox.Add(new NotificationOutbox { ApplicationUserId = user.Id, Type = NotificationType.AbsenceAdded, EntityId = enrolledAbsence.Id, NextAttemptAt = from });
            await env.Db.SaveChangesAsync();

            await env.SweepAsync();

            await Assert.That(env.Db.NotificationOutbox.Select(o => o.EntityId).ToList()).IsEquivalentTo(new[] { enrolledAbsence.Id });
        }

        // --- Isolation

        [Test]
        public async Task One_failing_step_does_not_stop_the_rest_of_the_sweep()
        {
            using var env = new Env();
            var (user, _) = await env.AccountAsync(MonthsAgo(13), verifiedEmail: null);
            var failing = new FailingOwners();
            var sweeper = new RetentionSweeper(env.Db, new AccountPurger(env.Db, env.Storage, TestVault.Factory(), env.Plugins, NullLogger<AccountPurger>.Instance), failing, env.SignIns, env.Storage, env.Warnings, Options.Create(env.Options), NullLogger<RetentionSweeper>.Instance);

            var result = await sweeper.SweepAsync(CancellationToken.None);

            await Assert.That(result.FailedSteps).IsEqualTo(1);
            await Assert.That(env.Db.ApplicationUsers.Any(u => u.Id == user.Id)).IsFalse();
        }

        private sealed class FailingOwners : IPluginUserDataPurger
        {
            public Task<IReadOnlyList<string>> PurgeAsync(Guid applicationUserId, string? pluginSource = null, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<string>>([]);
            public Task<IReadOnlyCollection<Guid>> ListOwnersAsync(CancellationToken cancellationToken = default) => throw new InvalidOperationException("Simulated failure");
        }
    }
}
