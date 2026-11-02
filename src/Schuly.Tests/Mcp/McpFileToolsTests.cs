using System.Collections.Concurrent;
using System.Text.Json;
using System.Web;
using Mediator;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Schuly.API.Plugins;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Application.Queries.LinkedAccount;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using static Schuly.Tests.Mcp.McpTestSupport;

namespace Schuly.Tests.Mcp
{
    /// <summary>Teams / SharePoint file tools, unified search, file text and channel messages against fake plugin endpoints that record what they receive.</summary>
    [NotInParallel]
    public class McpFileToolsTests
    {
        private static readonly Guid AccountId = Guid.Parse("11111111-2222-3333-4444-555555555555");

        private sealed record Seen(string Method, string Path, string Query, string Body);

        private static McpPermissionSet Only(params (McpArea Area, McpAccessLevel Level)[] areas)
        {
            var set = McpPermissionSet.None();
            foreach (var (area, level) in areas)
                set.Areas[area] = level;
            return set;
        }

        private static async Task<(McpHttpHost Host, McpClient Client, ConcurrentQueue<Seen> Seen)> StartAsync(string name, McpPermissionSet permissions, Func<string, string, string?> answer)
        {
            var seen = new ConcurrentQueue<Seen>();
            var host = await McpHttpHost.StartAsync(
                name,
                services =>
                {
                    services.AddScoped<IMediator, LinkedMicrosoftMediator>();
                    services.AddSingleton<PluginHost>(sp => new PluginHost(sp, sp.GetRequiredService<IConfiguration>(), new ApplicationPartManager(), new PluginEndpointDataSource(), new PluginAssemblyMap(), null!, NullLogger<PluginHost>.Instance));
                },
                app => app.MapMethods("/api/plugins/microsoft/accounts/{accountId}/{**rest}", ["GET", "POST"], async (HttpContext context, string rest) =>
                {
                    var body = context.Request.ContentLength > 0 ? await new StreamReader(context.Request.Body).ReadToEndAsync() : string.Empty;
                    seen.Enqueue(new Seen(context.Request.Method, rest, context.Request.QueryString.Value ?? string.Empty, body));
                    var json = answer(context.Request.Method, rest);
                    return json is null ? Results.NotFound() : Results.Content(json, "application/json");
                }));
            var userId = host.Scoped(sp => NewUser(sp.GetRequiredService<SchulyDbContext>()).User.Id);
            var key = await host.ApiKeyAsync(userId, permissions);
            return (host, await host.ConnectAsync(key), seen);
        }

        private static async Task<JsonElement> CallAsync(McpClient client, string tool, Dictionary<string, object?> args)
        {
            var result = await client.CallToolAsync(tool, args);
            await Assert.That(result.IsError ?? false).IsFalse().Because(tool);
            return JsonDocument.Parse(((TextContentBlock)result.Content[0]).Text).RootElement;
        }

        [Test]
        public async Task The_file_and_channel_tools_are_hidden_without_Drive_or_Teams_read()
        {
            var (host, client, _) = await StartAsync(nameof(The_file_and_channel_tools_are_hidden_without_Drive_or_Teams_read), Only((McpArea.Mail, McpAccessLevel.Read)), (_, _) => "{}");
            await using var _h = host;
            await using var _c = client;
            var names = (await client.ListToolsAsync()).Select(t => t.Name).ToList();
            foreach (var hidden in new[] { "list_teams", "list_team_files", "list_folder", "list_shared_with_me", "list_recent_files", "search_files", "search", "read_file", "list_channel_messages", "search_channel_messages" })
                await Assert.That(names).DoesNotContain(hidden);
            await Assert.That(names).Contains("read_mail");
        }

        [Test]
        public async Task Drive_read_shows_the_file_tools_and_Teams_read_the_channel_tools()
        {
            var (driveHost, driveClient, _) = await StartAsync(nameof(Drive_read_shows_the_file_tools_and_Teams_read_the_channel_tools) + "A", Only((McpArea.Drive, McpAccessLevel.Read)), (_, _) => "{}");
            await using var _h1 = driveHost;
            await using var _c1 = driveClient;
            var driveNames = (await driveClient.ListToolsAsync()).Select(t => t.Name).ToList();
            foreach (var shown in new[] { "list_teams", "list_team_files", "list_folder", "list_shared_with_me", "list_recent_files", "search_files", "search", "read_file" })
                await Assert.That(driveNames).Contains(shown);
            await Assert.That(driveNames).DoesNotContain("list_channel_messages");
            await Assert.That(driveNames).DoesNotContain("search_channel_messages");

            var (teamsHost, teamsClient, _) = await StartAsync(nameof(Drive_read_shows_the_file_tools_and_Teams_read_the_channel_tools) + "B", Only((McpArea.Teams, McpAccessLevel.Read)), (_, _) => "{}");
            await using var _h2 = teamsHost;
            await using var _c2 = teamsClient;
            var teamsNames = (await teamsClient.ListToolsAsync()).Select(t => t.Name).ToList();
            await Assert.That(teamsNames).Contains("list_channel_messages");
            await Assert.That(teamsNames).Contains("search_channel_messages");
            await Assert.That(teamsNames).DoesNotContain("search");
            await Assert.That(teamsNames).DoesNotContain("read_file");
        }

