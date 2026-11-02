using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Schuly.Infrastructure.Plugins;
using Schuly.Infrastructure.Storage;
using Schuly.Infrastructure.Vault;
using System.Security.Cryptography;

namespace Schuly.Infrastructure.Services
{
    public sealed class AccountPurger(SchulyDbContext dbContext, IDocumentStorage documentStorage, IPluginVaultFactory vaultFactory, IPluginUserDataPurger pluginData, ILogger<AccountPurger> logger) : IAccountPurger
    {
        // Per-user purge steps. Every table that stores rows scoped to a SchoolUser or
        // an ApplicationUser must be represented here; a new user-scoped table is a
        // two-line addition.
        // Plugin vault entries are not purged: a VaultEntry is keyed by plugin namespace
        // and an opaque key with no user dimension, so nothing here can attribute one to
        // an account. Purging them needs a user-scoped key on the vault first.
        //
        // StudentDocuments and the Classes join table are handled separately from this
        // list (see PurgeSchoolUserScopedDataAsync) because they need extra work
        // (collecting blob keys, clearing a navigation collection) beyond a plain
        // RemoveRange. Note the ordering constraint: SemesterSubjectGrades must be
        // queued before SemesterReports, since a subject grade references a report.
        private static readonly IReadOnlyList<Func<SchulyDbContext, IReadOnlyCollection<Guid>, CancellationToken, Task>> SchoolUserScopedSteps =
        [
            QueueSemesterSubjectGradeDeletionAsync,
            QueueSemesterReportDeletionAsync,
            QueueGradeDeletionAsync,
            QueueAbsenceDeletionAsync,
            QueueAgendaEntryDeletionAsync,
        ];

        // DeviceTokens, NotificationPreferences and NotificationOutbox are keyed by
        // ApplicationUserId rather than SchoolUserId, so they cannot join the list above
        // and only ever run from PurgeApplicationUserAsync (PurgeSchoolUsersAsync has no
        // single ApplicationUserId to scope them to). DeviceTokens and
        // NotificationPreferences also cascade-delete at the DB level via their FK to
        // ApplicationUser, but they are purged explicitly here anyway so the behavior
        // does not depend on the provider enforcing that cascade. NotificationOutbox has
        // no FK at all (it is a queue, meant to outlive sync ordering), so this is the
        // only thing that ever cleans it up for a deleted account.
        private static readonly IReadOnlyList<Func<SchulyDbContext, Guid, CancellationToken, Task>> ApplicationUserScopedSteps =
        [
            QueueDeviceTokenDeletionAsync,
            QueueNotificationPreferenceDeletionAsync,
            QueueNotificationOutboxDeletionAsync,
            QueueMcpCredentialDeletionAsync,
            QueueHelplyDeletionAsync,
        ];

        public async Task<AccountPurgeSummary> PurgeApplicationUserAsync(Guid applicationUserId, CancellationToken cancellationToken = default)
        {
            var exists = await dbContext.ApplicationUsers.AsNoTracking().AnyAsync(u => u.Id == applicationUserId, cancellationToken);
            if (!exists)
                return new AccountPurgeSummary(0, 0, 0, 0);

            // Plugins wipe their own data (their DB rows and vault secrets) for this user
            // before the core rows go; it only needs the user id, so order is not critical.
            await pluginData.PurgeAsync(applicationUserId, cancellationToken);

            var schoolUserIds = await dbContext.SchoolUsers
                .Where(su => su.ApplicationUserId == applicationUserId)
                .Select(su => su.Id)
                .ToListAsync(cancellationToken);

            var schoolUsersRemoved = 0;
            var documentsRemoved = 0;
            IReadOnlyList<string> fileUrls = [];
            IReadOnlyList<Guid> linkedAccountIds = [];

            var strategy = dbContext.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async ct =>
            {
                await using var transaction = dbContext.Database.IsRelational() ? await dbContext.Database.BeginTransactionAsync(ct) : null;

                (schoolUsersRemoved, documentsRemoved, fileUrls) = await PurgeSchoolUserScopedDataAsync(schoolUserIds, ct);

                foreach (var step in ApplicationUserScopedSteps)
                    await step(dbContext, applicationUserId, ct);

                var linkedAccounts = await dbContext.LinkedAccounts.Where(a => a.ApplicationUserId == applicationUserId).ToListAsync(ct);
                linkedAccountIds = linkedAccounts.Select(a => a.Id).ToList();
                dbContext.LinkedAccounts.RemoveRange(linkedAccounts);

                // Teacher records are school-owned master data referenced by Classes,
                // not data belonging to this account - unlink instead of delete. The
                // schema declares DeleteBehavior.SetNull on Teacher.ApplicationUserId
                // for exactly this reason.
                var teachers = await dbContext.Teachers.Where(t => t.ApplicationUserId == applicationUserId).ToListAsync(ct);
                foreach (var teacher in teachers)
                    teacher.ApplicationUserId = null;

                var user = await dbContext.ApplicationUsers.SingleAsync(u => u.Id == applicationUserId, ct);
                dbContext.ApplicationUsers.Remove(user);

                await dbContext.SaveChangesAsync(ct);

                if (transaction is not null)
                    await transaction.CommitAsync(ct);
            }, cancellationToken);

