using Microsoft.EntityFrameworkCore;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Mcp;
using Schuly.Tests.TestHelpers;
using Toamaisutaa.Abstractions;
using static Schuly.Tests.Mcp.McpTestSupport;

namespace Schuly.Tests.Mcp
{
    public class McpOAuthTests
    {
        private static async Task<(McpOAuthService OAuth, MutableTimeProvider Time, Guid UserId, string ClientId, string Code, Infrastructure.SchulyDbContext Db)> ApprovedAsync(string name, McpPermissionSet? permissions = null)
        {
            var db = TestDb.NewContext(name);
            var (oauth, _, time) = Services(db);
            var (user, _) = NewUser(db);
            var clientId = await RegisterAsync(oauth);
            var request = Request(clientId, Pkce.ChallengeFor(Verifier));
            var check = await oauth.CheckAuthorizationRequestAsync(request, Resource);
            await Assert.That(check.Status).IsEqualTo(AuthorizationRequestStatus.Valid);
            var code = await oauth.ApproveAsync(user.Id, request, Resource, permissions ?? McpPermissionSet.ReadOnly());
            return (oauth, time, user.Id, clientId, code, db);
        }

        [Test]
        public async Task Pkce_accepts_the_matching_verifier_and_rejects_any_other()
        {
            var challenge = Pkce.ChallengeFor(Verifier);
            await Assert.That(Pkce.Verify(Verifier, challenge)).IsTrue();
            await Assert.That(Pkce.Verify(Verifier + "x", challenge)).IsFalse();
            await Assert.That(Pkce.Verify("short", Pkce.ChallengeFor("short"))).IsFalse();
            await Assert.That(Pkce.Verify(null, challenge)).IsFalse();
        }