        [Test]
        public async Task Unified_search_only_asks_for_mail_and_chats_when_the_connection_may_read_them()
        {
            const string hits = """{"query":"Masterplan","hits":[{"type":"file","id":"item-1","driveId":"b!drive","title":"Masterplan BM23d.xlsx","snippet":"Pruefungen","size":20155,"location":{"kind":"team","teamId":"t1","channelId":"c1","path":"General","label":"Team BM23d > General"},"webUrl":"https://x/y"}],"moreAvailable":true,"nextFrom":25}""";
            var cases = new (McpPermissionSet Permissions, string[] Types)[]
            {
                (Only((McpArea.Drive, McpAccessLevel.Read)), ["files"]),
                (Only((McpArea.Drive, McpAccessLevel.Read), (McpArea.Mail, McpAccessLevel.Read)), ["files", "mail"]),
                (Only((McpArea.Drive, McpAccessLevel.Read), (McpArea.Teams, McpAccessLevel.Read)), ["files", "chats", "channels"]),
                (Only((McpArea.Drive, McpAccessLevel.Read), (McpArea.Teams, McpAccessLevel.Read), (McpArea.Mail, McpAccessLevel.Read)), ["files", "mail", "chats", "channels"]),
            };
            for (var i = 0; i < cases.Length; i++)
            {
                var (host, client, seen) = await StartAsync(nameof(Unified_search_only_asks_for_mail_and_chats_when_the_connection_may_read_them) + i, cases[i].Permissions, (_, _) => hits);
                await using var _h = host;
                await using var _c = client;
                var result = await CallAsync(client, "search", new() { ["query"] = "Masterplan", ["teamId"] = "t1" });

                var request = seen.Single();
                await Assert.That(request.Method).IsEqualTo("POST");
                await Assert.That(request.Path).IsEqualTo("search");
                var body = JsonDocument.Parse(request.Body).RootElement;
                await Assert.That(body.GetProperty("types").EnumerateArray().Select(t => t.GetString())).IsEquivalentTo(cases[i].Types);
                await Assert.That(body.GetProperty("q").GetString()).IsEqualTo("Masterplan");
                await Assert.That(body.GetProperty("teamId").GetString()).IsEqualTo("t1");

                var hit = result.GetProperty("hits")[0];
                await Assert.That(hit.GetProperty("itemId").GetString()).IsEqualTo("item-1");
                await Assert.That(hit.GetProperty("driveId").GetString()).IsEqualTo("b!drive");
                await Assert.That(hit.GetProperty("location").GetProperty("label").GetString()).IsEqualTo("Team BM23d > General");
                await Assert.That(result.GetProperty("nextOffset").GetInt32()).IsEqualTo(25);
            }
        }

        [Test]
        public async Task Read_file_tells_the_agent_how_to_get_the_next_rows_and_other_sheets()
        {
            const string text = """{"name":"Masterplan.xlsx","kind":"spreadsheet","text":"a,b\n1,2","offset":0,"nextOffset":null,"totalChars":7,"truncated":true,"sheets":[{"name":"Plan","rows":900,"columns":4},{"name":"Raeume","rows":10,"columns":2}],"sheet":"Plan","rowOffset":0,"rowCount":900,"nextRowOffset":500}""";
            var (host, client, seen) = await StartAsync(nameof(Read_file_tells_the_agent_how_to_get_the_next_rows_and_other_sheets), Only((McpArea.Drive, McpAccessLevel.Read)), (_, _) => text);
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "read_file", new() { ["itemId"] = "it/em+1", ["driveId"] = "b!dr/ive", ["maxRows"] = 500 });
            var hints = result.GetProperty("next").EnumerateArray().Select(h => h.GetString()!).ToList();
            await Assert.That(result.GetProperty("nextRowOffset").GetInt32()).IsEqualTo(500);
            await Assert.That(hints.Any(h => h.Contains("rowOffset=500") && h.Contains("sheet='Plan'") && h.Contains("driveId='b!dr/ive'"))).IsTrue();
            await Assert.That(hints.Any(h => h.Contains("Other sheets") && h.Contains("'Raeume'"))).IsTrue();

            var first = seen.Single();
            await Assert.That(first.Path).IsEqualTo("drives/b!dr%2Five/items/it%2Fem+1/text");

            // Without a driveId it is the user's own OneDrive.
            await CallAsync(client, "read_file", new() { ["itemId"] = "own1", ["sheet"] = "Raeume", ["rowOffset"] = 10 });
            var own = seen.Last();
            await Assert.That(own.Path).IsEqualTo("files/own1/text");
            var query = HttpUtility.ParseQueryString(own.Query);
            await Assert.That(query["sheet"]).IsEqualTo("Raeume");
            await Assert.That(query["rowOffset"]).IsEqualTo("10");
        }