            var (blobsDeleted, blobsFailed) = await DeleteBlobsAsync(fileUrls, cancellationToken);
            var linkedSecrets = new LinkedAccountStore(dbContext, vaultFactory);
            foreach (var linkedAccountId in linkedAccountIds)
                linkedSecrets.RemoveSecrets(linkedAccountId);
            var summary = new AccountPurgeSummary(schoolUsersRemoved, documentsRemoved, blobsDeleted, blobsFailed);

            logger.LogInformation("Account purge completed for user {UserHash}: {SchoolUsers} school users, {Documents} documents, {BlobsDeleted} blobs deleted, {BlobsFailed} blob deletions failed",
                HashUserId(applicationUserId), summary.SchoolUsers, summary.Documents, summary.BlobsDeleted, summary.BlobsFailed);

            return summary;
        }

        public async Task<AccountPurgeSummary> PurgeSchoolUsersAsync(IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken = default)
        {
            var schoolUsersRemoved = 0;
            var documentsRemoved = 0;
            IReadOnlyList<string> fileUrls = [];

            var strategy = dbContext.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async ct =>
            {
                await using var transaction = dbContext.Database.IsRelational() ? await dbContext.Database.BeginTransactionAsync(ct) : null;

                (schoolUsersRemoved, documentsRemoved, fileUrls) = await PurgeSchoolUserScopedDataAsync(schoolUserIds, ct);
                await dbContext.SaveChangesAsync(ct);

                if (transaction is not null)
                    await transaction.CommitAsync(ct);
            }, cancellationToken);

            var (blobsDeleted, blobsFailed) = await DeleteBlobsAsync(fileUrls, cancellationToken);
            var summary = new AccountPurgeSummary(schoolUsersRemoved, documentsRemoved, blobsDeleted, blobsFailed);

            // No single ApplicationUser is guaranteed here - this can purge SchoolUsers
            // across accounts - so there is no user id to hash into the log line.
            logger.LogInformation("Account purge completed for {SchoolUsers} school users: {Documents} documents, {BlobsDeleted} blobs deleted, {BlobsFailed} blob deletions failed",
                summary.SchoolUsers, summary.Documents, summary.BlobsDeleted, summary.BlobsFailed);

