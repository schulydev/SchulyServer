using System.Text.Json;
using Mediator;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
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
    /// <summary>
    /// The Microsoft plugin answers with sealed (opaque) ids. The tools must hand them to the agent untouched and pass them back to the plugin exactly as the agent returns them.
    /// Runs the real in-process pipeline (InProcessPluginApi) against fake plugin endpoints that record what they receive.
    /// </summary>
    public class McpSealedIdTests
    {
        private static readonly Guid AccountId = Guid.Parse("11111111-2222-3333-4444-555555555555");
        private const string SealedChatId = "Ab3_x-Z9Q0kLmN-pRsT_uVwXyZ0123456789AbCdEfGhIjKlMnOpQrStUv";
        private const string SealedMessageId = "Zm9v_YmFy-c2VhbGVkLW1zZy0xMjM0NTY3ODkw";
        private const string SealedUserId = "Uu_9-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

        [Test]
        public async Task Sealed_ids_round_trip_through_the_chat_tools_unchanged()
        {
            var receivedChatIds = new List<string>();
            var receivedAccountIds = new List<string>();

            await using var host = await McpHttpHost.StartAsync(
                nameof(Sealed_ids_round_trip_through_the_chat_tools_unchanged),
                services =>
                {
                    services.AddScoped<IMediator, LinkedMicrosoftMediator>();
                    services.AddSingleton<PluginHost>(sp => new PluginHost(sp, sp.GetRequiredService<IConfiguration>(), new ApplicationPartManager(), new PluginEndpointDataSource(), new PluginAssemblyMap(), null!, NullLogger<PluginHost>.Instance));
                },
                app =>
                {
                    var microsoft = app.MapGroup("/api/plugins/microsoft/accounts/{accountId}");
                    microsoft.MapGet("/chats", () => Results.Json(new
                    {
                        value = new object[]
                        {
                            new
                            {
                                id = SealedChatId,
                                topic = "Study group",
                                chatType = "group",
                                isSelfChat = false,
                                members = new[] { new { userId = SealedUserId, displayName = "Anna" } },
                                lastMessagePreview = new { id = SealedMessageId, createdDateTime = "2026-11-02T08:00:00Z", from = new { user = new { id = SealedUserId, displayName = "Anna" } }, body = new { contentType = "text", content = "see you" } },
                                lastUpdatedDateTime = "2026-11-02T08:00:00Z",
                            },
                        },
                    }));
                    microsoft.MapGet("/chats/{chatId}/messages", (string accountId, string chatId) =>
                    {
                        receivedAccountIds.Add(accountId);
                        receivedChatIds.Add(chatId);
                        return Results.Json(new { value = new object[] { new { id = SealedMessageId, messageType = "message", createdDateTime = "2026-11-02T08:00:00Z", from = new { user = new { id = SealedUserId, displayName = "Anna" } }, body = new { contentType = "text", content = "see you" } } } });
                    });
                });

            var userId = host.Scoped(sp => NewUser(sp.GetRequiredService<SchulyDbContext>()).User.Id);
            var set = McpPermissionSet.None();
            set.Areas[McpArea.Teams] = McpAccessLevel.Read;
            var key = await host.ApiKeyAsync(userId, set);

            await using var client = await host.ConnectAsync(key);

            var listed = await client.CallToolAsync("list_chats", new Dictionary<string, object?>());
            await Assert.That(listed.IsError ?? false).IsFalse();
            var listedText = ((TextContentBlock)listed.Content[0]).Text;
            var chat = JsonDocument.Parse(listedText).RootElement.GetProperty("chats")[0];
            var chatId = chat.GetProperty("chatId").GetString();
            await Assert.That(chatId).IsEqualTo(SealedChatId);
            await Assert.That(chat.GetProperty("isSelfChat").GetBoolean()).IsFalse();
            // The agent sees only the sealed id of the chat; the member's user id is not part of the output.
            await Assert.That(listedText).DoesNotContain(SealedUserId);

            var read = await client.CallToolAsync("read_chat_messages", new Dictionary<string, object?> { ["chatId"] = chatId });
            await Assert.That(read.IsError ?? false).IsFalse();
            var readJson = JsonDocument.Parse(((TextContentBlock)read.Content[0]).Text).RootElement;

            await Assert.That(receivedChatIds).IsEquivalentTo(new[] { SealedChatId });
            await Assert.That(receivedAccountIds).IsEquivalentTo(new[] { AccountId.ToString() });
            await Assert.That(readJson.GetProperty("chatId").GetString()).IsEqualTo(SealedChatId);
            await Assert.That(readJson.GetProperty("messages")[0].GetProperty("id").GetString()).IsEqualTo(SealedMessageId);
        }

        /// <summary>One linked Microsoft account; everything else answers like the empty mediator.</summary>
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