        [Test]
        public async Task Pkce_matches_the_rfc_7636_example()
        {
            // RFC 7636 appendix B, computed independently of the code under test.
            await Assert.That(Pkce.ChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).IsEqualTo("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        }

        [Test]
        public async Task An_authorization_request_with_plain_or_no_pkce_is_sent_back_with_an_error()
        {
            using var db = TestDb.NewContext(nameof(An_authorization_request_with_plain_or_no_pkce_is_sent_back_with_an_error));
            var (oauth, _, _) = Services(db);
            var clientId = await RegisterAsync(oauth);

            var plain = await oauth.CheckAuthorizationRequestAsync(Request(clientId, Verifier, method: "plain"), Resource);
            var none = await oauth.CheckAuthorizationRequestAsync(Request(clientId, null!, method: null!), Resource);

            await Assert.That(plain.Status).IsEqualTo(AuthorizationRequestStatus.Redirect);
            await Assert.That(plain.Error).IsEqualTo("invalid_request");
            await Assert.That(none.Status).IsEqualTo(AuthorizationRequestStatus.Redirect);
        }

        [Test]
        public async Task A_redirect_uri_that_was_not_registered_is_fatal_and_never_redirected_to()
        {
            using var db = TestDb.NewContext(nameof(A_redirect_uri_that_was_not_registered_is_fatal_and_never_redirected_to));
            var (oauth, _, _) = Services(db);
            var clientId = await RegisterAsync(oauth);

            var check = await oauth.CheckAuthorizationRequestAsync(Request(clientId, Pkce.ChallengeFor(Verifier), redirect: "https://evil.example/callback"), Resource);
            var prefix = await oauth.CheckAuthorizationRequestAsync(Request(clientId, Pkce.ChallengeFor(Verifier), redirect: Redirect + "/extra"), Resource);
            var unknownClient = await oauth.CheckAuthorizationRequestAsync(Request("mcp_nope", Pkce.ChallengeFor(Verifier)), Resource);

            await Assert.That(check.Status).IsEqualTo(AuthorizationRequestStatus.Fatal);
            await Assert.That(check.RedirectUri).IsNull();
            await Assert.That(prefix.Status).IsEqualTo(AuthorizationRequestStatus.Fatal);
            await Assert.That(unknownClient.Status).IsEqualTo(AuthorizationRequestStatus.Fatal);
        }

        [Test]
        public async Task Redirect_matching_is_exact_except_for_the_loopback_port()
        {
            string[] registered = ["http://127.0.0.1:33418/callback", "cursor://anysphere.cursor-mcp/oauth/callback", "https://vscode.dev/redirect"];

            await Assert.That(RedirectUris.Matches(registered, "http://127.0.0.1:51234/callback")).IsTrue();
            await Assert.That(RedirectUris.Matches(registered, "cursor://anysphere.cursor-mcp/oauth/callback")).IsTrue();
            await Assert.That(RedirectUris.Matches(registered, "http://127.0.0.1:51234/other")).IsFalse();
            await Assert.That(RedirectUris.Matches(registered, "http://localhost:33418/callback")).IsFalse();
            await Assert.That(RedirectUris.Matches(registered, "https://vscode.dev/redirect?x=1")).IsFalse();
            await Assert.That(RedirectUris.Matches(registered, "https://vscode.dev:8443/redirect")).IsFalse();
            await Assert.That(RedirectUris.Matches(registered, "cursor://anysphere.cursor-mcp/oauth/other")).IsFalse();
        }

        [Test]
        public async Task Registration_refuses_dangerous_and_non_loopback_http_redirects()
        {
            foreach (var bad in new[] { "javascript:alert(1)", "data:text/html,hi", "http://example.com/cb", "https://example.com/cb#frag", "https://user:pw@example.com/cb", "file:///etc/passwd", "not a uri", "https://*.example.com/cb" })
                await Assert.That(RedirectUris.IsAllowedForRegistration(bad)).IsFalse().Because(bad);

            foreach (var good in new[] { "https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:1234/cb", "http://localhost/cb", "http://[::1]:9000/cb", "cursor://anysphere.cursor-mcp/oauth/callback" })
                await Assert.That(RedirectUris.IsAllowedForRegistration(good)).IsTrue().Because(good);
        }

        [Test]
        public async Task Registration_only_accepts_public_clients()
        {
            using var db = TestDb.NewContext(nameof(Registration_only_accepts_public_clients));
            var (oauth, _, _) = Services(db);

            var (response, error) = await oauth.RegisterClientAsync(new ClientRegistrationRequest([Redirect], "Confidential", null, "client_secret_basic", null, null, null, null, null), "203.0.113.9");

            await Assert.That(response).IsNull();
            await Assert.That(error!.Error).IsEqualTo("invalid_client_metadata");
        }

        [Test]
        public async Task Registration_is_capped_per_ip()
        {
            using var db = TestDb.NewContext(nameof(Registration_is_capped_per_ip));
            var (oauth, _, _) = Services(db, new McpOAuthOptions { MaxClientRegistrationsPerIpPerDay = 2 });
            var request = new ClientRegistrationRequest([Redirect], "App", null, null, null, null, null, null, null);

            await Assert.That((await oauth.RegisterClientAsync(request, "198.51.100.1")).Error).IsNull();
            await Assert.That((await oauth.RegisterClientAsync(request, "198.51.100.1")).Error).IsNull();
            await Assert.That((await oauth.RegisterClientAsync(request, "198.51.100.1")).Error!.Error).IsEqualTo("temporarily_unavailable");
            await Assert.That((await oauth.RegisterClientAsync(request, "198.51.100.2")).Error).IsNull();
        }

        [Test]
        public async Task The_code_exchange_issues_tokens_bound_to_the_mcp_resource()
        {
            var (oauth, _, _, clientId, code, db) = await ApprovedAsync(nameof(The_code_exchange_issues_tokens_bound_to_the_mcp_resource));
            using var _db = db;

            var (tokens, error) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, Resource, Resource);

            await Assert.That(error).IsNull();
            await Assert.That(tokens!.AccessToken).StartsWith(McpSecrets.AccessTokenPrefix);
            await Assert.That(tokens.RefreshToken!).StartsWith(McpSecrets.RefreshTokenPrefix);
            await Assert.That(tokens.ExpiresIn).IsLessThanOrEqualTo(15 * 60);
            await Assert.That(await oauth.ValidateAccessTokenAsync(tokens.AccessToken, Resource)).IsNotNull();
            // Audience: the same token means nothing to another resource.
            await Assert.That(await oauth.ValidateAccessTokenAsync(tokens.AccessToken, "https://app.schuly.test/api")).IsNull();
            // Only hashes are stored.
            await Assert.That(await db.McpTokens.AnyAsync(t => t.TokenHash == tokens.AccessToken)).IsFalse();
            await Assert.That(await db.McpTokens.AnyAsync(t => t.TokenHash == McpSecrets.Hash(tokens.AccessToken))).IsTrue();
        }

        [Test]
        public async Task A_code_used_twice_fails_and_revokes_what_the_first_use_issued()
        {
            var (oauth, _, _, clientId, code, db) = await ApprovedAsync(nameof(A_code_used_twice_fails_and_revokes_what_the_first_use_issued));
            using var _db = db;

            var (first, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);
            var (second, error) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);

            await Assert.That(second).IsNull();
            await Assert.That(error!.Error).IsEqualTo("invalid_grant");
            await Assert.That(await oauth.ValidateAccessTokenAsync(first!.AccessToken, Resource)).IsNull();
            await Assert.That((await oauth.RefreshAsync(clientId, first.RefreshToken, null, null, Resource)).Error).IsNotNull();
        }