        [Test]
        public async Task List_team_files_forwards_the_channel_and_the_escaped_folder_path()
        {
            const string files = """{"driveId":"b!lib","folder":{"id":"f1","name":"Deutsch","path":"Deutsch"},"items":[{"id":"i1","name":"Pruefung.docx","size":10,"parentReference":{"driveId":"b!lib"},"file":{"mimeType":"x"}},{"id":"i2","name":"Sub","folder":{"childCount":3},"parentReference":{"driveId":"b!lib"}}]}""";
            var (host, client, seen) = await StartAsync(nameof(List_team_files_forwards_the_channel_and_the_escaped_folder_path), Only((McpArea.Drive, McpAccessLevel.Read)), (_, _) => files);
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "list_team_files", new() { ["teamId"] = "team/1", ["channelId"] = "19:abc@thread.tacv2", ["path"] = "/Prüfungen & Tests/2026/" });

            var request = seen.Single();
            await Assert.That(request.Path).IsEqualTo("teams/team%2F1/files");
            var query = HttpUtility.ParseQueryString(request.Query);
            await Assert.That(query["channelId"]).IsEqualTo("19:abc@thread.tacv2");
            await Assert.That(query["path"]).IsEqualTo("Prüfungen & Tests/2026");
            await Assert.That(request.Query).DoesNotContain("& Tests");

            await Assert.That(result.GetProperty("driveId").GetString()).IsEqualTo("b!lib");
            var entries = result.GetProperty("items").GetProperty("entries");
            await Assert.That(entries[0].GetProperty("itemId").GetString()).IsEqualTo("i1");
            await Assert.That(entries[0].GetProperty("driveId").GetString()).IsEqualTo("b!lib");
            await Assert.That(entries[1].GetProperty("isFolder").GetBoolean()).IsTrue();
        }

        [Test]
        public async Task Channel_posts_and_thread_replies_use_their_own_routes()
        {
            const string messages = """[{"id":"m1","from":{"displayName":"Anna","id":"u"},"createdDateTime":"2026-11-02T08:00:00Z","text":"Masterplan ist online","attachments":[{"name":"plan.xlsx","webUrl":"https://x"}]}]""";
            var (host, client, seen) = await StartAsync(nameof(Channel_posts_and_thread_replies_use_their_own_routes), Only((McpArea.Teams, McpAccessLevel.Read)), (_, rest) => rest.StartsWith("search") ? """{"hits":[]}""" : messages);
            await using var _h = host;
            await using var _c = client;

            var posts = await CallAsync(client, "list_channel_messages", new() { ["teamId"] = "t", ["channelId"] = "19:c@thread.tacv2", ["limit"] = 5 });
            await Assert.That(posts.GetProperty("messages")[0].GetProperty("text").GetString()).IsEqualTo("Masterplan ist online");
            await Assert.That(seen.Last().Path).IsEqualTo("teams/t/channels/19:c@thread.tacv2/messages");

            await CallAsync(client, "list_channel_messages", new() { ["teamId"] = "t", ["channelId"] = "c", ["messageId"] = "m1" });
            await Assert.That(seen.Last().Path).IsEqualTo("teams/t/channels/c/messages/m1/replies");

            await CallAsync(client, "search_channel_messages", new() { ["query"] = "Plan" });
            var body = JsonDocument.Parse(seen.Last().Body).RootElement;
            await Assert.That(body.GetProperty("types").EnumerateArray().Select(t => t.GetString())).IsEquivalentTo(new[] { "channels" });
        }

        private sealed class LinkedMicrosoftMediator : IMediator
        {
            private readonly EmptyMediator _inner = new();

            public ValueTask<TResponse> Send<TResponse>(IQuery<TResponse> query, CancellationToken cancellationToken = default)
            {
                if (query is GetMyLinkedAccountsQuery)
                {
                    var accounts = new List<LinkedAccountDto> { new() { Id = AccountId, Provider = "microsoft", Email = "student@school.test" } };
                    return new((TResponse)(object)Result<List<LinkedAccountDto>>.Success(accounts));
                }
                return _inner.Send(query, cancellationToken);
            }

            public ValueTask<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default) => _inner.Send(request, cancellationToken);
            public ValueTask<TResponse> Send<TResponse>(ICommand<TResponse> command, CancellationToken cancellationToken = default) => _inner.Send(command, cancellationToken);
            public ValueTask<object?> Send(object message, CancellationToken cancellationToken = default) => _inner.Send(message, cancellationToken);
            public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamQuery<TResponse> query, CancellationToken cancellationToken = default) => _inner.CreateStream(query, cancellationToken);
            public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) => _inner.CreateStream(request, cancellationToken);
            public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamCommand<TResponse> command, CancellationToken cancellationToken = default) => _inner.CreateStream(command, cancellationToken);
            public IAsyncEnumerable<object?> CreateStream(object message, CancellationToken cancellationToken = default) => _inner.CreateStream(message, cancellationToken);
            public ValueTask Publish<TNotification>(TNotification notification, CancellationToken cancellationToken = default) where TNotification : INotification => _inner.Publish(notification, cancellationToken);
            public ValueTask Publish(object notification, CancellationToken cancellationToken = default) => _inner.Publish(notification, cancellationToken);
        }
    }
}
