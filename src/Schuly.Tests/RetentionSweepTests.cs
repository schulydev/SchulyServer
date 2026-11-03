using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Schuly.Domain;
using Schuly.Infrastructure.Services;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class RetentionSweepTests
    {
        private static School NewSchool() => new() { Id = Guid.NewGuid(), Name = "Test School" };

        private static RetentionSweeper NewSweeper(Schuly.Infrastructure.SchulyDbContext ctx, RetentionOptions options) =>
            new(ctx, new AccountPurger(ctx, new FakeDocumentStorage(), TestVault.Factory(), NullPluginUserDataPurger.Instance, NullLogger<AccountPurger>.Instance), NullPluginUserDataPurger.Instance, new FakeUserStore(), new FakeDocumentStorage(), new FakeWarningSender(), Options.Create(options), NullLogger<RetentionSweeper>.Instance);

        private static RetentionOptions DefaultOptions() => new() { Enabled = true, MonthsAfterLeave = 6, MonthsInactive = 12 };

        [Test]
        public async Task A_school_user_who_left_long_ago_is_purged_but_the_account_survives()
        {
            using var ctx = TestDb.NewContext(nameof(A_school_user_who_left_long_ago_is_purged_but_the_account_survives));
            var school = NewSchool();
            ctx.Schools.Add(school);

            var applicationUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-1", Email = "a@example.com" };
            ctx.ApplicationUsers.Add(applicationUser);

            var schoolUser = TestDb.NewSchoolUser(school.Id);
            schoolUser.ApplicationUserId = applicationUser.Id;
            schoolUser.LeaveDate = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-7);
            ctx.SchoolUsers.Add(schoolUser);

            await ctx.SaveChangesAsync();

            var result = await NewSweeper(ctx, DefaultOptions()).SweepAsync(CancellationToken.None);

            await Assert.That(result.SchoolUsersPurged).IsEqualTo(1);
            await Assert.That(ctx.SchoolUsers.Any(su => su.Id == schoolUser.Id)).IsFalse();
            await Assert.That(ctx.ApplicationUsers.Any(u => u.Id == applicationUser.Id)).IsTrue();
        }

        [Test]
        public async Task Recent_leavers_and_null_leave_dates_are_left_alone()
        {
            using var ctx = TestDb.NewContext(nameof(Recent_leavers_and_null_leave_dates_are_left_alone));
            var school = NewSchool();
            ctx.Schools.Add(school);

            var recentLeaver = TestDb.NewSchoolUser(school.Id, "Recent");
            recentLeaver.LeaveDate = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-1);
            ctx.SchoolUsers.Add(recentLeaver);

            var stillEnrolled = TestDb.NewSchoolUser(school.Id, "Enrolled");
            stillEnrolled.LeaveDate = null;
            ctx.SchoolUsers.Add(stillEnrolled);

            await ctx.SaveChangesAsync();

            var result = await NewSweeper(ctx, DefaultOptions()).SweepAsync(CancellationToken.None);

            await Assert.That(result.SchoolUsersPurged).IsEqualTo(0);
            await Assert.That(ctx.SchoolUsers.Any(su => su.Id == recentLeaver.Id)).IsTrue();
            await Assert.That(ctx.SchoolUsers.Any(su => su.Id == stillEnrolled.Id)).IsTrue();
        }

        [Test]
        public async Task An_account_inactive_beyond_the_threshold_is_deleted_with_its_school_users()
        {
            using var ctx = TestDb.NewContext(nameof(An_account_inactive_beyond_the_threshold_is_deleted_with_its_school_users));
            var school = NewSchool();
            ctx.Schools.Add(school);

            var applicationUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-2", Email = "b@example.com" };
            ctx.ApplicationUsers.Add(applicationUser);

            var schoolUser = TestDb.NewSchoolUser(school.Id);
            schoolUser.ApplicationUserId = applicationUser.Id;
            ctx.SchoolUsers.Add(schoolUser);

            await ctx.SaveChangesAsync();

            applicationUser.LastSeenAt = DateTime.UtcNow.AddMonths(-13);
            await ctx.SaveChangesAsync();

            var result = await NewSweeper(ctx, DefaultOptions()).SweepAsync(CancellationToken.None);

            await Assert.That(result.AccountsPurged).IsEqualTo(1);
            await Assert.That(ctx.ApplicationUsers.Any(u => u.Id == applicationUser.Id)).IsFalse();
            await Assert.That(ctx.SchoolUsers.Any(su => su.Id == schoolUser.Id)).IsFalse();
        }

        [Test]
        public async Task An_account_seen_recently_is_kept()
        {
            using var ctx = TestDb.NewContext(nameof(An_account_seen_recently_is_kept));

            var applicationUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-3", Email = "c@example.com" };
            ctx.ApplicationUsers.Add(applicationUser);
            await ctx.SaveChangesAsync();

            applicationUser.LastSeenAt = DateTime.UtcNow.AddDays(-1);
            await ctx.SaveChangesAsync();

            var result = await NewSweeper(ctx, DefaultOptions()).SweepAsync(CancellationToken.None);

            await Assert.That(result.AccountsPurged).IsEqualTo(0);
            await Assert.That(ctx.ApplicationUsers.Any(u => u.Id == applicationUser.Id)).IsTrue();
        }

        [Test]
        public async Task An_account_with_no_last_seen_falls_back_to_an_old_created_at_and_is_purged()
        {
            using var ctx = TestDb.NewContext(nameof(An_account_with_no_last_seen_falls_back_to_an_old_created_at_and_is_purged));

            var applicationUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-4", Email = "d@example.com" };
            ctx.ApplicationUsers.Add(applicationUser);
            await ctx.SaveChangesAsync();

            applicationUser.CreatedAt = DateTime.UtcNow.AddMonths(-13);
            await ctx.SaveChangesAsync();

            var result = await NewSweeper(ctx, DefaultOptions()).SweepAsync(CancellationToken.None);

            await Assert.That(result.AccountsPurged).IsEqualTo(1);
            await Assert.That(ctx.ApplicationUsers.Any(u => u.Id == applicationUser.Id)).IsFalse();
        }

        [Test]
        public async Task An_account_with_no_last_seen_and_a_recent_created_at_is_kept()
        {
            using var ctx = TestDb.NewContext(nameof(An_account_with_no_last_seen_and_a_recent_created_at_is_kept));

            var applicationUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-5", Email = "e@example.com" };
            ctx.ApplicationUsers.Add(applicationUser);
            await ctx.SaveChangesAsync();

            var result = await NewSweeper(ctx, DefaultOptions()).SweepAsync(CancellationToken.None);

            await Assert.That(result.AccountsPurged).IsEqualTo(0);
            await Assert.That(ctx.ApplicationUsers.Any(u => u.Id == applicationUser.Id)).IsTrue();
        }

        [Test]
        public async Task Nothing_is_purged_when_retention_is_disabled()
        {
            using var ctx = TestDb.NewContext(nameof(Nothing_is_purged_when_retention_is_disabled));
            var school = NewSchool();
            ctx.Schools.Add(school);

            var applicationUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-6", Email = "f@example.com" };
            ctx.ApplicationUsers.Add(applicationUser);

            var schoolUser = TestDb.NewSchoolUser(school.Id);
            schoolUser.ApplicationUserId = applicationUser.Id;
            schoolUser.LeaveDate = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-7);
            ctx.SchoolUsers.Add(schoolUser);

            await ctx.SaveChangesAsync();

            applicationUser.LastSeenAt = DateTime.UtcNow.AddMonths(-13);
            await ctx.SaveChangesAsync();

            var options = DefaultOptions();
            options.Enabled = false;

            var result = await NewSweeper(ctx, options).SweepAsync(CancellationToken.None);

            await Assert.That(result.SchoolUsersPurged).IsEqualTo(0);
            await Assert.That(result.AccountsPurged).IsEqualTo(0);
            await Assert.That(ctx.ApplicationUsers.Any(u => u.Id == applicationUser.Id)).IsTrue();
            await Assert.That(ctx.SchoolUsers.Any(su => su.Id == schoolUser.Id)).IsTrue();
        }
    }
}
