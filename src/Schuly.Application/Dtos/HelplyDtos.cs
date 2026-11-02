using Schuly.Domain.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Helply;

namespace Schuly.Application.Dtos
{
    public record HelplySettingsDto(McpPermissionSet Permissions);

    public record HelplyConversationSummaryDto(Guid Id, string Title, DateTime CreatedAt, DateTime UpdatedAt, DateTime ExpiresAt);

    public record HelplyToolActivityDto(string Id, string Label, string Status);

    public record HelplyMessageDto(Guid Id, string Role, string Text, DateTime CreatedAt, IReadOnlyList<HelplyToolActivityDto> Tools, bool Failed);

    public record HelplyApprovalDetailDto(string Label, string Value);

    public record HelplyApprovalRequestDto(string ApprovalId, string ToolLabel, string Summary, IReadOnlyList<HelplyApprovalDetailDto> Details, bool Destructive, IReadOnlyList<HelplyApprovalDetailDto> Arguments, string Risk, IReadOnlyList<string> RiskReasons);

    public record HelplyConversationDto(Guid Id, string Title, DateTime CreatedAt, DateTime UpdatedAt, DateTime ExpiresAt, IReadOnlyList<HelplyMessageDto> Messages, IReadOnlyList<HelplyApprovalRequestDto> PendingApprovals);

    /// <summary>Maps the decrypted stored shapes to what the API returns. Nothing from the framework's session or the stored approval request ever leaves through here.</summary>
    public static class HelplyDtoMapper
    {
        public static HelplySettingsDto ToDto(McpPermissionSet permissions) => new(permissions);

        public static HelplyConversationSummaryDto ToSummary(HelplyConversation c, string title) => new(c.Id, title, c.CreatedAt, c.LastActivityAt, c.ExpiresAt);

        public static HelplyApprovalRequestDto ToDto(HelplyStoredApproval a) => new(a.ApprovalId, a.ToolLabel, a.Summary, a.Details.Select(d => new HelplyApprovalDetailDto(d.Label, d.Value)).ToList(), a.Destructive, a.Arguments.Select(d => new HelplyApprovalDetailDto(d.Label, d.Value)).ToList(), a.Risk, a.RiskReasons.ToList());

        public static HelplyConversationDto ToDto(HelplyConversation c, string title, HelplyTranscript transcript) => new(
            c.Id,
            title,
            c.CreatedAt,
            c.LastActivityAt,
            c.ExpiresAt,
            transcript.Messages.Select(m => new HelplyMessageDto(m.Id, m.Role, m.Text, m.CreatedAt, m.Tools.Select(t => new HelplyToolActivityDto(t.Id, t.Label, t.Status)).ToList(), m.Failed)).ToList(),
            transcript.Pending.Select(ToDto).ToList());
    }
}
