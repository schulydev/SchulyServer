using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol;
using Schuly.API.Mcp;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Mcp;
using static Schuly.Tests.Mcp.McpTestSupport;

namespace Schuly.Tests.Mcp
{
    /// <summary>The wire: what /mcp, the metadata and the OAuth endpoints answer, through the real middleware and the official SDK client.</summary>
    public class McpEndpointTests
    {
        private const string ToolsList = """{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}""";
        private const string Initialize = """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}""";

        private static async Task<(McpHttpHost Host, Guid UserId)> HostWithUserAsync(string name)
        {
            var host = await McpHttpHost.StartAsync(name);
            var userId = host.Scoped(sp => NewUser(sp.GetRequiredService<SchulyDbContext>()).User.Id);
            return (host, userId);
        }

        private static McpPermissionSet Only(params (McpArea Area, McpAccessLevel Level)[] areas)
        {
            var set = McpPermissionSet.None();
            foreach (var (area, level) in areas)
                set.Areas[area] = level;
            return set;
        }

        [Test]
        public async Task Every_mcp_request_without_a_credential_is_401_and_points_to_the_resource_metadata()
        {
            await using var host = await McpHttpHost.StartAsync(nameof(Every_mcp_request_without_a_credential_is_401_and_points_to_the_resource_metadata));

            foreach (var body in new[] { ToolsList, Initialize, """{"jsonrpc":"2.0","id":2,"method":"ping"}""" })
            {
                var response = await host.Http.SendAsync(host.Post("/mcp", body));
                await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
                var challenge = response.Headers.WwwAuthenticate.ToString();
                await Assert.That(challenge).Contains("Bearer");
                await Assert.That(challenge).Contains("resource_metadata=\"http://localhost/.well-known/oauth-protected-resource\"");
                // Nothing about the server leaks: no tool names, instructions or version.
                var text = await response.Content.ReadAsStringAsync();
                await Assert.That(text).DoesNotContain("list_grades");
                await Assert.That(text).DoesNotContain("schuly");
            }

            var get = await host.Http.SendAsync(new HttpRequestMessage(HttpMethod.Get, "/mcp"));
            var delete = await host.Http.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/mcp"));
            await Assert.That(get.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
            await Assert.That(delete.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
        }

        [Test]
        public async Task Use_through_an_api_key_counts_as_activity_for_the_inactivity_sweep()
        {
            await using var host = await McpHttpHost.StartAsync(nameof(Use_through_an_api_key_counts_as_activity_for_the_inactivity_sweep), services =>
            {
                services.AddScoped<Schuly.Infrastructure.Services.IOidcService>(_ => new Schuly.Tests.TestHelpers.FakeOidcService("unused"));
                services.AddScoped<Schuly.Infrastructure.Services.IUserService, Schuly.Infrastructure.Services.UserService>();
            });
            var userId = host.Scoped(sp => NewUser(sp.GetRequiredService<SchulyDbContext>()).User.Id);
            var old = DateTime.UtcNow.AddMonths(-11);
            await host.ScopedAsync(async sp =>
            {
                var db = sp.GetRequiredService<SchulyDbContext>();
                (await db.ApplicationUsers.SingleAsync(u => u.Id == userId)).LastSeenAt = old;
                return await db.SaveChangesAsync();
            });
            var key = await host.ApiKeyAsync(userId, McpPermissionSet.ReadOnly());

            await host.Http.SendAsync(host.Post("/mcp", ToolsList, key));

            var lastSeen = host.Scoped(sp => sp.GetRequiredService<SchulyDbContext>().ApplicationUsers.Single(u => u.Id == userId).LastSeenAt);
            await Assert.That(lastSeen > DateTime.UtcNow.AddMinutes(-5)).IsTrue();
        }

        [Test]
        public async Task The_sdk_client_cannot_connect_without_a_credential()
        {
            await using var host = await McpHttpHost.StartAsync(nameof(The_sdk_client_cannot_connect_without_a_credential));

            await Assert.That(async () => await host.ConnectAsync(null)).Throws<Exception>();
        }

        [Test]
        public async Task A_bad_token_an_expired_token_a_revoked_key_and_a_schuly_web_token_are_all_refused()
        {
            var (host, userId) = await HostWithUserAsync(nameof(A_bad_token_an_expired_token_a_revoked_key_and_a_schuly_web_token_are_all_refused));
            await using var _ = host;
            var externalId = host.Scoped(sp => sp.GetRequiredService<SchulyDbContext>().ApplicationUsers.Single().ExternalId);

            var key = await host.ApiKeyAsync(userId, McpPermissionSet.ReadOnly());
            var keyId = host.Scoped(sp => sp.GetRequiredService<SchulyDbContext>().McpApiKeys.Single().Id);
            await host.ScopedAsync(sp => sp.GetRequiredService<McpApiKeyService>().RevokeAsync(userId, keyId));

            var expired = await host.ScopedAsync(sp => sp.GetRequiredService<McpOAuthService>().IssueInternalAccessTokenAsync(userId, McpPermissionSet.ReadOnly(), TimeSpan.FromMinutes(5), "http://localhost/mcp"));
            host.Scoped(sp =>
            {
                var db = sp.GetRequiredService<SchulyDbContext>();
                foreach (var t in db.McpTokens) t.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
                return db.SaveChanges();
            });

            foreach (var bearer in new[] { "nonsense", McpSecrets.ApiKeyPrefix + "guessed", McpSecrets.AccessTokenPrefix + "guessed", key, expired, McpHttpHost.WebToken(externalId) })
            {
                var response = await host.Http.SendAsync(host.Post("/mcp", ToolsList, bearer));
                await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized).Because(bearer[..Math.Min(12, bearer.Length)]);
            }
        }

        [Test]
        public async Task An_mcp_credential_does_nothing_on_api()
        {
            var (host, userId) = await HostWithUserAsync(nameof(An_mcp_credential_does_nothing_on_api));
            await using var _ = host;
            var key = await host.ApiKeyAsync(userId, McpPermissionSet.ReadOnly());
            var externalId = host.Scoped(sp => sp.GetRequiredService<SchulyDbContext>().ApplicationUsers.Single().ExternalId);

            var withKey = new HttpRequestMessage(HttpMethod.Get, "/api/ping");
            withKey.Headers.Authorization = new("Bearer", key);
            var withJwt = new HttpRequestMessage(HttpMethod.Get, "/api/ping");
            withJwt.Headers.Authorization = new("Bearer", McpHttpHost.WebToken(externalId));

            await Assert.That((await host.Http.SendAsync(withKey)).StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
            await Assert.That((await host.Http.SendAsync(withJwt)).StatusCode).IsEqualTo(HttpStatusCode.OK);
        }

        [Test]
        public async Task Tools_list_only_shows_what_the_connection_may_use()
        {
            var (host, userId) = await HostWithUserAsync(nameof(Tools_list_only_shows_what_the_connection_may_use));
            await using var _ = host;
            var key = await host.ApiKeyAsync(userId, Only((McpArea.Grades, McpAccessLevel.Read), (McpArea.Mail, McpAccessLevel.Read)));

            await using var client = await host.ConnectAsync(key);
            var names = (await client.ListToolsAsync()).Select(t => t.Name).ToList();

            await Assert.That(names).Contains("list_grades");
            await Assert.That(names).Contains("read_mail");
            await Assert.That(names).DoesNotContain("send_mail");
            await Assert.That(names).DoesNotContain("delete_mail");
            await Assert.That(names).DoesNotContain("list_absences");
            await Assert.That(names).DoesNotContain("list_documents");
            await Assert.That(names).DoesNotContain("list_chats");
        }

        [Test]
        public async Task Write_tools_carry_the_destructive_hint_and_read_tools_the_read_only_hint()
        {
            var (host, userId) = await HostWithUserAsync(nameof(Write_tools_carry_the_destructive_hint_and_read_tools_the_read_only_hint));
            await using var _ = host;
            var full = McpPermissionSet.ReadOnly();
            foreach (var area in McpScopes.WritableAreas) full.Areas[area] = McpAccessLevel.ReadWrite;
            full.AllowDestructive = true;
            var key = await host.ApiKeyAsync(userId, full);

            await using var client = await host.ConnectAsync(key);
            var tools = (await client.ListToolsAsync()).ToDictionary(t => t.Name, t => t.ProtocolTool);

            foreach (var name in new[] { "send_mail", "report_absence", "delete_mail", "withdraw_absence_report", "send_chat_message" })
                await Assert.That(tools[name].Annotations?.DestructiveHint == true).IsTrue().Because(name);
            foreach (var name in new[] { "list_grades", "read_mail", "list_drive_items", "read_document" })
                await Assert.That(tools[name].Annotations?.ReadOnlyHint == true).IsTrue().Because(name);
            await Assert.That(tools["list_grades"].InputSchema.GetRawText()).Contains("subject");
        }

        [Test]
        public async Task A_denied_tool_call_is_rejected_and_logged_while_an_allowed_one_runs()
        {
            var (host, userId) = await HostWithUserAsync(nameof(A_denied_tool_call_is_rejected_and_logged_while_an_allowed_one_runs));
            await using var _ = host;
            var key = await host.ApiKeyAsync(userId, Only((McpArea.Grades, McpAccessLevel.Read)));

            await using var client = await host.ConnectAsync(key);
            var allowed = await client.CallToolAsync("list_grades", new Dictionary<string, object?>());
            await Assert.That(allowed.IsError ?? false).IsFalse();
            var allowedText = JsonDocument.Parse(((ModelContextProtocol.Protocol.TextContentBlock)allowed.Content[0]).Text).RootElement;
            await Assert.That(allowedText.TryGetProperty("subjectAverages", out var _)).IsTrue();

            string? deniedMessage = null;
            try
            {
                await client.CallToolAsync("send_mail", new Dictionary<string, object?> { ["to"] = new[] { "a@b.c" }, ["subject"] = "s", ["body"] = "b" });
            }
            catch (McpException ex)
            {
                deniedMessage = ex.Message;
            }
            await Assert.That(deniedMessage).IsNotNull();
            await Assert.That(deniedMessage!).Contains("not allowed to use send_mail");
            await Assert.That(deniedMessage!).Contains("Mail read and write");

            var log = host.Scoped(sp => sp.GetRequiredService<SchulyDbContext>().McpActivities.OrderBy(a => a.CreatedAt).Select(a => new { a.ToolName, a.Allowed }).ToList());
            await Assert.That(log.Any(a => a.ToolName == "list_grades" && a.Allowed)).IsTrue();
            await Assert.That(log.Any(a => a.ToolName == "send_mail" && !a.Allowed)).IsTrue();
        }

        [Test]
        public async Task Editing_permissions_changes_the_tool_list_on_the_next_request()
        {
            var (host, userId) = await HostWithUserAsync(nameof(Editing_permissions_changes_the_tool_list_on_the_next_request));
            await using var _ = host;
            var key = await host.ApiKeyAsync(userId, Only((McpArea.Grades, McpAccessLevel.Read)));
            var keyId = host.Scoped(sp => sp.GetRequiredService<SchulyDbContext>().McpApiKeys.Single().Id);
            await using var client = await host.ConnectAsync(key);

            await Assert.That((await client.ListToolsAsync()).Select(t => t.Name)).DoesNotContain("list_absences");

            await host.ScopedAsync(sp => sp.GetRequiredService<McpApiKeyService>().UpdatePermissionsAsync(userId, keyId, Only((McpArea.Absences, McpAccessLevel.Read))));
            var after = (await client.ListToolsAsync()).Select(t => t.Name).ToList();

            await Assert.That(after).Contains("list_absences");
            await Assert.That(after).DoesNotContain("list_grades");
        }

        [Test]
        public async Task A_session_id_from_one_caller_gives_another_nothing()
        {
            var (host, userId) = await HostWithUserAsync(nameof(A_session_id_from_one_caller_gives_another_nothing));
            await using var _ = host;
            var key = await host.ApiKeyAsync(userId, McpPermissionSet.ReadOnly());

            // The server is stateless: it issues no session id, so there is nothing to steal.
            var init = await host.Http.SendAsync(host.Post("/mcp", Initialize, key));
            await Assert.That(init.StatusCode).IsEqualTo(HttpStatusCode.OK);
            await Assert.That(init.Headers.Contains("Mcp-Session-Id")).IsFalse();

            // A made-up or replayed session id with another (invalid) credential is still just an unauthenticated request.
            var hijack = host.Post("/mcp", ToolsList, "schuly_mcp_someone-elses-guess");
            hijack.Headers.Add("Mcp-Session-Id", "2f1c6a7e9b2d4c0f8e3a5b7c9d1e3f50");
            await Assert.That((await host.Http.SendAsync(hijack)).StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);

            var noToken = host.Post("/mcp", ToolsList);
            noToken.Headers.Add("Mcp-Session-Id", "2f1c6a7e9b2d4c0f8e3a5b7c9d1e3f50");
            await Assert.That((await host.Http.SendAsync(noToken)).StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
        }

        [Test]
        public async Task A_foreign_browser_origin_is_refused()
        {
            var (host, userId) = await HostWithUserAsync(nameof(A_foreign_browser_origin_is_refused));
            await using var _ = host;
            var key = await host.ApiKeyAsync(userId, McpPermissionSet.ReadOnly());

            var foreign = host.Post("/mcp", ToolsList, key);
            foreign.Headers.Add("Origin", "https://evil.example");
            var own = host.Post("/mcp", Initialize, key);
            own.Headers.Add("Origin", "http://localhost");

            await Assert.That((await host.Http.SendAsync(foreign)).StatusCode).IsEqualTo(HttpStatusCode.Forbidden);
            await Assert.That((await host.Http.SendAsync(own)).StatusCode).IsEqualTo(HttpStatusCode.OK);
        }

        [Test]
        public async Task Repeated_bad_credentials_lock_the_ip_out()
        {
            await using var host = await McpHttpHost.StartAsync(nameof(Repeated_bad_credentials_lock_the_ip_out));

            HttpStatusCode last = default;
            for (var i = 0; i < 21; i++)
                last = (await host.Http.SendAsync(host.Post("/mcp", ToolsList, McpSecrets.ApiKeyPrefix + "guess" + i))).StatusCode;

            await Assert.That(last).IsEqualTo(HttpStatusCode.TooManyRequests);
        }

        [Test]
        public async Task The_metadata_documents_describe_the_resource_and_the_authorization_server()
        {
            await using var host = await McpHttpHost.StartAsync(nameof(The_metadata_documents_describe_the_resource_and_the_authorization_server));

            var prm = JsonDocument.Parse(await host.Http.GetStringAsync("/.well-known/oauth-protected-resource")).RootElement;
            var prmInserted = JsonDocument.Parse(await host.Http.GetStringAsync("/.well-known/oauth-protected-resource/mcp")).RootElement;
            var asm = JsonDocument.Parse(await host.Http.GetStringAsync("/.well-known/oauth-authorization-server")).RootElement;

            await Assert.That(prm.GetProperty("resource").GetString()).IsEqualTo("http://localhost/mcp");
            await Assert.That(prm.GetProperty("authorization_servers")[0].GetString()).IsEqualTo("http://localhost");
            await Assert.That(prmInserted.GetProperty("resource").GetString()).IsEqualTo("http://localhost/mcp");
            await Assert.That(asm.GetProperty("issuer").GetString()).IsEqualTo("http://localhost");
            await Assert.That(asm.GetProperty("code_challenge_methods_supported").EnumerateArray().Select(e => e.GetString()!).ToList()).IsEquivalentTo(new[] { "S256" });
            await Assert.That(asm.GetProperty("registration_endpoint").GetString()).IsEqualTo("http://localhost/oauth/register");
        }

        [Test]
        public async Task The_full_oauth_flow_works_over_http_and_the_token_reaches_the_tools()
        {
            var (host, userId) = await HostWithUserAsync(nameof(The_full_oauth_flow_works_over_http_and_the_token_reaches_the_tools));
            await using var _ = host;

            var register = await host.Http.PostAsync("/oauth/register", new StringContent("""{"redirect_uris":["http://127.0.0.1:4567/callback"],"client_name":"Inspector","token_endpoint_auth_method":"none"}""", System.Text.Encoding.UTF8, "application/json"));
            await Assert.That(register.StatusCode).IsEqualTo(HttpStatusCode.Created);
            var clientId = JsonDocument.Parse(await register.Content.ReadAsStringAsync()).RootElement.GetProperty("client_id").GetString()!;

            // The authorize endpoint only forwards to the consent page; the loopback port may differ from the registered one.
            var challenge = Pkce.ChallengeFor(Verifier);
            var authorizeUrl = $"/oauth/authorize?response_type=code&client_id={clientId}&redirect_uri={Uri.EscapeDataString("http://127.0.0.1:9999/callback")}&state=xyz&code_challenge={challenge}&code_challenge_method=S256&resource={Uri.EscapeDataString("http://localhost/mcp")}";
            var authorize = await host.Http.GetAsync(authorizeUrl);
            await Assert.That(authorize.StatusCode).IsEqualTo(HttpStatusCode.Redirect);
            await Assert.That(authorize.Headers.Location!.ToString()).StartsWith("/connect/authorize?");

            var plain = await host.Http.GetAsync(authorizeUrl.Replace("S256", "plain"));
            await Assert.That(plain.Headers.Location!.ToString()).StartsWith("http://127.0.0.1:9999/callback?error=invalid_request");
            await Assert.That(plain.Headers.Location!.ToString()).Contains("state=xyz");

            var request = new AuthorizationRequest("code", clientId, "http://127.0.0.1:9999/callback", null, "xyz", challenge, "S256", "http://localhost/mcp");
            var code = await host.ScopedAsync(sp => sp.GetRequiredService<McpOAuthService>().ApproveAsync(userId, request, "http://localhost/mcp", McpPermissionSet.ReadOnly()));

            var form = new Dictionary<string, string> { ["grant_type"] = "authorization_code", ["code"] = code, ["redirect_uri"] = "http://127.0.0.1:9999/callback", ["client_id"] = clientId, ["code_verifier"] = Verifier, ["resource"] = "http://localhost/mcp" };
            var token = await host.Http.PostAsync("/oauth/token", new FormUrlEncodedContent(form));
            await Assert.That(token.StatusCode).IsEqualTo(HttpStatusCode.OK);
            await Assert.That(token.Headers.CacheControl!.NoStore).IsTrue();
            var accessToken = JsonDocument.Parse(await token.Content.ReadAsStringAsync()).RootElement.GetProperty("access_token").GetString()!;

            var replay = await host.Http.PostAsync("/oauth/token", new FormUrlEncodedContent(form));
            await Assert.That(replay.StatusCode).IsEqualTo(HttpStatusCode.BadRequest);
            await Assert.That(await replay.Content.ReadAsStringAsync()).Contains("invalid_grant");

            // The replay revoked what the first exchange issued.
            var afterReplay = await host.Http.SendAsync(host.Post("/mcp", ToolsList, accessToken));
            await Assert.That(afterReplay.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
        }

        [Test]
        public async Task An_internal_token_for_helply_works_through_the_official_client_with_its_own_permissions()
        {
            var (host, userId) = await HostWithUserAsync(nameof(An_internal_token_for_helply_works_through_the_official_client_with_its_own_permissions));
            await using var _ = host;

            var (token, endpoint) = await host.ScopedAsync(sp => sp.GetRequiredService<McpInternalTokens>().IssueAsync(userId, Only((McpArea.Exams, McpAccessLevel.Read))));
            await using var client = await host.ConnectAsync(token);
            var names = (await client.ListToolsAsync()).Select(t => t.Name).ToList();

            await Assert.That(endpoint.ToString()).IsEqualTo("http://localhost/mcp");
            await Assert.That(names).IsEquivalentTo(new[] { "list_exams" });
            // Internal tokens never show up as a connected app.
            await Assert.That(await host.ScopedAsync(sp => sp.GetRequiredService<McpOAuthService>().ListGrantsAsync(userId))).IsEmpty();
        }
    }
}
