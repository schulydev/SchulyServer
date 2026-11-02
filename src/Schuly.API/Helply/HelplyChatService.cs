using System.Globalization;
using System.ClientModel;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using Schuly.Domain.Helply;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Helply;
using Schuly.Plugin.Abstractions;
using Microsoft.EntityFrameworkCore;

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
    public sealed class HelplyTurn(Guid userId, HelplyConversation conversation, HelplyTurnKind kind, string? text, IReadOnlyList<HelplyDecision> decisions, IReadOnlyList<Guid> attachmentIds, IDisposable turnLock) : IDisposable
    {
        public Guid UserId { get; } = userId;
        public HelplyConversation Conversation { get; } = conversation;
        public HelplyTurnKind Kind { get; } = kind;
        public string? Text { get; } = text;
        public IReadOnlyList<HelplyDecision> Decisions { get; } = decisions;
        public IReadOnlyList<Guid> AttachmentIds { get; } = attachmentIds;

        public void Dispose() => turnLock.Dispose();
    }

    /// <summary>Why a turn could not start: a plain HTTP status, a generic message, and for 429 how long to wait.</summary>
    public sealed record HelplyRefusal(int Status, string Detail, TimeSpan? RetryAfter = null);

    /// <summary>
    /// Runs one Helply turn on the Microsoft Agent Framework and reports it as events. The agent only has the tools MCP lists for the user's Helply permissions, plus the workspace
    /// tools when the user turned the workspace on and the server has a sandbox; calls that are not read-only stop for the user's approval. The model id, gateway address and key
    /// never leave this class: only redacted text and tool labels become events, and a failure is logged by exception type alone.
    /// </summary>
    public sealed class HelplyChatService(HelplyConversationStore store, HelplyGateway gateway, HelplyMcpConnector connector, HelplyRateLimiter limiter, SchulyDbContext db, HelplyTurnLocks locks, IOptions<HelplyLimits> limitOptions, IOptions<HelplyAttachmentOptions> attachmentOptions, IHelplySandboxClient sandbox, IOptions<HelplySandboxOptions> sandboxOptions, HelplySandboxQuota quota, HelplyNativeFiles nativeFiles, TimeProvider time, ILogger<HelplyChatService> logger)
    {
        public const string GenericError = "Helply couldn't answer right now.";
        public const int TitleLength = 60;

        /// <summary>How much of a command and of its output the user can inspect on the "Ran code" chip.</summary>
        public const int MaxShownCommandChars = 4_000;
        public const int MaxShownOutputChars = 4_000;

        private static readonly JsonSerializerOptions ContentJson = Microsoft.Extensions.AI.AIJsonUtilities.DefaultOptions;

        private HelplyLimits Limits => limitOptions.Value;

        /// <summary>Checks everything that can be refused with a plain HTTP status, in the order the API promises, and takes the conversation's lock.</summary>
        public async Task<(HelplyTurn? Turn, HelplyRefusal? Refusal)> BeginAsync(Guid userId, Guid conversationId, HelplyTurnKind kind, string? text, IReadOnlyList<HelplyDecision>? decisions, CancellationToken ct) => await BeginAsync(userId, conversationId, kind, text, decisions, null, ct);

        public async Task<(HelplyTurn? Turn, HelplyRefusal? Refusal)> BeginAsync(Guid userId, Guid conversationId, HelplyTurnKind kind, string? text, IReadOnlyList<HelplyDecision>? decisions, IReadOnlyList<Guid>? attachmentIds, CancellationToken ct)
        {
            attachmentIds ??= [];
            if (kind == HelplyTurnKind.Message)
            {
                var trimmed = text?.Trim() ?? string.Empty;
                if (trimmed.Length == 0 && attachmentIds.Count == 0)
                    return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Write a message first."));
                if (trimmed.Length > Limits.MaxInputChars)
                    return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, $"A message can be at most {Limits.MaxInputChars} characters."));
                if (attachmentIds.Count > HelplyAttachmentStore.MaxPerMessage)
                    return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, $"A message can carry at most {HelplyAttachmentStore.MaxPerMessage} files."));
                text = trimmed;
            }
            else if (attachmentIds.Count > 0)
                return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Only a new message can carry files."));
            if (kind == HelplyTurnKind.Approvals && decisions is not { Count: > 0 })
                return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Send at least one decision."));

            var conversation = await store.FindAsync(userId, conversationId, ct);
            if (conversation is null)
                return (null, new HelplyRefusal(StatusCodes.Status404NotFound, "Conversation not found"));

            if (attachmentIds.Count > 0 && !await store.Attachments.ArePendingAsync(userId, conversationId, attachmentIds, ct))
                return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Some files are no longer available. Attach them again."));

            var transcript = store.ReadTranscript(conversation);
            if (kind == HelplyTurnKind.Approvals)
            {
                var pending = transcript.Pending.Select(p => p.ApprovalId).ToHashSet(StringComparer.Ordinal);
                var answered = decisions!.Select(d => d.ApprovalId).ToHashSet(StringComparer.Ordinal);
                if (answered.Count != decisions!.Count || !answered.SetEquals(pending))
                    return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "Answer every pending approval exactly once."));
                // What would run must still be exactly what the user was shown.
                foreach (var decision in decisions!.Where(d => d.Approved))
                    if (!HelplyApprovalHash.Matches(transcript.Pending.First(p => p.ApprovalId == decision.ApprovalId), ContentJson))
                        return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "This approval no longer matches the action. Ask Helply again."));
            }
            if (kind == HelplyTurnKind.Retry && !(transcript.Messages is [.., { Role: "user" }, { Role: "assistant", Failed: true }]))
                return (null, new HelplyRefusal(StatusCodes.Status400BadRequest, "There is nothing to retry."));

            if (!limiter.TryAcquire(userId, out var retryAfter))
                return (null, new HelplyRefusal(StatusCodes.Status429TooManyRequests, "You are sending messages too quickly. Please wait a moment.", retryAfter));

            var turnLock = locks.TryEnter(conversationId);
            if (turnLock is null)
                return (null, new HelplyRefusal(StatusCodes.Status409Conflict, "Helply is still answering in this conversation."));

            return (new HelplyTurn(userId, conversation, kind, text, decisions ?? [], attachmentIds, turnLock), null);
        }

        public async Task RunAsync(HelplyTurn turn, Func<HelplyEvent, Task> emit, CancellationToken requestAborted)
        {
            var conversation = turn.Conversation;
            var original = store.ReadTranscript(conversation);
            var work = store.ReadTranscript(conversation);
            var redactor = gateway.Redactor();

            var workspaceOn = sandbox.IsConfigured && await store.GetWorkspaceEnabledAsync(turn.UserId, requestAborted);
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
            cts.CancelAfter(TimeSpan.FromSeconds(Math.Max(5, workspaceOn ? Limits.RunTimeoutSecondsWithWorkspace : Limits.RunTimeoutSeconds)));
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
            HelplyWorkspaceTools? workspace = null;
            var stored = new List<HelplyAttachmentInfo>();

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
                        userText = turn.Text ?? string.Empty;
                        userMessage = new HelplyStoredMessage { Id = Guid.NewGuid(), Role = "user", Text = userText, CreatedAt = assistant.CreatedAt };
                        var bound = await store.Attachments.BindAsync(turn.UserId, conversation.Id, turn.AttachmentIds, userMessage.Id, cts.Token) ?? throw new InvalidOperationException("The attachments changed.");
                        userMessage.Attachments = bound.Select(a => a.ToStored()).ToList();
                        work.Messages.Add(userMessage);
                        work.Messages.Add(assistant);
                        if (original.Messages.All(m => m.Role != "user") && title == HelplyConversationStore.DefaultTitle)
                            title = AutoTitle(userText.Length > 0 ? userText : bound[0].FileName);
                        input.Add(UserInput(userText, userMessage.Attachments));
                        break;
                    case HelplyTurnKind.Retry:
                        work.Messages.RemoveAt(work.Messages.Count - 1);
                        var retried = work.Messages[^1];
                        userText = retried.Text;
                        work.Messages.Add(assistant);
                        input.Add(UserInput(userText, retried.Attachments));
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
                    await Emit(new HelplyEvent("tool_finished", new { id = denied.ToolCallId, label = denied.ToolLabel, status = HelplyToolStatus.Denied, at = assistant.Text.Length }));
                }
                foreach (var tool in started)
                    await Emit(new HelplyEvent("tool_started", ToolEvent(tool)));

                var connection = await gateway.ConnectAsync(cts.Token);
                redactor = connection.Redactor;
                var permissions = await store.GetPermissionsAsync(turn.UserId, cts.Token);
                var guard = new HelplyApprovalGuard();
                if (turn.Kind == HelplyTurnKind.Approvals)
                    foreach (var decision in turn.Decisions.Where(d => d.Approved))
                        guard.Approve(original.Pending.First(p => p.ApprovalId == decision.ApprovalId).ArgumentsHash);
                await using var toolSet = await connector.ConnectAsync(turn.UserId, permissions, guard, cts.Token);

                // The conversation's files: every sent one, plus the ones this message just bound (still unsaved, so the query sees them as pending).
                var justBound = userMessage?.Attachments.Select(a => a.Id).ToHashSet() ?? [];
                var files = (await store.Attachments.ListAsync(turn.UserId, conversation.Id, cts.Token)).Where(a => a.MessageId is not null || justBound.Contains(a.Id)).ToList();
                var attachments = new HelplyAttachmentContext(files, (id, ct) => store.Attachments.ReadDataAsync(turn.UserId, conversation.Id, id, ct), (id, ct) => store.Attachments.ReadTextAsync(turn.UserId, conversation.Id, id, ct))
                {
                    Policy = new HelplyContentPolicy(attachmentOptions.Value.NativeImages && !nativeFiles.Rejected, attachmentOptions.Value.NativePdf && !nativeFiles.Rejected, workspaceOn, Limits.MaxAttachmentTextChars),
                    MaxTotalTextChars = Limits.MaxAttachmentTextTotalChars,
                    MaxNativeBytes = Limits.MaxNativeBytesPerRequest,
                };
                var leaks = new HelplyLeakDetector();
                if (workspaceOn)
                {
                    workspace = new HelplyWorkspaceTools(sandbox, quota, conversation.Id, turn.UserId, attachments, assistant.Attachments.Count, Math.Clamp(sandboxOptions.Value.MaxCommandSeconds, 1, 120), leaks);
                    toolSet.AddLocal(workspace.Create(), HelplyWorkspaceTools.Info);
                }

                IReadOnlyCollection<string>? ownDomains = null;
                var leaksSeeded = false;
                var instructions = HelplyPrompt.System(Now()) + (workspaceOn ? HelplyWorkspaceTools.Prompt : string.Empty) + HelplyPrompt.Files(files.Where(f => !f.FromAssistant).Select(f => f.FileName));
                var agent = HelplyAgentFactory.Create(connection.Chat, Limits, instructions, toolSet.Tools, attachments, workspaceOn ? Limits.MaxToolIterationsWithWorkspace : Limits.MaxToolIterations);

                var text = redactor.CreateStream();
                var needsSeparator = turn.Kind == HelplyTurnKind.Approvals && assistant.Text.Length > 0;
                var produced = false;

                // Sends redacted text to the user, after a blank line when it follows a tool call or an approval.
                async Task EmitText(string safe)
                {
                    if (safe.Length == 0)
                        return;
                    produced = true;
                    if (needsSeparator && assistant.Text.Length > 0 && !char.IsWhiteSpace(assistant.Text[^1]))
                        safe = "\n\n" + safe;
                    needsSeparator = false;
                    assistant.Text += safe;
                    await Emit(new HelplyEvent("delta", new { text = safe }));
                }

                for (var attempt = 0; ; attempt++)
                {
                    var session = await RestoreSessionAsync(agent, conversation, cts.Token);
                    try
                    {
                        await foreach (var update in agent.RunStreamingAsync(input, session, null, cts.Token))
                        {
                            foreach (var content in update.Contents)
                            {
                                switch (content)
                                {
                                    case TextContent { Text.Length: > 0 } piece:
                                        await EmitText(text.Push(piece.Text));
                                        break;
                                    case FunctionCallContent call when toolSet.Info.TryGetValue(call.Name, out var info) && !info.NeedsApproval && assistant.Tools.All(t => t.Id != call.CallId):
                                        produced = true;
                                        // The text before a call is a finished stretch: send all of it, so the step's place ("at") is where the user's text ends.
                                        await EmitText(text.Flush());
                                        var labels = HelplyToolLabels.For(info.Name, info.Title);
                                        var tool = AddTool(assistant, call.CallId, labels.Running, HelplyToolLabels.Detail(call.Name, call.Arguments));
                                        if (call.Name == "bash" && toolSet.IsLocal(call.Name))
                                            tool.Code = new HelplyStoredCodeRun { Command = Shown(redactor, HelplyToolLabels.Text(call.Arguments, "command") ?? string.Empty, MaxShownCommandChars) };
                                        finishLabels[call.CallId] = (labels.Done, info.Title);
                                        needsSeparator = true;
                                        await Emit(new HelplyEvent("tool_started", ToolEvent(tool)));
                                        break;
                                    case FunctionResultContent result when assistant.Tools.FirstOrDefault(t => t.Id == result.CallId) is { Status: HelplyToolStatus.Running } running:
                                        var resultText = running.Code is not null ? HelplyToolInvoker.ResultText(result.Result) : null;
                                        var failed = IsError(result) || resultText?.StartsWith("Error:", StringComparison.Ordinal) == true;
                                        running.Status = failed ? HelplyToolStatus.Failed : HelplyToolStatus.Done;
                                        running.Label = finishLabels.TryGetValue(running.Id, out var done) ? (failed ? done.Failed : done.Done) : running.Label;
                                        if (running.Code is not null)
                                        {
                                            running.Code.ExitCode = HelplyWorkspaceTools.ExitCodeOf(resultText);
                                            running.Code.Output = Shown(redactor, resultText ?? string.Empty, MaxShownOutputChars);
                                        }
                                        await Emit(new HelplyEvent("tool_finished", ToolEvent(running)));
                                        break;
                                    case ToolApprovalRequestContent request when request.ToolCall is FunctionCallContent approvalCall:
                                        produced = true;
                                        await EmitText(text.Flush());
                                        ownDomains ??= await OwnDomainsAsync(turn.UserId, cts.Token);
                                        if (!leaksSeeded)
                                        {
                                            leaksSeeded = true;
                                            foreach (var file in files.Where(f => f.HasText))
                                                leaks.AddSource(await attachments.TextAsync(file.Id, cts.Token));
                                        }
                                        var approval = await BuildApprovalAsync(request, approvalCall, toolSet, assistant.Id, redactor, ownDomains, leaks, cts.Token);
                                        work.Pending.Add(approval);
                                        needsSeparator = true;
                                        await Emit(new HelplyEvent("approval_required", HelplyDtoShape(approval)));
                                        break;
                                }
                            }
                        }
                        sessionJson = (await agent.SerializeSessionAsync(session, null, cts.Token)).GetRawText();
                        break;
                    }
                    catch (ClientResultException ex) when (attempt == 0 && !produced && attachments.SentNative && ex.Status is 400 or 413 or 415 or 422)
                    {
                        // The gateway refused a request that carried files: send the same turn again with text only, and keep files as text from now on.
                        nativeFiles.MarkRejected();
                        attachments.AllowNative = false;
                    }
                }

                await EmitText(text.Flush());
                foreach (var stale in assistant.Tools.Where(t => t.Status == HelplyToolStatus.Running))
                    stale.Status = HelplyToolStatus.Done;

                foreach (var shared in workspace?.Shared ?? [])
                {
                    var info = await store.Attachments.AddSharedAsync(turn.UserId, conversation.Id, assistant.Id, shared.FileName, shared.MediaType, shared.Data, cts.Token);
                    assistant.Attachments.Add(info.ToStored());
                    stored.Add(info);
                }

                awaiting = work.Pending.Count > 0;
                Commit(conversation, work, title, sessionJson);
            }
            catch (Exception ex)
            {
                var aborted = requestAborted.IsCancellationRequested || clientGone;
                var timedOut = !aborted && ex is OperationCanceledException or TimeoutException && cts.IsCancellationRequested;
                if (!aborted)
                    logger.LogWarning("Helply turn failed ({Error}, HTTP status {Status}) in conversation {ConversationId}", ex.GetType().Name, StatusOf(ex)?.ToString() ?? "none", conversation.Id);

                // The session is only saved by a turn that finished, so the model-side history never holds half a turn.
                var survivor = turn.Kind == HelplyTurnKind.Approvals ? original : Survivor(original, turn, userMessage, assistant, failed: !aborted);
                Commit(conversation, survivor, title, null);
                if (!aborted)
                    await Emit(new HelplyEvent("error", new { message = timedOut ? "Helply took too long to answer." : GenericError, code = timedOut ? "timeout" : "unavailable", retryable = turn.Kind != HelplyTurnKind.Approvals }));
                await DiscardSharedAsync();
                await store.SaveAsync(CancellationToken.None);
                await WipeWorkspaceAsync(workspace, conversation.Id);
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
                await WipeWorkspaceAsync(workspace, conversation.Id);
                return;
            }
            // A reply that waits for an approval keeps its workspace until it goes on; the sidecar's idle timeout removes it if the user never answers.
            if (!awaiting)
                await WipeWorkspaceAsync(workspace, conversation.Id);
            foreach (var file in stored)
                await Emit(new HelplyEvent("file", new { messageId = assistant.Id, id = file.Id, fileName = file.FileName, mediaType = file.MediaType, sizeBytes = file.SizeBytes }));
            await Emit(new HelplyEvent("done", new { messageId = assistant.Id, awaitingApproval = awaiting, title }));

            // Shared files queued for a reply that then failed are never written.
            Task DiscardSharedAsync()
            {
                foreach (var entry in db.ChangeTracker.Entries<HelplyAttachment>().Where(e => e.State == EntityState.Added).ToList())
                    entry.State = EntityState.Detached;
                foreach (var entry in db.ChangeTracker.Entries<HelplyAttachmentContent>().Where(e => e.State == EntityState.Added).ToList())
                    entry.State = EntityState.Detached;
                return Task.CompletedTask;
            }
        }

        /// <summary>Removes the conversation's workspace once its reply is over. Best effort: the sidecar's idle timeout and sweep catch anything this misses.</summary>
        private async Task WipeWorkspaceAsync(HelplyWorkspaceTools? workspace, Guid conversationId)
        {
            if (workspace is not { Used: true })
                return;
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                await sandbox.DeleteAsync(conversationId, timeout.Token);
            }
            catch (Exception ex)
            {
                logger.LogWarning("Helply could not wipe the workspace of conversation {ConversationId} ({Error})", conversationId, ex.GetType().Name);
            }
        }

        /// <summary>The user's message for the model: their text and one marker per attached file, which the attachment expander replaces with the file's content on every request.</summary>
        public static ChatMessage UserInput(string text, IEnumerable<HelplyStoredAttachment> attachments)
        {
            var contents = new List<AIContent>();
            if (text.Length > 0)
                contents.Add(new TextContent(text));
            foreach (var attachment in attachments)
                contents.Add(new TextContent(HelplyAttachmentStrategy.Marker(attachment.Id)));
            if (contents.Count == 0)
                contents.Add(new TextContent(string.Empty));
            return new ChatMessage(ChatRole.User, contents);
        }

        /// <summary>The HTTP status behind a failure (an MCP connect or a gateway call), for the log. Only the number: never a body, URL, model or key.</summary>
        public static int? StatusOf(Exception? ex)
        {
            for (var current = ex; current is not null; current = current.InnerException)
            {
                if (current is HttpRequestException { StatusCode: { } status })
                    return (int)status;
                if (current is ClientResultException { Status: > 0 } client)
                    return client.Status;
            }
            return null;
        }

        private static string Shown(HelplyRedactor redactor, string text, int max) => redactor.Redact(text.Length <= max ? text : text[..max] + "\n...");

        /// <summary>A tool step as the user sees it. <c>at</c> is how much of the reply's text came before the step, so the chat can place the step between the stretches of text it came between.</summary>
        private static object ToolEvent(HelplyStoredTool tool) => new { id = tool.Id, label = tool.Label, status = tool.Status, at = tool.At, detail = tool.Detail, code = tool.Code is null ? null : new { command = tool.Code.Command, output = tool.Code.Output, exitCode = tool.Code.ExitCode } };

        private static object HelplyDtoShape(HelplyStoredApproval a) => new { approvalId = a.ApprovalId, toolLabel = a.ToolLabel, summary = a.Summary, details = a.Details.Select(d => new { label = d.Label, value = d.Value }).ToList(), destructive = a.Destructive, arguments = a.Arguments.Select(d => new { label = d.Label, value = d.Value }).ToList(), risk = a.Risk, riskReasons = a.RiskReasons };

        // What the transcript looks like after a turn that did not finish: the old conversation, the user's message, and the assistant's partial answer (flagged as failed unless the user stopped it).
        private static HelplyTranscript Survivor(HelplyTranscript original, HelplyTurn turn, HelplyStoredMessage? userMessage, HelplyStoredMessage assistant, bool failed)
        {
            assistant.Failed = failed;
            assistant.Attachments.Clear();
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

        private static HelplyStoredTool AddTool(HelplyStoredMessage message, string callId, string label, string? detail = null)
        {
            var tool = new HelplyStoredTool { Id = callId, Label = label, Status = HelplyToolStatus.Running, At = message.Text.Length, Detail = detail };
            message.Tools.Add(tool);
            return tool;
        }

        private static void AddFinishedTool(HelplyTranscript transcript, HelplyStoredApproval pending, string status)
        {
            var message = transcript.Messages.FirstOrDefault(m => m.Id == pending.MessageId);
            message?.Tools.Add(new HelplyStoredTool { Id = pending.ToolCallId, Label = pending.ToolLabel, Status = status, At = message.Text.Length });
        }

        /// <summary>The mail domains of the user's linked Microsoft accounts: addresses on them count as inside the school.</summary>
        private async Task<IReadOnlyCollection<string>> OwnDomainsAsync(Guid userId, CancellationToken ct)
        {
            var emails = await db.LinkedAccounts.AsNoTracking().Where(a => a.ApplicationUserId == userId && a.Provider == LinkedProviders.Microsoft).Select(a => a.Email).ToListAsync(ct);
            return emails.Select(HelplyApprovalRisk.DomainOf).Where(d => d.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        private async Task<HelplyStoredApproval> BuildApprovalAsync(ToolApprovalRequestContent request, FunctionCallContent call, HelplyToolSet toolSet, Guid messageId, HelplyRedactor redactor, IReadOnlyCollection<string> ownDomains, HelplyLeakDetector leaks, CancellationToken ct)
        {
            toolSet.Info.TryGetValue(call.Name, out var info);
            var title = info?.Title ?? call.Name;
            var labels = HelplyToolLabels.For(call.Name, title);
            var target = await HelplyApprovalTargets.ResolveAsync(toolSet, call.Name, call.Arguments, ct);
            var (toolLabel, summary, details) = HelplyToolLabels.Approval(call.Name, title, call.Arguments, target);
            var arguments = HelplyToolLabels.AllArguments(call.Name, call.Arguments);
            var (risk, reasons) = HelplyApprovalRisk.Assess(call.Name, call.Arguments, ownDomains);
            foreach (var reason in OutgoingContentRisks(call, arguments, leaks, Limits.MaxToolArgumentChars))
            {
                reasons.Add(reason);
                risk = HelplyApprovalRisk.High;
            }
            foreach (var row in details.Concat(arguments))
                row.Value = redactor.Redact(row.Value);
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
                Arguments = arguments,
                Risk = risk,
                RiskReasons = reasons.Select(redactor.Redact).ToList(),
                ArgumentsHash = HelplyApprovalHash.Compute(call.Name, call.Arguments),
                Destructive = info?.Destructive ?? true,
                MessageId = messageId,
                Request = JsonSerializer.Serialize<AIContent>(request, ContentJson),
            };
        }

        /// <summary>Warnings for an approval about what the call would send: arguments over the size cap (it will be refused), and long passages copied from the user's files or the workspace.</summary>
        public static IEnumerable<string> OutgoingContentRisks(FunctionCallContent call, IEnumerable<HelplyStoredDetail> arguments, HelplyLeakDetector leaks, int maxArgumentChars)
        {
            var size = HelplyToolInvoker.ArgumentChars(call.Arguments);
            if (size > maxArgumentChars)
                yield return string.Create(CultureInfo.InvariantCulture, $"Too large to send ({size:N0} characters, the limit is {maxArgumentChars:N0}); it will not run even if you approve it");
            var copied = leaks.CopiedChars(string.Join("\n", arguments.Select(a => a.Value)));
            if (copied >= HelplyLeakDetector.FlagAtChars)
                yield return string.Create(CultureInfo.InvariantCulture, $"Contains a long passage (about {copied:N0} characters) copied from your files or Helply's workspace");
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
