using System.Text.Json;
using Schuly.Domain.Mcp;

namespace Schuly.Application.Dtos
{
    public class AccountExportDto
    {
        /// <summary>What the file leaves out, and how to get it. It is part of the file so nobody takes the export for more than it is.</summary>
        public static readonly IReadOnlyList<string> NotIncludedItems =
        [
            "Document files and profile pictures: download them in the app, or ask at privacy@schuly.dev. This file lists the documents, not their contents.",
            "Files attached to Helply chats: download them in the chat, or ask at privacy@schuly.dev. This file lists their names and sizes.",
            "Secrets such as passwords, stored school logins, tokens and two-factor secrets: never exported.",
            "Server logs: ask at privacy@schuly.dev.",
        ];

        public DateTime ExportedAt { get; set; }
        public required ApplicationUserDto Profile { get; set; }
        public List<SchoolUserDto> SchoolUsers { get; set; } = [];
        public List<AgendaEntryDto> AgendaEntries { get; set; } = [];
        public List<SemesterReportDto> SemesterReports { get; set; } = [];
        public List<StudentDocumentDto> Documents { get; set; } = [];
        public List<LinkedAccountDto> LinkedAccounts { get; set; } = [];

        public ExportPrivacyNoticeDto? PrivacyNotice { get; set; }
        public ExportSignInDto? SignIn { get; set; }

        /// <summary>The accounts the plugins hold for this user, such as a school system and its address. Filled in by the API, which can reach the plugins.</summary>
        public List<ExportConnectedAccountDto> ConnectedAccounts { get; set; } = [];

        public ExportHelplyDto? Helply { get; set; }
        public ExportAiAppsDto? AiApps { get; set; }
        public ExportNotificationsDto? Notifications { get; set; }
        public IReadOnlyList<string> NotIncluded { get; set; } = NotIncludedItems;
    }

    public record ExportPrivacyNoticeDto(string? AcceptedVersion, DateTime? AcceptedAt, DateTime? SwissSchoolConfirmedAt);

    public record ExportSignInDto(string? UserName, string? Email, DateTimeOffset? EmailConfirmedAt, DateTime? LastSeenAt, bool TwoFactorEnabled, List<ExportExternalLoginDto> ExternalLogins, List<ExportPasskeyDto> Passkeys, List<ExportSessionDto> Sessions, List<ExportSessionDto> TrustedDevices, List<ExportSecurityEventDto> SecurityEvents);

    public record ExportSecurityEventDto(string Kind, string? Detail, DateTime OccurredAt);

    public record ExportExternalLoginDto(string ProviderKey, string? Email, DateTimeOffset CreatedAt, DateTimeOffset? LastSignInAt);

    public record ExportPasskeyDto(string? Label, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt);

    /// <summary>An active sign-in session or trusted device, with the address and browser the sign-in library keeps for it.</summary>
    public record ExportSessionDto(string? Label, string? IpAddress, string? UserAgent, DateTimeOffset CreatedAt, DateTimeOffset LastUsedAt);

    public record ExportConnectedAccountDto(string Provider, string Title, string? Detail, string Status, DateTimeOffset? LinkedAt, DateTimeOffset? LastSyncedAt);

    public record ExportHelplyDto(McpPermissionSet Permissions, bool WorkspaceEnabled, List<ExportHelplyConversationDto> Conversations);

    public record ExportHelplyConversationDto(Guid Id, string Title, JsonElement Messages, string? ModelHistory, DateTime LastActivityAt, DateTime ExpiresAt, List<ExportHelplyAttachmentDto> Attachments);

    public record ExportHelplyAttachmentDto(string FileName, long SizeBytes, DateTime CreatedAt);

    public record ExportAiAppsDto(List<ExportAiAppConnectionDto> Connections, List<ExportAiAppKeyDto> ApiKeys, List<ExportAiAppActivityDto> Activity);

    public record ExportAiAppConnectionDto(string ClientName, string? ClientUri, McpPermissionSet Permissions, DateTime CreatedAt, DateTime? LastUsedAt);

    public record ExportAiAppKeyDto(string Name, string Prefix, McpPermissionSet Permissions, DateTime CreatedAt, DateTime? ExpiresAt, DateTime? LastUsedAt);

    public record ExportAiAppActivityDto(string ToolName, bool Allowed, DateTime At);

    public record ExportNotificationsDto(NotificationPreferencesDto? Preferences, List<ExportDeviceDto> Devices, List<ExportQueuedNotificationDto> Queued);

    public record ExportDeviceDto(string Token, string Platform, string Locale, DateTime LastSeenAt);

    public record ExportQueuedNotificationDto(string Type, string? SubjectName, string? Summary, DateTime CreatedAt);
}
