using System.Text.Json;
using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Dtos;
using Schuly.Application.Mappers;
using Schuly.Application.Models;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Services;
using Toamaisutaa.Abstractions;

namespace Schuly.Application.Queries.User
{
    [AllowAuthenticated]
    public record ExportCurrentUserQuery() : IQuery<Result<AccountExportDto>>;

    public class ExportCurrentUserQueryHandler(SchulyDbContext dbContext, IUserService userService, HelplyCipher helplyCipher) : IQueryHandler<ExportCurrentUserQuery, Result<AccountExportDto>>
    {
        public async ValueTask<Result<AccountExportDto>> Handle(ExportCurrentUserQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);

            var user = await dbContext.ApplicationUsers
                .AsNoTracking()
                .Include(u => u.SchoolUsers)
                .SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);

            if (user == null)
                return Result<AccountExportDto>.Failure("User not found");

            var schoolUsers = await dbContext.SchoolUsers
                .AsNoTracking()
                .Include(su => su.School)
                .Include(su => su.Absences)
                .Include(su => su.Grades)
                .Include(su => su.Classes)
                .Where(su => su.ApplicationUserId == userId)
                .ToListAsync(cancellationToken);

            var schoolUserIds = schoolUsers.Select(su => su.Id).ToList();

            var agendaEntries = await dbContext.AgendaEntries
                .AsNoTracking()
                .Where(ae => ae.SchoolUserId != null && schoolUserIds.Contains(ae.SchoolUserId.Value))
                .ToListAsync(cancellationToken);

            var semesterReports = await dbContext.SemesterReports
                .AsNoTracking()
                .Include(r => r.Subjects)
                .Where(r => schoolUserIds.Contains(r.SchoolUserId))
                .ToListAsync(cancellationToken);

            var documents = await dbContext.StudentDocuments
                .AsNoTracking()
                .Where(d => schoolUserIds.Contains(d.SchoolUserId))
                .ToListAsync(cancellationToken);

            var linkedAccounts = await dbContext.LinkedAccounts
                .AsNoTracking()
                .Where(a => a.ApplicationUserId == userId)
                .Select(a => new LinkedAccountDto { Id = a.Id, Provider = a.Provider, Email = a.Email, DisplayName = a.DisplayName, CreatedAt = a.CreatedAt })
                .ToListAsync(cancellationToken);

            var export = new AccountExportDto
            {
                ExportedAt = DateTime.UtcNow,
                Profile = user.ToDto(),
                SchoolUsers = schoolUsers.ToDto(),
                AgendaEntries = agendaEntries.ToDto(),
                SemesterReports = semesterReports.ToDto(),
                Documents = documents.ToDto(),
                LinkedAccounts = linkedAccounts,
                PrivacyNotice = new ExportPrivacyNoticeDto(user.PolicyVersionAccepted, user.PolicyAcceptedAt, user.SwissSchoolConfirmedAt),
                SignIn = await SignInAsync(user, cancellationToken),
                Helply = await HelplyAsync(userId, cancellationToken),
                AiApps = await AiAppsAsync(userId, cancellationToken),
                Notifications = await NotificationsAsync(userId, cancellationToken),
            };

