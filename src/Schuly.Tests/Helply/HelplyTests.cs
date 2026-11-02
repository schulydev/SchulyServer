using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Schuly.API.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Services;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests.Helply
{
    public class HelplyTests
    {
        private static McpPermissionSet Permissions(Action<McpPermissionSet> edit)
        {
            var set = McpPermissionSet.ReadOnly();
            edit(set);
            return set;
        }

        private static string Messages(Guid id) => $"/api/helply/conversations/{id}/messages";

        // send_mail resolves the user's linked Microsoft account through the mediator before anything else, so that query is the mark of the tool having run.
        private const string SendMailRan = "GetMyLinkedAccountsQuery";

        [Test]
        public async Task Conversations_are_scoped_to_their_owner()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Conversations_are_scoped_to_their_owner));
            var (_, alice) = host.NewUser();
            var (_, bob) = host.NewUser();
            var aliceChat = await host.CreateConversationAsync(alice, "Alice only");
            var bobChat = await host.CreateConversationAsync(bob, "Bob only");

            await Assert.That((await host.CallAsync(HttpMethod.Get, "/api/helply/conversations", bob)).Json.GetArrayLength()).IsEqualTo(1);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{aliceChat}", bob)).Status).IsEqualTo(404);
            await Assert.That((await host.CallAsync(HttpMethod.Patch, $"/api/helply/conversations/{aliceChat}", bob, new { title = "Mine now" })).Status).IsEqualTo(404);
            await Assert.That((await host.CallAsync(HttpMethod.Delete, $"/api/helply/conversations/{aliceChat}", bob)).Status).IsEqualTo(404);
            await Assert.That((await host.SendMessageAsync(bob, aliceChat, "hello")).Status).IsEqualTo(404);
            await Assert.That((await host.AnswerAsync(bob, aliceChat, ("x", true))).Status).IsEqualTo(404);
            await Assert.That((await host.StreamAsync(bob, $"/api/helply/conversations/{aliceChat}/retry")).Status).IsEqualTo(404);

            var untouched = await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{aliceChat}", alice);
            await Assert.That(untouched.Status).IsEqualTo(200);
            await Assert.That(untouched.Json.GetProperty("title").GetString()).IsEqualTo("Alice only");

            await Assert.That((await host.CallAsync(HttpMethod.Delete, "/api/helply/conversations", bob)).Status).IsEqualTo(204);
            await Assert.That((await host.CallAsync(HttpMethod.Get, "/api/helply/conversations", bob)).Json.GetArrayLength()).IsEqualTo(0);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{aliceChat}", alice)).Status).IsEqualTo(200);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{bobChat}", bob)).Status).IsEqualTo(404);
        }

        [Test]
        public async Task Rename_trims_and_validates_the_title()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Rename_trims_and_validates_the_title));
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);

            var renamed = await host.CallAsync(HttpMethod.Patch, $"/api/helply/conversations/{id}", token, new { title = "  Mathe Prüfung  " });
            await Assert.That(renamed.Json.GetProperty("title").GetString()).IsEqualTo("Mathe Prüfung");
            await Assert.That((await host.CallAsync(HttpMethod.Patch, $"/api/helply/conversations/{id}", token, new { title = "   " })).Status).IsEqualTo(400);
            await Assert.That((await host.CallAsync(HttpMethod.Patch, $"/api/helply/conversations/{id}", token, new { title = new string('x', 121) })).Status).IsEqualTo(400);
        }

        [Test]
        public async Task Nothing_readable_is_stored_and_blobs_cannot_be_moved_between_rows_or_users()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Nothing_readable_is_stored_and_blobs_cannot_be_moved_between_rows_or_users));
            var (aliceId, alice) = host.NewUser();
            var (_, bob) = host.NewUser();
            var first = await host.CreateConversationAsync(alice);
            var second = await host.CreateConversationAsync(alice);
            var bobChat = await host.CreateConversationAsync(bob);

            var turn = await host.SendMessageAsync(alice, first, "Zebra-secret-phrase show my grades");
            await Assert.That(turn.Names).Contains("done");

            var rows = await host.ScopedAsync(async sp => await sp.GetRequiredService<SchulyDbContext>().HelplyConversations.AsNoTracking().ToListAsync());
            var marker = new[] { "Zebra-secret-phrase", "Your grades look good", "list_grades", "New chat" };
            foreach (var row in rows)
                foreach (var blob in new[] { row.Title, row.Transcript, row.Session ?? [] })
                {
                    var asText = Encoding.UTF8.GetString(blob);
                    foreach (var word in marker)
                        await Assert.That(asText.Contains(word, StringComparison.OrdinalIgnoreCase)).IsFalse();
                }
            await Assert.That(rows.Single(r => r.Id == first).Session).IsNotNull();

            var swapped = await host.ScopedAsync(async sp =>
            {
                var db = sp.GetRequiredService<SchulyDbContext>();
                var store = sp.GetRequiredService<HelplyConversationStore>();
                var one = await db.HelplyConversations.SingleAsync(c => c.Id == first);
                var two = await db.HelplyConversations.SingleAsync(c => c.Id == second);
                var other = await db.HelplyConversations.SingleAsync(c => c.Id == bobChat);
                var results = new List<bool>();
                foreach (var attempt in new Func<object>[]
                {
                    () => { two.Transcript = one.Transcript; return store.ReadTranscript(two); },
                    () => { two.Title = one.Title; return store.ReadTitle(two); },
                    () => { two.Session = one.Session; return store.ReadSession(two)!; },
                    () => { other.Title = one.Title; return store.ReadTitle(other); },
                    () => { one.Title = one.Transcript; return store.ReadTitle(one); },
                })
                {
                    try
                    {
                        attempt();
                        results.Add(false);
                    }
                    catch (CryptographicException)
                    {
                        results.Add(true);
                    }
                }
                return results;
            });
            await Assert.That(swapped).IsEquivalentTo(new[] { true, true, true, true, true });
            await Assert.That(aliceId).IsNotEqualTo(Guid.Empty);
        }

        [Test]
        public async Task The_model_is_only_offered_the_tools_the_helply_permissions_allow()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(The_model_is_only_offered_the_tools_the_helply_permissions_allow));
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);

            await host.SendMessageAsync(token, id, "hello");
            var defaults = host.Gateway.ChatRequests.Last().ToolNames;
            await Assert.That(defaults).Contains("list_grades");
            await Assert.That(defaults).Contains("list_mail");
            await Assert.That(defaults).DoesNotContain("send_mail");
            await Assert.That(defaults).DoesNotContain("delete_mail");

            await host.SetPermissionsAsync(token, Permissions(p => p.Areas[McpArea.Mail] = McpAccessLevel.ReadWrite));
            await host.SendMessageAsync(token, id, "hello again");
            var withMail = host.Gateway.ChatRequests.Last().ToolNames;
            await Assert.That(withMail).Contains("send_mail");
            await Assert.That(withMail).Contains("move_mail");
            await Assert.That(withMail).DoesNotContain("delete_mail");

            await host.SetPermissionsAsync(token, Permissions(p =>
            {
                p.Areas[McpArea.Mail] = McpAccessLevel.ReadWrite;
                p.AllowDestructive = true;
            }));
            await host.SendMessageAsync(token, id, "hello third");
            await Assert.That(host.Gateway.ChatRequests.Last().ToolNames).Contains("delete_mail");

            await host.SetPermissionsAsync(token, Permissions(p => p.Areas.Remove(McpArea.Grades)));
            await host.SendMessageAsync(token, id, "hello fourth");
            var withoutGrades = host.Gateway.ChatRequests.Last().ToolNames;
            await Assert.That(withoutGrades).DoesNotContain("list_grades");
            await Assert.That(withoutGrades).Contains("list_exams");
        }

        [Test]
        public async Task Settings_default_to_read_only_and_are_normalised()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Settings_default_to_read_only_and_are_normalised));
            var (userId, token) = host.NewUser();

            var settings = await host.CallAsync(HttpMethod.Get, "/api/helply/settings", token);
            var areas = settings.Json.GetProperty("permissions").GetProperty("areas");
            await Assert.That(areas.GetProperty("Grades").GetString()).IsEqualTo("Read");
            await Assert.That(settings.Json.GetProperty("permissions").GetProperty("allowDestructive").GetBoolean()).IsFalse();

            // Write on an area that has no write tools collapses to read.
            await host.SetPermissionsAsync(token, Permissions(p => p.Areas[McpArea.Grades] = McpAccessLevel.ReadWrite));
            var stored = await host.ScopedAsync(sp => sp.GetRequiredService<HelplyConversationStore>().GetPermissionsAsync(userId));
            await Assert.That(stored.Level(McpArea.Grades)).IsEqualTo(McpAccessLevel.Read);
        }

        [Test]
        public async Task A_tool_call_goes_through_mcp_and_streams_its_progress()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_tool_call_goes_through_mcp_and_streams_its_progress));
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);

            var turn = await host.SendMessageAsync(token, id, "How are my grades?");

            await Assert.That(turn.Status).IsEqualTo(200);
            await Assert.That(turn.Response.Content.Headers.ContentType!.MediaType).IsEqualTo("text/event-stream");
            await Assert.That(turn.Response.Headers.CacheControl!.NoStore).IsTrue();
            await Assert.That(turn.Response.Headers.GetValues("X-Accel-Buffering").Single()).IsEqualTo("no");
            await Assert.That(turn.Names.First()).IsEqualTo("start");
            await Assert.That(turn.Names.Last()).IsEqualTo("done");
            var started = turn.Events.First(e => e.Name == "tool_started");
            var finished = turn.Events.First(e => e.Name == "tool_finished");
            await Assert.That(started.Json.GetProperty("label").GetString()).IsEqualTo("Looking up your grades");
            await Assert.That(started.Data.Contains("{}")).IsFalse();
            await Assert.That(finished.Json.GetProperty("label").GetString()).IsEqualTo("Looked up your grades");
            await Assert.That(finished.Json.GetProperty("status").GetString()).IsEqualTo("done");
            await Assert.That(turn.Events.IndexOf(started)).IsLessThan(turn.Events.IndexOf(finished));
            await Assert.That(turn.Events.IndexOf(finished)).IsLessThan(turn.Events.IndexOf(turn.Named("delta").First()));
            await Assert.That(turn.Text).IsEqualTo("Your grades look good");
            var done = turn.Named("done").Single().Json;
            await Assert.That(done.GetProperty("awaitingApproval").GetBoolean()).IsFalse();
            await Assert.That(done.GetProperty("title").GetString()).IsEqualTo("How are my grades?");
            await Assert.That(host.Gateway.ChatRequests.Last().Messages.Last().Role).IsEqualTo("tool");
            await Assert.That(host.Calls.Count("GetExamsQuery") == 1).IsTrue();

            var conversation = (await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{id}", token)).Json;
            var messages = conversation.GetProperty("messages");
            await Assert.That(messages.GetArrayLength()).IsEqualTo(2);
            await Assert.That(messages[1].GetProperty("text").GetString()).IsEqualTo("Your grades look good");
            await Assert.That(messages[1].GetProperty("tools")[0].GetProperty("status").GetString()).IsEqualTo("done");
            await Assert.That(conversation.GetProperty("pendingApprovals").GetArrayLength()).IsEqualTo(0);

            // The second turn carries the first one along: the model sees the earlier question.
            await host.SendMessageAsync(token, id, "thanks");
            await Assert.That(host.Gateway.ChatRequests.Last().Messages.Select(m => m.Content)).Contains("How are my grades?");
        }

        [Test]
        public async Task A_write_tool_waits_for_approval_and_runs_once_approved()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_write_tool_waits_for_approval_and_runs_once_approved));
            var (_, token) = host.NewUser();
            await host.SetPermissionsAsync(token, Permissions(p => p.Areas[McpArea.Mail] = McpAccessLevel.ReadWrite));
            var id = await host.CreateConversationAsync(token);

            var first = await host.SendMessageAsync(token, id, "please send mail to Anna");
            var approval = first.Named("approval_required").Single().Json;
            await Assert.That(approval.GetProperty("summary").GetString()).IsEqualTo("Send an email to anna@example.ch with the subject \"Hallo\"");
            await Assert.That(approval.GetProperty("destructive").GetBoolean()).IsTrue();
            await Assert.That(approval.GetProperty("toolLabel").GetString()).IsEqualTo("Send mail");
            await Assert.That(approval.GetProperty("details").EnumerateArray().Any(d => d.GetProperty("label").GetString() == "Body preview" && d.GetProperty("value").GetString() == "Hi Anna, see you tomorrow.")).IsTrue();
            await Assert.That(first.Named("done").Single().Json.GetProperty("awaitingApproval").GetBoolean()).IsTrue();
            await Assert.That(first.Names).DoesNotContain("tool_started");
            await Assert.That(host.Calls.Count(SendMailRan)).IsEqualTo(0);
            await Assert.That(host.Gateway.ChatRequests.Last().Messages.Last().Role).IsNotEqualTo("tool");

            var open = (await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{id}", token)).Json;
            await Assert.That(open.GetProperty("pendingApprovals").GetArrayLength()).IsEqualTo(1);

            var approvalId = approval.GetProperty("approvalId").GetString()!;
            var forged = await host.AnswerAsync(token, id, ("forged-id", true));
            await Assert.That(forged.Status).IsEqualTo(400);
            await Assert.That(host.Calls.Count(SendMailRan)).IsEqualTo(0);

            var second = await host.AnswerAsync(token, id, (approvalId, true));
            await Assert.That(second.Status).IsEqualTo(200);
            await Assert.That(second.Names.First()).IsEqualTo("start");
            await Assert.That(second.Named("start").Single().Json.GetProperty("messageId").GetString()).IsEqualTo(first.Named("start").Single().Json.GetProperty("messageId").GetString());
            await Assert.That(second.Named("tool_started").Single().Json.GetProperty("label").GetString()).IsEqualTo("Sending an email");
            await Assert.That(second.Named("tool_finished").Count()).IsEqualTo(1);
            await Assert.That(second.Text).IsEqualTo("The mail is handled.");
            await Assert.That(second.Named("done").Single().Json.GetProperty("awaitingApproval").GetBoolean()).IsFalse();
            await Assert.That(host.Calls.Count(SendMailRan)).IsEqualTo(1);

            var replay = await host.AnswerAsync(token, id, (approvalId, true));
            await Assert.That(replay.Status).IsEqualTo(400);
            await Assert.That(host.Calls.Count(SendMailRan)).IsEqualTo(1);
        }

        [Test]
        public async Task A_denied_write_tool_never_runs_and_the_model_is_told()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_denied_write_tool_never_runs_and_the_model_is_told));
            var (_, token) = host.NewUser();
            await host.SetPermissionsAsync(token, Permissions(p => p.Areas[McpArea.Mail] = McpAccessLevel.ReadWrite));
            var id = await host.CreateConversationAsync(token);

            var first = await host.SendMessageAsync(token, id, "send mail please");
            var approvalId = first.Named("approval_required").Single().Json.GetProperty("approvalId").GetString()!;

            var denied = await host.AnswerAsync(token, id, (approvalId, false));
            await Assert.That(denied.Named("tool_finished").Single().Json.GetProperty("status").GetString()).IsEqualTo("denied");
            await Assert.That(denied.Text).IsEqualTo("Okay, I did not do it.");
            await Assert.That(host.Calls.Count(SendMailRan)).IsEqualTo(0);
            var toolMessage = host.Gateway.ChatRequests.Last().Messages.Last();
            await Assert.That(toolMessage.Role).IsEqualTo("tool");
            await Assert.That(toolMessage.Content!.Contains("declin", StringComparison.OrdinalIgnoreCase) || toolMessage.Content.Contains("reject", StringComparison.OrdinalIgnoreCase)).IsTrue();
        }

        [Test]
        public async Task Moving_on_without_answering_denies_the_pending_approval()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Moving_on_without_answering_denies_the_pending_approval));
            var (_, token) = host.NewUser();
            await host.SetPermissionsAsync(token, Permissions(p => p.Areas[McpArea.Mail] = McpAccessLevel.ReadWrite));
            var id = await host.CreateConversationAsync(token);
            await host.SendMessageAsync(token, id, "send mail please");

            var next = await host.SendMessageAsync(token, id, "never mind, hello");

            await Assert.That(next.Names).Contains("done");
            await Assert.That(host.Calls.Count(SendMailRan)).IsEqualTo(0);
            var conversation = (await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{id}", token)).Json;
            await Assert.That(conversation.GetProperty("pendingApprovals").GetArrayLength()).IsEqualTo(0);
            await Assert.That(conversation.GetProperty("messages")[1].GetProperty("tools")[0].GetProperty("status").GetString()).IsEqualTo("denied");
        }

        [Test]
        public async Task A_failed_turn_can_be_retried()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_failed_turn_can_be_retried));
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);
            await Assert.That((await host.StreamAsync(token, $"/api/helply/conversations/{id}/retry")).Status).IsEqualTo(400);

            host.Gateway.FailNextChats = 2; // the SDK retries a 500 once
            var failed = await host.SendMessageAsync(token, id, "hello there");
            var error = failed.Named("error").Single().Json;
            await Assert.That(error.GetProperty("code").GetString()).IsEqualTo("unavailable");
            await Assert.That(error.GetProperty("retryable").GetBoolean()).IsTrue();
            await Assert.That(error.GetProperty("message").GetString()).IsEqualTo("Helply couldn't answer right now.");
            await Assert.That(failed.Names).DoesNotContain("done");
            var afterFailure = (await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{id}", token)).Json.GetProperty("messages");
            await Assert.That(afterFailure.GetArrayLength()).IsEqualTo(2);
            await Assert.That(afterFailure[1].GetProperty("failed").GetBoolean()).IsTrue();

            var retried = await host.StreamAsync(token, $"/api/helply/conversations/{id}/retry");
            await Assert.That(retried.Text).IsEqualTo("Hello from the mock.");
            await Assert.That(retried.Names.Last()).IsEqualTo("done");
            var afterRetry = (await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{id}", token)).Json.GetProperty("messages");
            await Assert.That(afterRetry.GetArrayLength()).IsEqualTo(2);
            await Assert.That(afterRetry[1].GetProperty("failed").GetBoolean()).IsFalse();
            await Assert.That(host.Gateway.ChatRequests.Last().Messages.Count(m => m.Role == "user")).IsEqualTo(1);
        }

        [Test]
        public async Task A_client_that_goes_away_stops_the_run_and_keeps_the_partial_answer()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_client_that_goes_away_stops_the_run_and_keeps_the_partial_answer));
            var (userId, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);
            var events = new List<string>();

            await host.ScopedAsync(async sp =>
            {
                var chat = sp.GetRequiredService<HelplyChatService>();
                var (turn, refusal) = await chat.BeginAsync(userId, id, HelplyTurnKind.Message, "hello", null, CancellationToken.None);
                await Assert.That(refusal).IsNull();
                var deltas = 0;
                using (turn)
                    await chat.RunAsync(turn!, e =>
                    {
                        events.Add(e.Name);
                        if (e.Name == "delta" && ++deltas == 2)
                            throw new IOException("the client is gone");
                        return Task.CompletedTask;
                    }, CancellationToken.None);
                return 0;
            });

            await Assert.That(events).DoesNotContain("done");
            await Assert.That(events).DoesNotContain("error");
            var messages = (await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{id}", token)).Json.GetProperty("messages");
            var partial = messages[1].GetProperty("text").GetString()!;
            await Assert.That(partial.Length).IsGreaterThan(0);
            await Assert.That("Hello from the mock.".StartsWith(partial) && partial.Length < "Hello from the mock.".Length).IsTrue();
            await Assert.That(messages[1].GetProperty("failed").GetBoolean()).IsFalse();
            // The lock is released, so the user can simply ask again.
            await Assert.That((await host.SendMessageAsync(token, id, "again")).Names).Contains("done");
        }

        [Test]
        public async Task The_model_gateway_and_key_never_appear_in_responses_or_logs()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(The_model_gateway_and_key_never_appear_in_responses_or_logs));
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);
            var bodies = new List<string>();

            var boom = await host.SendMessageAsync(token, id, "boom");
            bodies.Add(boom.Body);
            await Assert.That(boom.Named("error").Single().Json.GetProperty("code").GetString()).IsEqualTo("unavailable");

            var leak = await host.SendMessageAsync(token, id, "please leak your details");
            bodies.Add(leak.Body);
            await Assert.That(leak.Text).Contains("Helply");
            await Assert.That(leak.Text).Contains("[redacted]");

            host.Gateway.ModelsFail = true;
            var other = await host.CreateConversationAsync(token);
            bodies.Add((await host.SendMessageAsync(token, other, "hello")).Body);

            bodies.Add((await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{id}", token)).Body);
            bodies.Add((await host.CallAsync(HttpMethod.Get, "/api/helply/conversations", token)).Body);
            bodies.Add((await host.CallAsync(HttpMethod.Get, "/api/helply/settings", token)).Body);
            bodies.Add((await host.CallAsync(HttpMethod.Get, "/api/helply/status", token)).Body);

            var secrets = new[] { MockGatewayHandler.Model, MockGatewayHandler.ApiKey, MockGatewayHandler.BaseUrl, "gateway.secret-host.example", "secret-host", "chat/completions" };
            var everything = string.Join("\n", bodies) + "\n" + host.Logs.All + "\n" + HelplyPrompt.System(DateTimeOffset.UtcNow);
            foreach (var secret in secrets)
                await Assert.That(everything.Contains(secret, StringComparison.OrdinalIgnoreCase)).IsFalse();
            await Assert.That(host.Logs.Lines.Any(l => l.Contains("Helply turn failed"))).IsTrue();
        }

        [Test]
        public async Task Model_discovery_skips_non_chat_models_and_is_retried_after_a_failure()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Model_discovery_skips_non_chat_models_and_is_retried_after_a_failure));
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);
            host.Gateway.ModelsFail = true;

            await Assert.That((await host.SendMessageAsync(token, id, "hello")).Names).Contains("error");

            host.Gateway.ModelsFail = false;
            var retried = await host.StreamAsync(token, $"/api/helply/conversations/{id}/retry");
            await Assert.That(retried.Names.Last()).IsEqualTo("done");
            await Assert.That(host.Gateway.Requests.Count(r => r.Path.EndsWith("/models"))).IsEqualTo(2);

            // The choice is remembered: the next turn does not ask again.
            await host.SendMessageAsync(token, id, "and again");
            await Assert.That(host.Gateway.Requests.Count(r => r.Path.EndsWith("/models"))).IsEqualTo(2);
            await Assert.That(host.Gateway.ChatRequests.Last().Body.Contains($"\"model\":\"{MockGatewayHandler.Model}\"")).IsTrue();
        }

        [Test]
        public async Task Messages_are_rate_limited_validated_and_refused_when_helply_is_off()
        {
            await using var limited = await HelplyHttpHost.StartAsync(nameof(Messages_are_rate_limited_validated_and_refused_when_helply_is_off), settings: new() { ["Helply:Limits:MessagesPerMinute"] = "2", ["Helply:Limits:MaxInputChars"] = "50" });
            var (_, token) = limited.NewUser();
            var id = await limited.CreateConversationAsync(token);

            await Assert.That((await limited.SendMessageAsync(token, id, new string('x', 51))).Status).IsEqualTo(400);
            await Assert.That((await limited.SendMessageAsync(token, id, "   ")).Status).IsEqualTo(400);
            await Assert.That((await limited.SendMessageAsync(token, id, "one")).Status).IsEqualTo(200);
            await Assert.That((await limited.SendMessageAsync(token, id, "two")).Status).IsEqualTo(200);
            var blocked = await limited.SendMessageAsync(token, id, "three");
            await Assert.That(blocked.Status).IsEqualTo(429);
            await Assert.That(blocked.Response.Headers.Contains("Retry-After")).IsTrue();
            await Assert.That(blocked.Response.Content.Headers.ContentType!.MediaType).IsEqualTo("application/problem+json");
            var (_, other) = limited.NewUser();
            await Assert.That((await limited.SendMessageAsync(other, await limited.CreateConversationAsync(other), "free")).Status).IsEqualTo(200);

            await using var off = await HelplyHttpHost.StartAsync(nameof(Messages_are_rate_limited_validated_and_refused_when_helply_is_off) + "-off", enabled: false);
            var (_, offToken) = off.NewUser();
            var offChat = await off.CreateConversationAsync(offToken);
            await Assert.That((await off.CallAsync(HttpMethod.Get, "/api/helply/status", offToken)).Json.GetProperty("enabled").GetBoolean()).IsFalse();
            await Assert.That((await off.SendMessageAsync(offToken, offChat, "hello")).Status).IsEqualTo(503);
            await Assert.That((await off.AnswerAsync(offToken, offChat, ("a", true))).Status).IsEqualTo(503);
            await Assert.That((await off.CallAsync(HttpMethod.Get, "/api/helply/settings", offToken)).Status).IsEqualTo(200);
            await Assert.That(off.Gateway.Requests).IsEmpty();
        }

        [Test]
        public async Task A_conversation_runs_one_turn_at_a_time()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_conversation_runs_one_turn_at_a_time));
            var (userId, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);

            using var held = host.Services.GetRequiredService<HelplyTurnLocks>().TryEnter(id);
            var refused = await host.SendMessageAsync(token, id, "hello");

            await Assert.That(refused.Status).IsEqualTo(409);
            await Assert.That(userId).IsNotEqualTo(Guid.Empty);
        }

        [Test]
        public async Task Conversations_expire_thirty_days_after_the_last_activity()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Conversations_expire_thirty_days_after_the_last_activity));
            var (_, token) = host.NewUser();
            var idle = await host.CreateConversationAsync(token);
            var active = await host.CreateConversationAsync(token);

            host.Time.Advance(TimeSpan.FromDays(20));
            await host.SendMessageAsync(token, active, "still here");
            host.Time.Advance(TimeSpan.FromDays(11));

            var list = (await host.CallAsync(HttpMethod.Get, "/api/helply/conversations", token)).Json;
            await Assert.That(list.GetArrayLength()).IsEqualTo(1);
            await Assert.That(list[0].GetProperty("id").GetGuid()).IsEqualTo(active);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{idle}", token)).Status).IsEqualTo(404);
            await Assert.That((await host.SendMessageAsync(token, idle, "hello")).Status).IsEqualTo(404);

            var removed = await host.ScopedAsync(sp => sp.GetRequiredService<HelplyConversationStore>().SweepAsync());
            await Assert.That(removed).IsEqualTo(1);
            await Assert.That(await host.ScopedAsync(async sp => await sp.GetRequiredService<SchulyDbContext>().HelplyConversations.CountAsync())).IsEqualTo(1);
        }

        [Test]
        public async Task Purging_an_account_removes_its_helply_data()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Purging_an_account_removes_its_helply_data));
            var (leaving, leavingToken) = host.NewUser();
            var (_, stayingToken) = host.NewUser();
            await host.CreateConversationAsync(leavingToken);
            await host.CreateConversationAsync(stayingToken);
            await host.SetPermissionsAsync(leavingToken, McpPermissionSet.None());

            await host.ScopedAsync(async sp =>
            {
                var purger = new AccountPurger(sp.GetRequiredService<SchulyDbContext>(), new FakeDocumentStorage(), TestVault.Factory(), NullPluginUserDataPurger.Instance, NullLogger<AccountPurger>.Instance);
                return await purger.PurgeApplicationUserAsync(leaving);
            });

            var (conversations, settings, remaining) = await host.ScopedAsync(async sp =>
            {
                var db = sp.GetRequiredService<SchulyDbContext>();
                return (await db.HelplyConversations.CountAsync(), await db.HelplySettings.CountAsync(), await db.HelplyConversations.CountAsync(c => c.ApplicationUserId == leaving));
            });
            await Assert.That(conversations).IsEqualTo(1);
            await Assert.That(settings).IsEqualTo(0);
            await Assert.That(remaining).IsEqualTo(0);
        }
    }
}