            return summary;
        }

        // Queues the deletion of every row scoped to the given SchoolUser ids (running
        // the named steps above plus documents and class memberships), and queues the
        // SchoolUser rows themselves. Nothing is saved here - the caller does a single
        // SaveChangesAsync so it can add more work (e.g. unlinking teachers) to the same
        // change set. Returns the row counts and the S3 keys of the documents queued for
        // deletion, since those still exist to be read off the tracked entities before
        // RemoveRange takes effect.
        private async Task<(int SchoolUsersRemoved, int DocumentsRemoved, IReadOnlyList<string> FileUrls)> PurgeSchoolUserScopedDataAsync(IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken)
        {
            foreach (var step in SchoolUserScopedSteps)
                await step(dbContext, schoolUserIds, cancellationToken);

            var documents = await dbContext.StudentDocuments.Where(d => schoolUserIds.Contains(d.SchoolUserId)).ToListAsync(cancellationToken);
            var fileUrls = documents.Where(d => !string.IsNullOrEmpty(d.FileUrl)).Select(d => d.FileUrl!).ToList();
            dbContext.StudentDocuments.RemoveRange(documents);

            var schoolUsers = await dbContext.SchoolUsers.Include(su => su.Classes).Where(su => schoolUserIds.Contains(su.Id)).ToListAsync(cancellationToken);
            foreach (var schoolUser in schoolUsers)
                schoolUser.Classes.Clear();
            dbContext.SchoolUsers.RemoveRange(schoolUsers);

            return (schoolUsers.Count, documents.Count, fileUrls);
        }

        // Blobs are deleted only after the DB transaction has committed. An orphan blob
        // left behind by a failed delete is recoverable - it can be swept up later - but
        // orphan StudentDocument metadata pointing at an already-deleted blob is not, so
        // the DB row must be gone first. A missing or unreachable object must never fail
        // the purge, so every delete gets its own try/catch.
        private async Task<(int Deleted, int Failed)> DeleteBlobsAsync(IReadOnlyList<string> fileUrls, CancellationToken cancellationToken)
        {
            var deleted = 0;
            var failed = 0;

            foreach (var fileUrl in fileUrls)
            {
                try
                {
                    await documentStorage.DeleteAsync(fileUrl, cancellationToken);
                    deleted++;
                }
                catch (Exception ex)
                {
                    failed++;
                    logger.LogWarning(ex, "Failed to delete a student document blob during account purge");
                }
            }

            return (deleted, failed);
        }

        private static async Task QueueSemesterSubjectGradeDeletionAsync(SchulyDbContext dbContext, IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken)
        {
            var reportIds = await dbContext.SemesterReports.Where(r => schoolUserIds.Contains(r.SchoolUserId)).Select(r => r.Id).ToListAsync(cancellationToken);
            var subjects = await dbContext.SemesterSubjectGrades.Where(sg => reportIds.Contains(sg.SemesterReportId)).ToListAsync(cancellationToken);
            dbContext.SemesterSubjectGrades.RemoveRange(subjects);
        }

        private static async Task QueueSemesterReportDeletionAsync(SchulyDbContext dbContext, IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken)
        {
            var reports = await dbContext.SemesterReports.Where(r => schoolUserIds.Contains(r.SchoolUserId)).ToListAsync(cancellationToken);
            dbContext.SemesterReports.RemoveRange(reports);
        }

        private static async Task QueueGradeDeletionAsync(SchulyDbContext dbContext, IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken)
        {
            var grades = await dbContext.Grades.Where(g => schoolUserIds.Contains(g.SchoolUserId)).ToListAsync(cancellationToken);
            dbContext.Grades.RemoveRange(grades);
        }

        private static async Task QueueAbsenceDeletionAsync(SchulyDbContext dbContext, IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken)
        {
            var absences = await dbContext.Absences.Where(a => schoolUserIds.Contains(a.SchoolUserId)).ToListAsync(cancellationToken);
            dbContext.Absences.RemoveRange(absences);
        }

        private static async Task QueueAgendaEntryDeletionAsync(SchulyDbContext dbContext, IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken)
        {
            var entries = await dbContext.AgendaEntries.Where(ae => ae.SchoolUserId != null && schoolUserIds.Contains(ae.SchoolUserId.Value)).ToListAsync(cancellationToken);
            dbContext.AgendaEntries.RemoveRange(entries);
        }

        private static async Task QueueDeviceTokenDeletionAsync(SchulyDbContext dbContext, Guid applicationUserId, CancellationToken cancellationToken)
        {
            var deviceTokens = await dbContext.DeviceTokens.Where(dt => dt.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken);
            dbContext.DeviceTokens.RemoveRange(deviceTokens);
        }

        private static async Task QueueNotificationPreferenceDeletionAsync(SchulyDbContext dbContext, Guid applicationUserId, CancellationToken cancellationToken)
        {
            var preferences = await dbContext.NotificationPreferences.Where(p => p.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken);
            dbContext.NotificationPreferences.RemoveRange(preferences);
        }

        private static async Task QueueNotificationOutboxDeletionAsync(SchulyDbContext dbContext, Guid applicationUserId, CancellationToken cancellationToken)
        {
            var outboxEntries = await dbContext.NotificationOutbox.Where(o => o.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken);
            dbContext.NotificationOutbox.RemoveRange(outboxEntries);
        }

        // MCP connections, tokens and API keys cascade from ApplicationUser too; deleting them here keeps that independent of the provider, like the rows above.
        private static async Task QueueMcpCredentialDeletionAsync(SchulyDbContext dbContext, Guid applicationUserId, CancellationToken cancellationToken)
        {
            var grantIds = await dbContext.McpGrants.Where(g => g.ApplicationUserId == applicationUserId).Select(g => g.Id).ToListAsync(cancellationToken);
            dbContext.McpAuthorizationCodes.RemoveRange(await dbContext.McpAuthorizationCodes.Where(c => grantIds.Contains(c.McpGrantId)).ToListAsync(cancellationToken));
            dbContext.McpTokens.RemoveRange(await dbContext.McpTokens.Where(t => t.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
            dbContext.McpGrants.RemoveRange(await dbContext.McpGrants.Where(g => g.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
            dbContext.McpApiKeys.RemoveRange(await dbContext.McpApiKeys.Where(k => k.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
            dbContext.McpActivities.RemoveRange(await dbContext.McpActivities.Where(a => a.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
        }

        // Helply conversations and settings cascade from ApplicationUser as well; explicit here for the same reason.
        private static async Task QueueHelplyDeletionAsync(SchulyDbContext dbContext, Guid applicationUserId, CancellationToken cancellationToken)
        {
            dbContext.HelplyConversations.RemoveRange(await dbContext.HelplyConversations.Where(c => c.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
            dbContext.HelplySettings.RemoveRange(await dbContext.HelplySettings.Where(h => h.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
        }

        private static string HashUserId(Guid id) => Convert.ToHexStringLower(SHA256.HashData(id.ToByteArray()))[..16];
    }
}
