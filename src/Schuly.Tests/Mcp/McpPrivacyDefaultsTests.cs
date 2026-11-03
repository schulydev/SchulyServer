using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Schuly.Application.Commands.Mcp;
using Schuly.Application.Dtos;
using Schuly.Domain;
using Schuly.Domain.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Mcp;
using Schuly.Infrastructure.Vault;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests.Mcp
{
    public class McpPrivacyDefaultsTests
    {
        private static readonly McpArea[] Microsoft = [McpArea.Mail, McpArea.Teams, McpArea.Drive, McpArea.OneNote];

        private static async Task AssertSchoolDataOnlyAsync(McpPermissionSet set)
        {
            foreach (var area in Microsoft)
                await Assert.That(set.Level(area)).IsEqualTo(McpAccessLevel.Off);
            await Assert.That(set.Level(McpArea.Grades)).IsEqualTo(McpAccessLevel.Read);
            await Assert.That(set.Level(McpArea.Absences)).IsEqualTo(McpAccessLevel.Read);
            await Assert.That(set.AllowDestructive).IsFalse();
            // The calendar area also reads Microsoft calendars, so no account may be allowed either.
            await Assert.That(set.AllowsMicrosoftAccount(Guid.NewGuid())).IsFalse();
        }

        [Test]
        public async Task New_connections_keys_and_helply_start_with_school_data_only()
        {
            await AssertSchoolDataOnlyAsync(McpPermissionSet.SchoolDataOnly());
            await AssertSchoolDataOnlyAsync(new McpGrant().Permissions);
            await AssertSchoolDataOnlyAsync(new HelplySettings().Permissions);
            await AssertSchoolDataOnlyAsync(new McpApiKey { Name = "k", Prefix = "p", KeyHash = "h" }.Permissions);
            await AssertSchoolDataOnlyAsync(McpScopes.Requested(null));
        }

        [Test]
        public async Task An_app_asking_for_microsoft_scopes_does_not_get_them_preselected()
        {
            var set = McpScopes.Requested("ms.mail.write ms.teams.read schuly.grades.read");

            await AssertSchoolDataOnlyAsyncExceptOtherSchoolAreas(set);
            await Assert.That(set.Level(McpArea.Exams)).IsEqualTo(McpAccessLevel.Off);
        }

        private static async Task AssertSchoolDataOnlyAsyncExceptOtherSchoolAreas(McpPermissionSet set)
        {
            foreach (var area in Microsoft)
                await Assert.That(set.Level(area)).IsEqualTo(McpAccessLevel.Off);
            await Assert.That(set.Level(McpArea.Grades)).IsEqualTo(McpAccessLevel.Read);
            await Assert.That(set.AllowsMicrosoftAccount(Guid.NewGuid())).IsFalse();
        }

        [Test]
        public async Task A_user_without_saved_helply_settings_gets_the_default()
        {
            using var db = TestDb.NewContext(nameof(A_user_without_saved_helply_settings_gets_the_default));
            var store = new HelplyConversationStore(db, new HelplyCipher(VaultKeyring.Ephemeral()), TimeProvider.System);

            await AssertSchoolDataOnlyAsync(await store.GetPermissionsAsync(Guid.NewGuid()));
        }

        [Test]
        public async Task Existing_helply_settings_stay_as_they_are()
        {
            using var db = TestDb.NewContext(nameof(Existing_helply_settings_stay_as_they_are));
            var userId = Guid.NewGuid();
            db.HelplySettings.Add(new HelplySettings { ApplicationUserId = userId, Permissions = McpPermissionSet.ReadOnly() });
            await db.SaveChangesAsync();
            var store = new HelplyConversationStore(db, new HelplyCipher(VaultKeyring.Ephemeral()), TimeProvider.System);

            var permissions = await store.GetPermissionsAsync(userId);

            await Assert.That(permissions.Level(McpArea.Mail)).IsEqualTo(McpAccessLevel.Read);
            await Assert.That(permissions.AllowsMicrosoftAccount(Guid.NewGuid())).IsTrue();
        }

        private static McpApiKeyService Keys(Schuly.Infrastructure.SchulyDbContext db)
        {
            var options = Options.Create(new McpOAuthOptions());
            return new McpApiKeyService(db, new McpOAuthService(db, options, TimeProvider.System), options, TimeProvider.System);
        }

        [Test]
        public async Task A_new_api_key_expires_by_default_and_a_chosen_date_is_kept()
        {
            using var db = TestDb.NewContext(nameof(A_new_api_key_expires_by_default_and_a_chosen_date_is_kept));
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "x", Email = "a@example.com" };
            db.ApplicationUsers.Add(user);
            await db.SaveChangesAsync();
            var keys = Keys(db);

            var (byDefault, _) = await keys.CreateAsync(user.Id, "default", null, null);
            var chosen = DateTime.UtcNow.AddDays(10);
            var (withDate, _) = await keys.CreateAsync(user.Id, "dated", null, chosen);

            await Assert.That(byDefault!.Key.ExpiresAt).IsNotNull();
            await Assert.That(byDefault.Key.ExpiresAt!.Value > DateTime.UtcNow.AddDays(89)).IsTrue();
            await Assert.That(byDefault.Key.ExpiresAt!.Value < DateTime.UtcNow.AddDays(91)).IsTrue();
            await Assert.That(withDate!.Key.ExpiresAt).IsEqualTo(chosen);
            await AssertSchoolDataOnlyAsync(byDefault.Key.Permissions);
        }

        [Test]
        public async Task A_key_is_refused_without_the_opt_in()
        {
            using var db = TestDb.NewContext(nameof(A_key_is_refused_without_the_opt_in));
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "x", Email = "a@example.com" };
            db.ApplicationUsers.Add(user);
            await db.SaveChangesAsync();
            var handler = new CreateMcpApiKeyCommandHandler(Keys(db), new FakeUserService { CurrentUserId = user.Id });

            var refused = await handler.Handle(new CreateMcpApiKeyCommand("k", null, null), CancellationToken.None);
            var accepted = await handler.Handle(new CreateMcpApiKeyCommand("k", null, null, AiAppSharingConfirmed: true), CancellationToken.None);

            await Assert.That(refused.IsSuccess).IsFalse();
            await Assert.That(accepted.IsSuccess).IsTrue();
        }

        [Test]
        public async Task An_app_is_refused_without_the_opt_in_but_can_still_be_denied()
        {
            using var db = TestDb.NewContext(nameof(An_app_is_refused_without_the_opt_in_but_can_still_be_denied));
            var options = new McpOAuthOptions { PublicUrl = McpTestSupport.Issuer };
            var (oauth, _, _) = McpTestSupport.Services(db, options);
            var (user, _) = McpTestSupport.NewUser(db);
            var clientId = await McpTestSupport.RegisterAsync(oauth);
            var parameters = new McpAuthorizationParameters("code", clientId, McpTestSupport.Redirect, null, "state", Pkce.ChallengeFor("verifier-verifier-verifier-verifier-verifier"), "S256", McpTestSupport.Resource);
            var handler = new DecideMcpAuthorizationCommandHandler(oauth, new McpPublicUrls(new HttpContextAccessor(), Options.Create(options)), new FakeUserService { CurrentUserId = user.Id });

            var refused = await handler.Handle(new DecideMcpAuthorizationCommand(parameters, true, null), CancellationToken.None);
            await Assert.That(db.McpGrants.Any()).IsFalse();
            var denied = await handler.Handle(new DecideMcpAuthorizationCommand(parameters, false, null), CancellationToken.None);
            var accepted = await handler.Handle(new DecideMcpAuthorizationCommand(parameters, true, null, AiAppSharingConfirmed: true), CancellationToken.None);

            await Assert.That(refused.IsSuccess).IsFalse();
            await Assert.That(denied.Value!.RedirectUrl).Contains("access_denied");
            await Assert.That(accepted.Value!.RedirectUrl).Contains("code=");
            await AssertSchoolDataOnlyAsync(db.McpGrants.Single().Permissions);
        }
    }
}
