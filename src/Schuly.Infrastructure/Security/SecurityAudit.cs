using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schuly.Domain;
using Schuly.Infrastructure.Services;
using Toamaisutaa.Abstractions;

namespace Schuly.Infrastructure.Security
{
    /// <summary>Writes the security audit trail. Each write uses its own scope, so it never flushes or fails the work of the request it describes.</summary>
    public sealed class SecurityAuditLog(IServiceScopeFactory scopes)
    {
        public const string SectionName = "SecurityAudit";
        public const int DefaultRetentionDays = 365;

        public async Task WriteAsync(string kind, Guid? userId, string? detail, DateTimeOffset occurredAt, CancellationToken cancellationToken = default)
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            db.SecurityAuditEntries.Add(new SecurityAuditEntry { Id = Guid.NewGuid(), Kind = kind, UserId = userId, Detail = detail, OccurredAt = occurredAt.UtcDateTime });
            await db.SaveChangesAsync(cancellationToken);
        }

        public static async Task<int> DeleteOlderThanAsync(SchulyDbContext db, DateTime cutoff, CancellationToken cancellationToken = default)
        {
            var expired = await db.SecurityAuditEntries.Where(e => e.OccurredAt < cutoff).ToListAsync(cancellationToken);
            db.SecurityAuditEntries.RemoveRange(expired);
            await db.SaveChangesAsync(cancellationToken);
            return expired.Count;
        }
    }

    /// <summary>Keeps the sign-in and credential events a breach review needs. Fields are the kind, the account id, the time and a reason code; events that carry an email are left out.</summary>
    public sealed class SecurityAuditSink(SecurityAuditLog log) : IAuthenticationEventSink
    {
        private static readonly HashSet<string> Kept = ["sign-in-succeeded", "sign-in-failed", "account-locked-out", "refresh-token-reuse-detected", "password-changed", "password-reset", "two-factor-disabled", "account-created"];

        public Task HandleAsync(AuthenticationEvent authenticationEvent, CancellationToken cancellationToken = default)
        {
            if (!Kept.Contains(authenticationEvent.Kind))
                return Task.CompletedTask;

            var detail = authenticationEvent is SignInFailed failed ? failed.Reason.ToString() : null;
            return log.WriteAsync(authenticationEvent.Kind, authenticationEvent.UserId, detail, authenticationEvent.OccurredAt, cancellationToken);
        }
    }

    /// <summary>Records every account purge, whichever path asked for it (self-service deletion or the inactivity sweep), once it has succeeded.</summary>
    public sealed class AuditedAccountPurger(AccountPurger inner, SchulyDbContext db, SecurityAuditLog log) : IAccountPurger
    {
        public const string Kind = "account-data-purged";

        public async Task<AccountPurgeSummary> PurgeApplicationUserAsync(Guid applicationUserId, CancellationToken cancellationToken = default)
        {
            var externalId = await db.ApplicationUsers.AsNoTracking().Where(u => u.Id == applicationUserId).Select(u => u.ExternalId).SingleOrDefaultAsync(cancellationToken);
            var summary = await inner.PurgeApplicationUserAsync(applicationUserId, cancellationToken);
            await log.WriteAsync(Kind, Guid.TryParse(externalId, out var loginId) ? loginId : null, null, DateTimeOffset.UtcNow, cancellationToken);
            return summary;
        }

        public Task<AccountPurgeSummary> PurgeSchoolUsersAsync(IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken = default) => inner.PurgeSchoolUsersAsync(schoolUserIds, cancellationToken);
    }
}