        [Test]
        public async Task A_code_with_the_wrong_verifier_redirect_or_client_is_refused()
        {
            var (oauth, _, _, clientId, code, db) = await ApprovedAsync(nameof(A_code_with_the_wrong_verifier_redirect_or_client_is_refused));
            using var _db = db;

            var wrongClient = await oauth.ExchangeCodeAsync("mcp_other", code, Redirect, Verifier, null, Resource);
            await Assert.That(wrongClient.Error!.Error).IsEqualTo("invalid_grant");

            var wrongVerifier = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier[..^1] + "Q", null, Resource);
            await Assert.That(wrongVerifier.Error!.Error).IsEqualTo("invalid_grant");

            // The failed attempt consumed the code, so even the right values no longer work.
            var afterwards = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);
            await Assert.That(afterwards.Response).IsNull();
        }

        [Test]
        public async Task A_code_redeemed_with_a_different_redirect_uri_is_refused()
        {
            var (oauth, _, _, clientId, code, db) = await ApprovedAsync(nameof(A_code_redeemed_with_a_different_redirect_uri_is_refused));
            using var _db = db;

            var (tokens, error) = await oauth.ExchangeCodeAsync(clientId, code, "https://claude.ai/other", Verifier, null, Resource);

            await Assert.That(tokens).IsNull();
            await Assert.That(error!.Error).IsEqualTo("invalid_grant");
        }

        [Test]
        public async Task A_code_expires_after_sixty_seconds()
        {
            var (oauth, time, _, clientId, code, db) = await ApprovedAsync(nameof(A_code_expires_after_sixty_seconds));
            using var _db = db;

            time.Advance(TimeSpan.FromSeconds(61));
            var (tokens, error) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);

            await Assert.That(tokens).IsNull();
            await Assert.That(error!.Description).Contains("expired");
        }

        [Test]
        public async Task Access_tokens_expire()
        {
            var (oauth, time, _, clientId, code, db) = await ApprovedAsync(nameof(Access_tokens_expire));
            using var _db = db;
            var (tokens, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);

            time.Advance(TimeSpan.FromMinutes(16));

            await Assert.That(await oauth.ValidateAccessTokenAsync(tokens!.AccessToken, Resource)).IsNull();
        }

        [Test]
        public async Task Refreshing_rotates_and_a_reused_refresh_token_revokes_the_whole_connection()
        {
            var (oauth, _, _, clientId, code, db) = await ApprovedAsync(nameof(Refreshing_rotates_and_a_reused_refresh_token_revokes_the_whole_connection));
            using var _db = db;
            var (first, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);

            var (second, error) = await oauth.RefreshAsync(clientId, first!.RefreshToken, null, null, Resource);
            await Assert.That(error).IsNull();
            await Assert.That(second!.RefreshToken).IsNotEqualTo(first.RefreshToken);
            await Assert.That(await oauth.ValidateAccessTokenAsync(second.AccessToken, Resource)).IsNotNull();

            var (replayed, replayError) = await oauth.RefreshAsync(clientId, first.RefreshToken, null, null, Resource);
            await Assert.That(replayed).IsNull();
            await Assert.That(replayError!.Error).IsEqualTo("invalid_grant");

            // The legitimate client's newer tokens die with it: the thief and the client cannot be told apart.
            await Assert.That(await oauth.ValidateAccessTokenAsync(second.AccessToken, Resource)).IsNull();
            await Assert.That((await oauth.RefreshAsync(clientId, second.RefreshToken, null, null, Resource)).Error).IsNotNull();
            await Assert.That(await db.McpGrants.AllAsync(g => g.RevokedAt != null)).IsTrue();
        }

        [Test]
        public async Task A_refresh_token_only_works_for_the_client_it_was_issued_to()
        {
            var (oauth, _, _, clientId, code, db) = await ApprovedAsync(nameof(A_refresh_token_only_works_for_the_client_it_was_issued_to));
            using var _db = db;
            var (tokens, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);
            var other = await RegisterAsync(oauth);

            await Assert.That((await oauth.RefreshAsync(other, tokens!.RefreshToken, null, null, Resource)).Error!.Error).IsEqualTo("invalid_grant");
        }

        [Test]
        public async Task Revoking_a_connection_stops_its_tokens_immediately()
        {
            var (oauth, _, userId, clientId, code, db) = await ApprovedAsync(nameof(Revoking_a_connection_stops_its_tokens_immediately));
            using var _db = db;
            var (tokens, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);
            var grant = (await oauth.ListGrantsAsync(userId)).Single();

            await Assert.That(await oauth.RevokeGrantAsync(Guid.NewGuid(), grant.Id)).IsFalse();
            await Assert.That(await oauth.RevokeGrantAsync(userId, grant.Id)).IsTrue();

            await Assert.That(await oauth.ValidateAccessTokenAsync(tokens!.AccessToken, Resource)).IsNull();
            await Assert.That((await oauth.RefreshAsync(clientId, tokens.RefreshToken, null, null, Resource)).Error).IsNotNull();
            await Assert.That(await oauth.ListGrantsAsync(userId)).IsEmpty();
        }

        [Test]
        public async Task Revocation_endpoint_logic_ends_the_connection_for_a_refresh_token()
        {
            var (oauth, _, _, clientId, code, db) = await ApprovedAsync(nameof(Revocation_endpoint_logic_ends_the_connection_for_a_refresh_token));
            using var _db = db;
            var (tokens, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);

            await oauth.RevokeTokenAsync(tokens!.RefreshToken, clientId);

            await Assert.That(await oauth.ValidateAccessTokenAsync(tokens.AccessToken, Resource)).IsNull();
        }

        [Test]
        public async Task A_password_change_or_disabled_account_ends_mcp_access_on_the_next_request()
        {
            var db = TestDb.NewContext(nameof(A_password_change_or_disabled_account_ends_mcp_access_on_the_next_request));
            using var _db = db;
            var (oauth, keys, _) = Services(db);
            var (user, account) = NewUser(db);
            var clientId = await RegisterAsync(oauth);
            var request = Request(clientId, Pkce.ChallengeFor(Verifier));
            var code = await oauth.ApproveAsync(user.Id, request, Resource, McpPermissionSet.ReadOnly());
            var (tokens, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);
            var (key, _) = await keys.CreateAsync(user.Id, "cli", null, null);

            account.SecurityStamp = Guid.NewGuid().ToString("N");
            db.SaveChanges();
            await Assert.That(await oauth.ValidateAccessTokenAsync(tokens!.AccessToken, Resource)).IsNull();
            await Assert.That(await keys.ValidateAsync(key!.Secret)).IsNotNull();

            account.DisabledAt = DateTimeOffset.UtcNow;
            db.SaveChanges();
            await Assert.That(await keys.ValidateAsync(key.Secret)).IsNull();
        }

        [Test]
        public async Task Approval_stores_the_users_choice_not_the_clients_request()
        {
            using var db = TestDb.NewContext(nameof(Approval_stores_the_users_choice_not_the_clients_request));
            var (oauth, _, _) = Services(db);
            var (user, _) = NewUser(db);
            var clientId = await RegisterAsync(oauth);
            var request = Request(clientId, Pkce.ChallengeFor(Verifier), scope: "ms.mail.write schuly.destructive");

            var check = await oauth.CheckAuthorizationRequestAsync(request, Resource);
            await Assert.That(check.Requested.Level(McpArea.Mail)).IsEqualTo(McpAccessLevel.Off);
            await Assert.That(check.Requested.AllowDestructive).IsFalse();

            var chosen = new McpPermissionSet { Areas = { [McpArea.Grades] = McpAccessLevel.Read } };
            var code = await oauth.ApproveAsync(user.Id, request, Resource, chosen);
            var (tokens, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);
            var caller = await oauth.ValidateAccessTokenAsync(tokens!.AccessToken, Resource);

            await Assert.That(tokens.Scope).IsEqualTo("schuly.grades.read");
            await Assert.That(caller!.Permissions.Level(McpArea.Mail)).IsEqualTo(McpAccessLevel.Off);
            await Assert.That(caller.Permissions.AllowDestructive).IsFalse();
        }

        [Test]
        public async Task Editing_a_connections_permissions_applies_to_the_existing_token()
        {
            var (oauth, _, userId, clientId, code, db) = await ApprovedAsync(nameof(Editing_a_connections_permissions_applies_to_the_existing_token));
            using var _db = db;
            var (tokens, _) = await oauth.ExchangeCodeAsync(clientId, code, Redirect, Verifier, null, Resource);
            var grant = (await oauth.ListGrantsAsync(userId)).Single();

            await oauth.UpdateGrantPermissionsAsync(userId, grant.Id, new McpPermissionSet { Areas = { [McpArea.Mail] = McpAccessLevel.ReadWrite } });
            var caller = await oauth.ValidateAccessTokenAsync(tokens!.AccessToken, Resource);

            await Assert.That(caller!.Permissions.Level(McpArea.Mail)).IsEqualTo(McpAccessLevel.ReadWrite);
            await Assert.That(caller.Permissions.Level(McpArea.Grades)).IsEqualTo(McpAccessLevel.Off);
        }

        [Test]
        public async Task Unused_clients_are_swept_after_a_day()
        {
            using var db = TestDb.NewContext(nameof(Unused_clients_are_swept_after_a_day));
            var (oauth, _, _) = Services(db);
            await RegisterAsync(oauth);
            db.McpOAuthClients.Single().CreatedAt = DateTime.UtcNow.AddHours(-25);
            db.SaveChanges();

            await oauth.SweepAsync();

            await Assert.That(await db.McpOAuthClients.AnyAsync()).IsFalse();
        }
    }
}