            return Result<AccountExportDto>.Success(export);
        }

        private async Task<ExportSignInDto?> SignInAsync(Domain.ApplicationUser user, CancellationToken cancellationToken)
        {
            if (!Guid.TryParse(user.ExternalId, out var loginId))
                return null;

            var signIn = await dbContext.Set<ToamaisutaaUser>().AsNoTracking().SingleOrDefaultAsync(u => u.Id == loginId, cancellationToken);
            var password = await dbContext.Set<ToamaisutaaPasswordCredential>().AsNoTracking().SingleOrDefaultAsync(c => c.UserId == loginId, cancellationToken);
            var twoFactor = await dbContext.Set<ToamaisutaaUserTwoFactor>().AsNoTracking().SingleOrDefaultAsync(t => t.UserId == loginId, cancellationToken);
            var external = await dbContext.Set<ToamaisutaaExternalLogin>().AsNoTracking().Where(l => l.UserId == loginId).ToListAsync(cancellationToken);
            var passkeys = await dbContext.Set<ToamaisutaaPasskeyCredential>().AsNoTracking().Where(p => p.UserId == loginId).ToListAsync(cancellationToken);
            var sessions = await dbContext.Set<ToamaisutaaRefreshToken>().AsNoTracking().Where(t => t.UserId == loginId && t.RevokedAt == null && t.RotatedAt == null).ToListAsync(cancellationToken);
            var devices = await dbContext.Set<ToamaisutaaTrustedDevice>().AsNoTracking().Where(d => d.UserId == loginId && d.RevokedAt == null && d.RotatedAt == null).ToListAsync(cancellationToken);

            return new ExportSignInDto(
                password?.UserName ?? signIn?.UserName,
                password?.Email ?? signIn?.Email,
                password?.EmailConfirmedAt,
                user.LastSeenAt,
                twoFactor?.ConfirmedAt is not null,
                external.Select(l => new ExportExternalLoginDto(l.ProviderKey, l.Email, l.CreatedAt, l.LastSignInAt)).ToList(),
                passkeys.Select(p => new ExportPasskeyDto(p.Label, p.CreatedAt, p.LastUsedAt)).ToList(),
                sessions.Select(s => new ExportSessionDto(null, s.IpAddress, s.UserAgent, s.CreatedAt, s.LastUsedAt)).ToList(),
                devices.Select(d => new ExportSessionDto(d.Label, d.IpAddress, d.UserAgent, d.CreatedAt, d.LastUsedAt)).ToList());
        }

        private async Task<ExportHelplyDto> HelplyAsync(Guid userId, CancellationToken cancellationToken)
        {
            var settings = await dbContext.HelplySettings.AsNoTracking().FirstOrDefaultAsync(s => s.ApplicationUserId == userId, cancellationToken);
            var conversations = await dbContext.HelplyConversations.AsNoTracking().Where(c => c.ApplicationUserId == userId).ToListAsync(cancellationToken);
            var attachments = await dbContext.HelplyAttachments.AsNoTracking().Where(a => a.ApplicationUserId == userId).ToListAsync(cancellationToken);

            var exported = conversations.Select(c => new ExportHelplyConversationDto(
                c.Id,
                helplyCipher.DecryptString(c.Title, c.Id, userId, HelplyCipher.TitleField),
                JsonDocument.Parse(helplyCipher.Decrypt(c.Transcript, c.Id, userId, HelplyCipher.TranscriptField)).RootElement,
                c.Session is null ? null : helplyCipher.DecryptString(c.Session, c.Id, userId, HelplyCipher.SessionField),
                c.LastActivityAt,
                c.ExpiresAt,
                attachments.Where(a => a.ConversationId == c.Id).Select(a => new ExportHelplyAttachmentDto(helplyCipher.DecryptString(a.FileName, c.Id, userId, HelplyAttachmentStore.Field(a.Id, "name")), a.SizeBytes, a.CreatedAt)).ToList())).ToList();

            return new ExportHelplyDto(settings?.Permissions ?? McpPermissionSet.SchoolDataOnly(), settings?.WorkspaceEnabled ?? false, exported);
        }

        private async Task<ExportAiAppsDto> AiAppsAsync(Guid userId, CancellationToken cancellationToken)
        {
            var grants = await dbContext.McpGrants.AsNoTracking().Include(g => g.McpOAuthClient).Where(g => g.ApplicationUserId == userId && g.RevokedAt == null).ToListAsync(cancellationToken);
            var keys = await dbContext.McpApiKeys.AsNoTracking().Where(k => k.ApplicationUserId == userId && k.RevokedAt == null).ToListAsync(cancellationToken);
            var activity = await dbContext.McpActivities.AsNoTracking().Where(a => a.ApplicationUserId == userId).ToListAsync(cancellationToken);

            return new ExportAiAppsDto(
                grants.Select(g => new ExportAiAppConnectionDto(g.McpOAuthClient!.ClientName, g.McpOAuthClient.ClientUri, g.Permissions, g.CreatedAt, g.LastUsedAt)).ToList(),
                keys.Select(k => new ExportAiAppKeyDto(k.Name, k.Prefix, k.Permissions, k.CreatedAt, k.ExpiresAt, k.LastUsedAt)).ToList(),
                activity.Select(a => new ExportAiAppActivityDto(a.ToolName, a.Allowed, a.CreatedAt)).ToList());
        }

        private async Task<ExportNotificationsDto> NotificationsAsync(Guid userId, CancellationToken cancellationToken)
        {
            var preference = await dbContext.NotificationPreferences.AsNoTracking().SingleOrDefaultAsync(p => p.ApplicationUserId == userId, cancellationToken);
            var devices = await dbContext.DeviceTokens.AsNoTracking().Where(d => d.ApplicationUserId == userId).ToListAsync(cancellationToken);
            var queued = await dbContext.NotificationOutbox.AsNoTracking().Where(o => o.ApplicationUserId == userId).ToListAsync(cancellationToken);

            return new ExportNotificationsDto(
                preference is null ? null : new NotificationPreferencesDto(preference.Grades, preference.Absences, preference.Agenda, preference.IncludeGradeValue, preference.IncludeDetails),
                devices.Select(d => new ExportDeviceDto(d.Token, d.Platform, d.Locale, d.LastSeenAt)).ToList(),
                queued.Select(o => new ExportQueuedNotificationDto(o.Type.ToString(), o.SubjectName, o.Summary, o.CreatedAt)).ToList());
        }
    }
}
