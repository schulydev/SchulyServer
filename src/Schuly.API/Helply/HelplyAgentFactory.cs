using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging.Abstractions;
using OpenAI.Chat;
using Schuly.Domain.Helply;
using ChatMessage = Microsoft.Extensions.AI.ChatMessage;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Keeps a conversation's history within bounds: the most recent messages up to a count and a character cap, starting at a plain user message so the window never opens
    /// in the middle of a tool exchange (a tool result without its call is rejected by gateways). The latest user message is always kept, however long.
    /// </summary>
    public sealed class HelplyChatReducer(int maxMessages, int maxChars) : IChatReducer
    {
        public Task<IEnumerable<ChatMessage>> ReduceAsync(IEnumerable<ChatMessage> messages, CancellationToken cancellationToken = default) => Task.FromResult<IEnumerable<ChatMessage>>(Reduce(messages.ToList()));

        public IReadOnlyList<ChatMessage> Reduce(IReadOnlyList<ChatMessage> messages)
        {
            var start = messages.Count;
            var chars = 0;
            while (start > 0 && messages.Count - start < maxMessages)
            {
                var size = Size(messages[start - 1]);
                if (chars + size > maxChars && start < messages.Count)
                    break;
                chars += size;
                start--;
            }

            // Open the window at a user message that starts a turn. If the budget ended inside the newest turn, fall back to that turn's start.
            var opening = Enumerable.Range(start, messages.Count - start).Cast<int?>().FirstOrDefault(i => StartsTurn(messages[i!.Value]));
            opening ??= Enumerable.Range(0, messages.Count).Reverse().Cast<int?>().FirstOrDefault(i => StartsTurn(messages[i!.Value]));
            return opening is { } from ? messages.Skip(from).ToList() : messages.ToList();
        }

        private static bool StartsTurn(ChatMessage message) => message.Role == ChatRole.User && !message.Contents.Any(c => c is FunctionResultContent or ToolApprovalResponseContent);

        private static int Size(ChatMessage message) => message.Contents.Sum(c => c switch
        {
            TextContent t => t.Text?.Length ?? 0,
            FunctionResultContent r => r.Result?.ToString()?.Length ?? 0,
            FunctionCallContent f => 100 + (f.Arguments?.Sum(a => a.Value?.ToString()?.Length ?? 0) ?? 0),
            _ => 50,
        });
    }

    /// <summary>Builds the agent for one run: the gateway's chat client, the system prompt, the tools exactly as MCP listed them, and a bounded history. Nothing here logs or traces.</summary>
    public static class HelplyAgentFactory
    {
        public static AIAgent Create(ChatClient chat, HelplyLimits limits, string instructions, IList<AITool> tools) => Create(chat, limits, instructions, tools, null, limits.MaxToolIterations, HelplyReasoningEffort.High);

        /// <summary>
        /// The agent with Helply's tool loop: every call goes through <see cref="HelplyToolInvoker"/> (argument cap, repeat guard, result cap), the loop stops after
        /// <paramref name="maxIterations"/> round trips, every model request carries the user's reasoning <paramref name="effort"/> (see <see cref="HelplyReasoningClient"/>), and with <paramref name="attachments"/> every request has its attachment markers expanded underneath the loop.
        /// </summary>
        public static AIAgent Create(ChatClient chat, HelplyLimits limits, string instructions, IList<AITool> tools, HelplyAttachmentContext? attachments, int maxIterations, HelplyReasoningEffort effort)
        {
            var invoker = new HelplyToolInvoker(limits.MaxToolArgumentChars, limits.MaxToolResultChars);
            var options = new ChatClientAgentOptions
            {
                ChatOptions = new ChatOptions { Instructions = instructions, Tools = tools, MaxOutputTokens = limits.MaxOutputTokens },
                ChatHistoryProvider = new InMemoryChatHistoryProvider(new InMemoryChatHistoryProviderOptions
                {
                    ChatReducer = new HelplyChatReducer(limits.MaxHistoryMessages, limits.MaxHistoryChars),
                    ReducerTriggerEvent = InMemoryChatHistoryProviderOptions.ChatReducerTriggerEvent.AfterMessageAdded,
                }),
            };
            return chat.AsAIAgent(options, client =>
            {
                var builder = client.AsBuilder().Use(inner => new HelplyReasoningClient(inner, client.GetService<ChatClientMetadata>()?.DefaultModelId ?? string.Empty, effort)).UseFunctionInvocation(NullLoggerFactory.Instance, f =>
                {
                    f.MaximumIterationsPerRequest = Math.Max(1, maxIterations);
                    f.MaximumConsecutiveErrorsPerRequest = 3;
                    f.AllowConcurrentInvocation = false;
                    f.FunctionInvoker = invoker.InvokeAsync;
                });
                if (attachments is not null)
                    builder = builder.Use(inner => new HelplyAttachmentExpander(inner, attachments));
                return builder.Build();
            }, NullLoggerFactory.Instance);
        }
    }
}
