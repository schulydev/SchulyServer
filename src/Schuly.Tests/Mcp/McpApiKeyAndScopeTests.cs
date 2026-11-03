using Microsoft.EntityFrameworkCore;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Mcp;
using Schuly.Tests.TestHelpers;
using static Schuly.Tests.Mcp.McpTestSupport;

namespace Schuly.Tests.Mcp
{
    public class McpApiKeyAndScopeTests
    {
        [Test]
        public async Task A_key_is_shown_once_and_only_its_hash_is_stored()
        {
            using var db = TestDb.NewContext(nameof(A_key_is_shown_once_and_only_its_hash_is_stored));
            var (_, keys, _) = Services(db);
            var (user, _) = NewUser(db);

            var (created, error) = await keys.CreateAsync(user.Id, "Claude Desktop", null, null);

            await Assert.That(error).IsNull();
            await Assert.That(created!.Secret).StartsWith(McpSecrets.ApiKeyPrefix);
            // 32 random bytes as unpadded base64url are 43 characters: 256 bits.
            await Assert.That(created.Secret.Length - McpSecrets.ApiKeyPrefix.Length).IsEqualTo(43);
            var stored = await db.McpApiKeys.SingleAsync();
            await Assert.That(stored.KeyHash).IsEqualTo(McpSecrets.Hash(created.Secret));
            await Assert.That(stored.KeyHash).IsNotEqualTo(created.Secret);
            await Assert.That(created.Secret.StartsWith(stored.Prefix)).IsTrue();
            await Assert.That((await keys.ListAsync(user.Id)).Single().Prefix.Length).IsLessThan(created.Secret.Length);
        }

        [Test]
        public async Task A_key_validates_until_it_is_revoked_or_expires()
        {
            using var db = TestDb.NewContext(nameof(A_key_validates_until_it_is_revoked_or_expires));
            var (_, keys, time) = Services(db);
            var (user, _) = NewUser(db);
            var (forever, _) = await keys.CreateAsync(user.Id, "forever", null, null);
            var (shortLived, _) = await keys.CreateAsync(user.Id, "short", null, time.GetUtcNow().UtcDateTime.AddDays(1));

            var caller = await keys.ValidateAsync(forever!.Secret);
            await Assert.That(caller!.ApplicationUserId).IsEqualTo(user.Id);
            await Assert.That(caller.ApiKeyId).IsEqualTo(forever.Key.Id);
            await Assert.That((await db.McpApiKeys.SingleAsync(k => k.Id == forever.Key.Id)).LastUsedAt.HasValue).IsTrue();

            await Assert.That(await keys.ValidateAsync(McpSecrets.ApiKeyPrefix + "guessed")).IsNull();
            await Assert.That(await keys.ValidateAsync(forever.Secret + "x")).IsNull();

            time.Advance(TimeSpan.FromDays(2));
            await Assert.That(await keys.ValidateAsync(shortLived!.Secret)).IsNull();

            await Assert.That(await keys.RevokeAsync(Guid.NewGuid(), forever.Key.Id)).IsFalse();
            await Assert.That(await keys.RevokeAsync(user.Id, forever.Key.Id)).IsTrue();
            await Assert.That(await keys.ValidateAsync(forever.Secret)).IsNull();
        }

        [Test]
        public async Task A_key_defaults_to_read_only_and_its_scope_is_what_the_user_chose()
        {
            using var db = TestDb.NewContext(nameof(A_key_defaults_to_read_only_and_its_scope_is_what_the_user_chose));
            var (_, keys, _) = Services(db);
            var (user, _) = NewUser(db);

            var (readOnly, _) = await keys.CreateAsync(user.Id, "default", null, null);
            var (mail, _) = await keys.CreateAsync(user.Id, "mail", new McpPermissionSet { Areas = { [McpArea.Mail] = McpAccessLevel.ReadWrite, [McpArea.Grades] = McpAccessLevel.ReadWrite } }, null);

            var readOnlyScopes = McpScopes.Granted((await keys.ValidateAsync(readOnly!.Secret))!.Permissions);
            var mailScopes = McpScopes.Granted((await keys.ValidateAsync(mail!.Secret))!.Permissions);

            await Assert.That(readOnlyScopes).Contains("schuly.grades.read");
            await Assert.That(readOnlyScopes.Any(s => s.EndsWith(".write"))).IsFalse();
            await Assert.That(readOnlyScopes).DoesNotContain(McpScopes.Destructive);
            await Assert.That(mailScopes).Contains("ms.mail.write");
            // Grades has no write tools, so write access to it is normalised away.
            await Assert.That(mailScopes).Contains("schuly.grades.read");
            await Assert.That(mailScopes).DoesNotContain("schuly.grades.write");
            await Assert.That(mailScopes).DoesNotContain("schuly.exams.read");
        }

        [Test]
        public async Task Key_validation_and_creation_refuse_bad_input()
        {
            using var db = TestDb.NewContext(nameof(Key_validation_and_creation_refuse_bad_input));
            var (_, keys, time) = Services(db, new McpOAuthOptions { MaxApiKeysPerUser = 1 });
            var (user, _) = NewUser(db);

            await Assert.That((await keys.CreateAsync(user.Id, "  ", null, null)).Error).IsNotNull();
            await Assert.That((await keys.CreateAsync(user.Id, "past", null, time.GetUtcNow().UtcDateTime.AddMinutes(-1))).Error).IsNotNull();
            await Assert.That((await keys.CreateAsync(user.Id, "one", null, null)).Error).IsNull();
            await Assert.That((await keys.CreateAsync(user.Id, "two", null, null)).Error).IsNotNull();
        }

        [Test]
        public async Task Requested_scopes_preselect_the_checklist_read_only_and_unknown_ones_are_ignored()
        {
            var none = McpScopes.Requested(null);
            var openid = McpScopes.Requested("openid offline_access");
            var mail = McpScopes.Requested("openid ms.mail.write schuly.grades.read");

            await Assert.That(none.Level(McpArea.Grades)).IsEqualTo(McpAccessLevel.Read);
            await Assert.That(none.Level(McpArea.Mail)).IsEqualTo(McpAccessLevel.Off);
            await Assert.That(none.AllowDestructive).IsFalse();
            await Assert.That(openid.Level(McpArea.Teams)).IsEqualTo(McpAccessLevel.Off);
            await Assert.That(openid.Level(McpArea.Exams)).IsEqualTo(McpAccessLevel.Read);
            await Assert.That(mail.Level(McpArea.Mail)).IsEqualTo(McpAccessLevel.Off);
            await Assert.That(mail.Level(McpArea.Grades)).IsEqualTo(McpAccessLevel.Read);
            await Assert.That(mail.Level(McpArea.Drive)).IsEqualTo(McpAccessLevel.Off);
        }

        [Test]
        public async Task Permission_sets_survive_the_database_round_trip()
        {
            var set = new McpPermissionSet { Areas = { [McpArea.Mail] = McpAccessLevel.ReadWrite }, AllowDestructive = true, MicrosoftAccountIds = [Guid.NewGuid()] };

            var back = McpPermissionJson.Deserialize(McpPermissionJson.Serialize(set));

            await Assert.That(back.Level(McpArea.Mail)).IsEqualTo(McpAccessLevel.ReadWrite);
            await Assert.That(back.AllowDestructive).IsTrue();
            await Assert.That(back.MicrosoftAccountIds!.Single()).IsEqualTo(set.MicrosoftAccountIds[0]);
            await Assert.That(McpPermissionJson.Deserialize("{not json").Areas).IsEmpty();
        }
    }
}
