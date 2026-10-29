using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using Schuly.Domain.Helply;
using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    public enum HelplyTurnKind
    {
        Message,
        Approvals,
        Retry,
    }

    /// <summary>One server-sent event: its name and its JSON payload.</summary>
    public sealed record HelplyEvent(string Name, object Data);

    public sealed record HelplyDecision(string ApprovalId, bool Approved);

    /// <summary>A turn that passed every check and holds its conversation's lock until disposed.</summary>
    public sealed class HelplyTurn(Guid userId, HelplyConversation conversation, HelplyTurnKind kind, string? text, IReadOnlyList<HelplyDecision> decisions, IDisposable turnLock) : IDisposable
    {
        public Guid UserId { get; } = userId;
        public HelplyConversation Conversation { get; } = conversation;
        public HelplyTurnKind Kind { get; } = kind;
        public string? Text { get; } = text;
        public IReadOnlyList<HelplyDecision> Decisions { get; } = decisions;

        public void Dispose() => turnLock.Dispose();
    }

    /// <summary>Why a turn could not start: a plain HTTP status, a generic message, and for 429 how long to wait.</summary>
    public sealed record HelplyRefusal(int Status, string Detail, TimeSpan? RetryAfter = null);

    /// <summary>
    /// Runs one Helply turn on the Microsoft Agent Framework and reports it as events. The agent only has the tools MCP lists for the user's Helply permissions; calls that are not
    /// read-only stop for the user's approval. The model id, gateway address and key never leave this class: only redacted text and tool labels become events, and a failure
    /// is logged by exception type alone.
    /// </summary>
    public sealed class HelplyChatService(HelplyConversationStore store, HelplyGateway gateway, HelplyMcpConnector connector, HelplyRateLimiter limiter, HelplyTurnLocks locks, IOptions<HelplyLimits> limitOptions, TimeProvider time, ILogger<HelplyChatService> logger)
    {
        public const string GenericError = "Helply couldn't answer right now.";
        public const int TitleLength = 60;

        private static readonly JsonSerializerOptions ContentJson = Microsoft.Extensions.AI.AIJsonUtilities.DefaultOptions;

        private HelplyLimits Limits => limitOptions.Value;

        /// <summary>Checks everything that can be refused with a plain HTTP status, in the order the API promises, and takes the conversation's lock.</summary>
        public async Task<(HelplyTurn? Turn, HelplyRefusal? Refusal)> BeginAsync(Guid userId, Guid conversationId, HelplyTurnKind kind, string? text, IReadOnlyList<HelplyDecision>? decisions, CancellationToken ct)
        {
            if (kind == HelplyTurnKind.Message)
            {
                var trimmed = text?.Trim() ?? string.Empty;
                if (trimmed.Length == 0)
                    return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Write a message first."));
                if (trimmed.Length > Limits.MaxInputChars)
                    return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, $"A message can be at most {Limits.MaxInputChars} characters."));
                text = trimmed;
            }
            if (kind == HelplyTurnKind.Approvals && decisions is not { Count: > 0 })
                return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Send at least one decision."));

            var conversation = await store.FindAsync(userId, conversationId, ct);
            if (conversation is null)
                return (null, new HelplyRefusal(StatusCodes.Status404NotFound, "Conversation not found"));

            var transcript = store.ReadTranscript(conversation);
            if (kind == HelplyTurnKind.Approvals)
            {
                var pending = transcript.Pending.Select(p => p.ApprovalId).ToHashSet(StringComparer.Ordinal);
                var answered = decisions!.Select(d => d.ApprovalId).ToHashSet(StringComparer.Ordinal);
                if (answered.Count != decisions!.Count || !answered.SetEquals(pending))
                    return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Answer every pending approval exactly once."));
            }
            if (kind == HelplyTurnKind.Retry && !(transcript.Messages is [.., { Role: "user" }, { Role: "assistant", Failed: true }]))
                return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "There is nothing to retry."));

            if (!limiter.TryAcquire(userId, out var retryAfter))
                return (null, new HelplyRefusal(StatusCodes.Status429TooManyRequests, "You are sending messages too quickly. Please wait a moment.", retryAfter));

            var turnLock = locks.TryEnter(conversationId);
            if (turnLock is null)
                return (null, new HelplyRefusal(StatusCodes.Status409Conflict, "Helply is still answering in this conversation."));

            return (new HelplyTurn(userId, conversation, kind, text, decisions ?? [], turnLock), null);
        }

        public async Task RunAsync(HelplyTurn turn, Func<HelplyEvent, Task> emit, CancellationToken requestAborted)
        {
            var conversation = turn.Conversation;
            var original = store.ReadTranscript(conversation);
            var work = store.ReadTranscript(conversation);
            var redactor = gateway.Redactor();

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(Math.Max(5, Limits.RunTimeoutSeconds)));
            var clientGone = false;

            async Task Emit(HelplyEvent e)
            {
                if (clientGone)
                    return;
                try
                {
                    await emit(e);
                }
                catch
                {
                    clientGone = true;
                    cts.Cancel();
                }
            }

            HelplyStoredMessage? userMessage = null;
            HelplyStoredMessage assistant = new() { Id = Guid.NewGuid(), Role = "assistant", CreatedAt = time.GetUtcNow().UtcDateTime };
            var title = store.ReadTitle(conversation);
            string? sessionJson = null;
            var awaiting = false;

            try
            {
                var input = new List<ChatMessage>();
                var started = new List<HelplyStoredTool>();
                var finishLabels = new Dictionary<string, (string Done, string Failed)>(StringComparer.Ordinal);

                // Approvals still open are answered with a denial when the user moves on instead of answering them.
                if (turn.Kind != HelplyTurnKind.Approvals && work.Pending.Count > 0)
                {
                    foreach (var pending in work.Pending)
                    {
                        input.Add(new ChatMessage(ChatRole.User, [Response(pending, approved: false)]));
                        AddFinishedTool(work, pending, HelplyToolStatus.Denied);
                    }
                    work.Pending.Clear();
                }

                string userText;
                switch (turn.Kind)
                {
                    case HelplyTurnKind.Message:
                        userText = turn.Text!;
                        userMessage = new HelplyStoredMessage { Id = Guid.NewGuid(), Role = "user", Text = userText, CreatedAt = assistant.CreatedAt };
                        work.Messages.Add(userMessage);
                        work.Messages.Add(assistant);
                        if (original.Messages.All(m => m.Role != "user") && title == HelplyConversationStore.DefaultTitle)
                            title = AutoTitle(userText);
                        input.Add(new ChatMessage(ChatRole.User, userText));
                        break;
                    case HelplyTurnKind.Retry:
                        work.Messages.RemoveAt(work.Messages.Count - 1);
                        userText = work.Messages[^1].Text;
                        work.Messages.Add(assistant);
                        input.Add(new ChatMessage(ChatRole.User, userText));
                        break;
                    default:
                        var first = work.Pending[0];
                        assistant = work.Messages.First(m => m.Id == first.MessageId);
                        var responses = new List<AIContent>();
                        foreach (var decision in turn.Decisions)
                        {
                            var pending = work.Pending.First(p => p.ApprovalId == decision.ApprovalId);
                            responses.Add(Response(pending, decision.Approved));
                            if (decision.Approved)
                            {
                                started.Add(AddTool(assistant, pending.ToolCallId, pending.RunningLabel));
                                finishLabels[pending.ToolCallId] = (pending.DoneLabel, pending.ToolLabel);
                            }
                            else
                                AddFinishedTool(work, pending, HelplyToolStatus.Denied);
                        }
                        work.Pending.Clear();
                        input.Add(new ChatMessage(ChatRole.User, responses));
                        break;
                }

                await Emit(new HelplyEvent("start", new { messageId = assistant.Id }));
                foreach (var tool in turn.Kind == HelplyTurnKind.Approvals ? turn.Decisions.Where(d => !d.Approved) : [])
                {
                    var denied = original.Pending.First(p => p.ApprovalId == tool.ApprovalId);
                    await Emit(new HelplyEvent("tool_finished", new { id = denied.ToolCallId, label = denied.ToolLabel, status = HelplyToolStatus.Denied }));
                }
                foreach (var tool in started)
                    await Emit(new HelplyEvent("tool_started", new { id = tool.Id, label = tool.Label }));

                var connection = await gateway.ConnectAsync(cts.Token);
                redactor = connection.Redactor;
                var permissions = await store.GetPermissionsAsync(turn.UserId, cts.Token);
                await using var toolSet = await connector.ConnectAsync(turn.UserId, permissions, cts.Token);
                var agent = HelplyAgentFactory.Create(connection.Chat, Limits, HelplyPrompt.System(Now()), toolSet.Tools);
                var session = await RestoreSessionAsync(agent, conversation, cts.Token);

                var text = redactor.CreateStream();
                var needsSeparator = turn.Kind == HelplyTurnKind.Approvals && assistant.Text.Length > 0;
                await foreach (var update in agent.RunStreamingAsync(input, session, null, cts.Token))
                {
                    foreach (var content in update.Contents)
                    {
                        switch (content)
                        {
                            case TextContent { Text.Length: > 0 } piece:
                                var safe = text.Push(piece.Text);
                                if (safe.Length > 0)
                                {
                                    if (needsSeparator && assistant.Text.Length > 0 && !char.IsWhiteSpace(assistant.Text[^1]))
                                        safe = "\n\n" + safe;
                                    needsSeparator = false;
                                    assistant.Text += safe;
                                    await Emit(new HelplyEvent("delta", new { text = safe }));
                                }
                                break;
                            case FunctionCallContent call when toolSet.Info.TryGetValue(call.Name, out var info) && !info.NeedsApproval && assistant.Tools.All(t => t.Id != call.CallId):
                                var labels = HelplyToolLabels.For(info.Name, info.Title);
                                var tool = AddTool(assistant, call.CallId, labels.Running);
                                finishLabels[call.CallId] = (labels.Done, info.Title);
                                needsSeparator = true;
                                await Emit(new HelplyEvent("tool_started", new { id = tool.Id, label = tool.Label }));
                                break;
                            case FunctionResultContent result when assistant.Tools.FirstOrDefault(t => t.Id == result.CallId) is { Status: HelplyToolStatus.Running } running:
                                var failed = IsError(result);
                                running.Status = failed ? HelplyToolStatus.Failed : HelplyToolStatus.Done;
                                running.Label = finishLabels.TryGetValue(running.Id, out var done) ? (failed ? done.Failed : done.Done) : running.Label;
                                await Emit(new HelplyEvent("tool_finished", new { id = running.Id, label = running.Label, status = running.Status }));
                                break;
                            case ToolApprovalRequestContent request when request.ToolCall is FunctionCallContent approvalCall:
                                var approval = BuildApproval(request, approvalCall, toolSet, assistant.Id, redactor);
                                work.Pending.Add(approval);
                                needsSeparator = true;
                                await Emit(new HelplyEvent("approval_required", HelplyDtoShape(approval)));
                                break;
                        }
                    }
                }

                var rest = text.Flush();
                if (rest.Length > 0)
                {
                    assistant.Text += rest;
                    await Emit(new HelplyEvent("delta", new { text = rest }));
                }
                foreach (var stale in assistant.Tools.Where(t => t.Status == HelplyToolStatus.Running))
                    stale.Status = HelplyToolStatus.Done;

                sessionJson = (await agent.SerializeSessionAsync(session, null, cts.Token)).GetRawText();
                awaiting = work.Pending.Count > 0;
                Commit(conversation, work, title, sessionJson);
            }
            catch (Exception ex)
            {
                var aborted = requestAborted.IsCancellationRequested || clientGone;
                var timedOut = !aborted && ex is OperationCanceledException or TimeoutException && cts.IsCancellationRequested;
                if (!aborted)
                    logger.LogWarning("Helply turn failed ({Error}) in conversation {ConversationId}", ex.GetType().Name, conversation.Id);

                // The session is only saved by a turn that finished, so the model-side history never holds half a turn.
                var survivor = turn.Kind == HelplyTurnKind.Approvals ? original : Survivor(original, turn, userMessage, assistant, failed: !aborted);
                Commit(conversation, survivor, title, null);
                if (!aborted)
                    await Emit(new HelplyEvent("error", new { message = timedOut ? "Helply took too long to answer." : GenericError, code = timedOut ? "timeout" : "unavailable", retryable = turn.Kind != HelplyTurnKind.Approvals }));
                await store.SaveAsync(CancellationToken.None);
                return;
            }

            try
            {
                await store.SaveAsync(CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogWarning("Helply could not save conversation {ConversationId} ({Error})", conversation.Id, ex.GetType().Name);
                await Emit(new HelplyEvent("error", new { message = GenericError, code = "unavailable", retryable = false }));
                return;
            }
            await Emit(new HelplyEvent("done", new { messageId = assistant.Id, awaitingApproval = awaiting, title }));
        }

        private static object HelplyDtoShape(HelplyStoredApproval a) => new { approvalId = a.ApprovalId, toolLabel = a.ToolLabel, summary = a.Summary, details = a.Details.Select(d => new { label = d.Label, value = d.Value }).ToList(), destructive = a.Destructive };

        // What the transcript looks like after a turn that did not finish: the old conversation, the user's message, and the assistant's partial answer (flagged as failed unless the user stopped it).
        private static HelplyTranscript Survivor(HelplyTranscript original, HelplyTurn turn, HelplyStoredMessage? userMessage, HelplyStoredMessage assistant, bool failed)
        {
            assistant.Failed = failed;
            if (turn.Kind == HelplyTurnKind.Retry)
                original.Messages.RemoveAt(original.Messages.Count - 1);
            if (userMessage is not null)
                original.Messages.Add(userMessage);
            original.Messages.Add(assistant);
            return original;
        }

        private void Commit(HelplyConversation conversation, HelplyTranscript transcript, string title, string? sessionJson)
        {
            store.WriteTranscript(conversation, transcript);
            store.WriteTitle(conversation, title);
            if (sessionJson is not null)
                store.WriteSession(conversation, sessionJson);
            store.Touch(conversation);
        }

        private async Task<AgentSession> RestoreSessionAsync(AIAgent agent, HelplyConversation conversation, CancellationToken ct)
        {
            if (store.ReadSession(conversation) is { } json)
            {
                try
                {
                    using var document = JsonDocument.Parse(json);
                    return await agent.DeserializeSessionAsync(document.RootElement.Clone(), null, ct);
                }
                catch (JsonException)
                {
                    // A session the framework can no longer read starts over rather than locking the conversation.
                }
            }
            return await agent.CreateSessionAsync(ct);
        }

        private static HelplyStoredTool AddTool(HelplyStoredMessage message, string callId, string label)
        {
            var tool = new HelplyStoredTool { Id = callId, Label = label, Status = HelplyToolStatus.Running };
            message.Tools.Add(tool);
            return tool;
        }

        private static void AddFinishedTool(HelplyTranscript transcript, HelplyStoredApproval pending, string status)
        {
            var message = transcript.Messages.FirstOrDefault(m => m.Id == pending.MessageId);
            message?.Tools.Add(new HelplyStoredTool { Id = pending.ToolCallId, Label = pending.ToolLabel, Status = status });
        }

        private HelplyStoredApproval BuildApproval(ToolApprovalRequestContent request, FunctionCallContent call, HelplyToolSet toolSet, Guid messageId, HelplyRedactor redactor)
        {
            toolSet.Info.TryGetValue(call.Name, out var info);
            var title = info?.Title ?? call.Name;
            var labels = HelplyToolLabels.For(call.Name, title);
            var (toolLabel, summary, details) = HelplyToolLabels.Approval(call.Name, title, call.Arguments);
            foreach (var detail in details)
                detail.Value = redactor.Redact(detail.Value);
            return new HelplyStoredApproval
            {
                ApprovalId = request.RequestId,
                ToolName = call.Name,
                ToolCallId = call.CallId,
                ToolLabel = toolLabel,
                RunningLabel = labels.Running,
                DoneLabel = labels.Done,
                Summary = redactor.Redact(summary),
                Details = details,
                Destructive = info?.Destructive ?? true,
                MessageId = messageId,
                Request = JsonSerializer.Serialize<AIContent>(request, ContentJson),
            };
        }

        private static ToolApprovalResponseContent Response(HelplyStoredApproval pending, bool approved)
        {
            var request = (ToolApprovalRequestContent)JsonSerializer.Deserialize<AIContent>(pending.Request, ContentJson)!;
            return request.CreateResponse(approved, approved ? null : "The user declined this action.");
        }

        private static bool IsError(FunctionResultContent result)
        {
            if (result.Exception is not null)
                return true;
            return result.Result switch
            {
                JsonElement { ValueKind: JsonValueKind.Object } e => e.TryGetProperty("isError", out var flag) && flag.ValueKind == JsonValueKind.True,
                _ => false,
            };
        }

        private DateTimeOffset Now()
        {
            var utc = time.GetUtcNow();
            try
            {
                return TimeZoneInfo.ConvertTime(utc, TimeZoneInfo.FindSystemTimeZoneById("Europe/Zurich"));
            }
            catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
            {
                return utc;
            }
        }

        public static string AutoTitle(string firstMessage)
        {
            var oneLine = string.Join(' ', firstMessage.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            return oneLine.Length <= TitleLength ? oneLine : oneLine[..TitleLength].TrimEnd() + "...";
        }
    }
}
