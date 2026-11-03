using Microsoft.Extensions.Configuration;
using Schuly.API.SignUp;
using Schuly.Application.Commands.User;
using Schuly.Application.Dtos;
using Schuly.Application.Queries.App;
using Schuly.Application.Queries.User;
using Schuly.Domain;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class PrivacyNoticeTests
    {
        private static IConfiguration Config(bool switzerlandOnly = false, string? version = null) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SignUp:SwitzerlandOnly"] = switzerlandOnly.ToString(),
            ["Privacy:PolicyVersion"] = version,
        }).Build();

        private static async Task<FakeUserService> UserAsync(string db)
        {
            using var ctx = TestDb.NewContext(db);
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = Guid.NewGuid().ToString(), Email = "u@example.com" };
            ctx.ApplicationUsers.Add(user);
            await ctx.SaveChangesAsync();
            return new FakeUserService { CurrentUserId = user.Id };
        }

        private static async Task<PrivacyNoticeStatusDto> StatusAsync(string db, FakeUserService user, IConfiguration config)
        {
            using var ctx = TestDb.NewContext(db);
            return (await new GetPrivacyNoticeStatusQueryHandler(ctx, user, config).Handle(new GetPrivacyNoticeStatusQuery(), CancellationToken.None)).Value!;
        }

        private static async Task<bool> AcceptAsync(string db, FakeUserService user, IConfiguration config, string version, bool swiss)
        {
            using var ctx = TestDb.NewContext(db);
            return (await new AcceptPrivacyNoticeCommandHandler(ctx, user, config).Handle(new AcceptPrivacyNoticeCommand(version, swiss), CancellationToken.None)).IsSuccess;
        }

        [Test]
        public async Task An_existing_user_is_asked_once_and_the_answer_is_recorded()
        {
            var db = nameof(An_existing_user_is_asked_once_and_the_answer_is_recorded);
            var user = await UserAsync(db);
            var config = Config();

            var before = await StatusAsync(db, user, config);
            await Assert.That(before.AcceptanceRequired).IsTrue();
            await Assert.That(before.PolicyUrl).IsEqualTo("https://schuly.dev/privacy");

            await Assert.That(await AcceptAsync(db, user, config, before.PolicyVersion, false)).IsTrue();

            var after = await StatusAsync(db, user, config);
            await Assert.That(after.AcceptanceRequired).IsFalse();
            await Assert.That(after.AcceptedVersion).IsEqualTo(before.PolicyVersion);
            await Assert.That(after.AcceptedAt).IsNotNull();
        }

        [Test]
        public async Task A_new_policy_version_asks_again_and_an_old_version_is_refused()
        {
            var db = nameof(A_new_policy_version_asks_again_and_an_old_version_is_refused);
            var user = await UserAsync(db);
            await AcceptAsync(db, user, Config(version: "v1"), "v1", false);

            var config = Config(version: "v2");
            await Assert.That((await StatusAsync(db, user, config)).AcceptanceRequired).IsTrue();
            await Assert.That(await AcceptAsync(db, user, config, "v1", false)).IsFalse();
            await Assert.That((await StatusAsync(db, user, config)).AcceptanceRequired).IsTrue();
        }

        [Test]
        public async Task A_self_hosted_server_without_the_swiss_limit_never_asks_for_the_confirmation()
        {
            var db = nameof(A_self_hosted_server_without_the_swiss_limit_never_asks_for_the_confirmation);
            var user = await UserAsync(db);
            var config = Config(switzerlandOnly: false);

            var status = await StatusAsync(db, user, config);
            await Assert.That(status.SwissSchoolConfirmationRequired).IsFalse();
            await Assert.That(await AcceptAsync(db, user, config, status.PolicyVersion, swiss: false)).IsTrue();

            var after = await StatusAsync(db, user, config);
            await Assert.That(after.AcceptanceRequired).IsFalse();
            await Assert.That(after.SwissSchoolConfirmedAt).IsNull();
        }

        [Test]
        public async Task With_the_swiss_limit_the_confirmation_is_required_and_recorded()
        {
            var db = nameof(With_the_swiss_limit_the_confirmation_is_required_and_recorded);
            var user = await UserAsync(db);
            var config = Config(switzerlandOnly: true);
            var status = await StatusAsync(db, user, config);
            await Assert.That(status.SwissSchoolConfirmationRequired).IsTrue();

            await Assert.That(await AcceptAsync(db, user, config, status.PolicyVersion, swiss: false)).IsFalse();
            await Assert.That((await StatusAsync(db, user, config)).AcceptanceRequired).IsTrue();

            await Assert.That(await AcceptAsync(db, user, config, status.PolicyVersion, swiss: true)).IsTrue();
            var after = await StatusAsync(db, user, config);
            await Assert.That(after.AcceptanceRequired).IsFalse();
            await Assert.That(after.SwissSchoolConfirmedAt).IsNotNull();
        }

        [Test]
        public async Task A_user_who_accepted_before_the_swiss_limit_was_turned_on_is_asked_again()
        {
            var db = nameof(A_user_who_accepted_before_the_swiss_limit_was_turned_on_is_asked_again);
            var user = await UserAsync(db);
            await AcceptAsync(db, user, Config(), PrivacyNotice.DefaultVersion, false);

            await Assert.That((await StatusAsync(db, user, Config(switzerlandOnly: true))).AcceptanceRequired).IsTrue();
        }

        [Test]
        public async Task The_anonymous_app_info_tells_private_mode_whether_to_ask()
        {
            var off = (await new AppQueryHandler(Config()).Handle(new AppQuery(), CancellationToken.None)).Value!;
            var on = (await new AppQueryHandler(Config(switzerlandOnly: true)).Handle(new AppQuery(), CancellationToken.None)).Value!;

            await Assert.That(off.SwissSchoolConfirmationRequired).IsFalse();
            await Assert.That(on.SwissSchoolConfirmationRequired).IsTrue();
            await Assert.That(on.PolicyVersion).IsEqualTo(PrivacyNotice.DefaultVersion);
            await Assert.That(on.PolicyUrl).IsEqualTo("https://schuly.dev/privacy");
        }

        [Test]
        public async Task The_confirmation_leaves_the_network_limit_in_force()
        {
            // The gate and the OIDC limit read only SignUp:SwitzerlandOnly, not anything the user confirmed.
            await Assert.That(Config(switzerlandOnly: true).SwitzerlandOnly()).IsTrue();
            await Assert.That(SwissSignUpGate.IsSwiss(System.Net.IPAddress.Parse("8.8.8.8"))).IsFalse();
        }
    }
}
