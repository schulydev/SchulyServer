using Schuly.Domain.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Helply;

namespace Schuly.Application.Dtos
{
    /// <summary>What Helply may use. <c>WorkspaceAvailable</c> says whether this server has a sandbox at all; without it the workspace switch does nothing.</summary>
    public record HelplySettingsDto(McpPermissionSet Permissions, bool Workspace, bool WorkspaceAvailable, HelplyReasoningEffort ReasoningEffort);

    public record HelplyAttachmentDto(Guid Id, string FileName, string MediaType, long SizeBytes);

    public record HelplyCodeRunDto(string Command, string? Output, int? ExitCode);

    public record HelplyConversationSummaryDto(Guid Id, string Title, DateTime CreatedAt, DateTime UpdatedAt, DateTime ExpiresAt);

    public record HelplyToolActivityDto(string Id, string Label, string Status, HelplyCodeRunDto? Code, int? At, string? Detail);

    public record HelplyMessageDto(Guid Id, string Role, string Text, DateTime CreatedAt, IReadOnlyList<HelplyToolActivityDto> Tools, bool Failed, IReadOnlyList<HelplyAttachmentDto> Attachments);

    public record HelplyApprovalDetailDto(string Label, string Value);

    public record HelplyApprovalRequestDto(string ApprovalId, string ToolLabel, string Summary, IReadOnlyList<HelplyApprovalDetailDto> Details, bool Destructive, IReadOnlyList<HelplyApprovalDetailDto> Arguments, string Risk, IReadOnlyList<string> RiskReasons);

    public record HelplyConversationDto(Guid Id, string Title, DateTime CreatedAt, DateTime UpdatedAt, DateTime ExpiresAt, IReadOnlyList<HelplyMessageDto> Messages, IReadOnlyList<HelplyApprovalRequestDto> PendingApprovals);

    /// <summary>Maps the decrypted stored shapes to what the API returns. Nothing from the framework's session or the stored approval request ever leaves through here.</summary>
    public static class HelplyDtoMapper
    {
        public static HelplySettingsDto ToDto(McpPermissionSet permissions, bool workspace, bool workspaceAvailable, HelplyReasoningEffort reasoningEffort) => new(permissions, workspace, workspaceAvailable, reasoningEffort);

        public static HelplyAttachmentDto ToDto(HelplyStoredAttachment a) => new(a.Id, a.FileName, a.MediaType, a.SizeBytes);

        public static HelplyAttachmentDto ToDto(HelplyAttachmentInfo a) => new(a.Id, a.FileName, a.MediaType, a.SizeBytes);

        public static HelplyToolActivityDto ToDto(HelplyStoredTool t) => new(t.Id, t.Label, t.Status, t.Code is null ? null : new HelplyCodeRunDto(t.Code.Command, t.Code.Output, t.Code.ExitCode), t.At, t.Detail);

        public static HelplyConversationSummaryDto ToSummary(HelplyConversation c, string title) => new(c.Id, title, c.CreatedAt, c.LastActivityAt, c.ExpiresAt);

        public static HelplyApprovalRequestDto ToDto(HelplyStoredApproval a) => new(a.ApprovalId, a.ToolLabel, a.Summary, a.Details.Select(d => new HelplyApprovalDetailDto(d.Label, d.Value)).ToList(), a.Destructive, a.Arguments.Select(d => new HelplyApprovalDetailDto(d.Label, d.Value)).ToList(), a.Risk, a.RiskReasons.ToList());

        public static HelplyConversationDto ToDto(HelplyConversation c, string title, HelplyTranscript transcript) => new(
            c.Id,
            title,
            c.CreatedAt,
            c.LastActivityAt,
            c.ExpiresAt,
            transcript.Messages.Select(m => new HelplyMessageDto(m.Id, m.Role, m.Text, m.CreatedAt, m.Tools.Select(ToDto).ToList(), m.Failed, m.Attachments.Select(ToDto).ToList())).ToList(),
            transcript.Pending.Select(ToDto).ToList());
    }
}
