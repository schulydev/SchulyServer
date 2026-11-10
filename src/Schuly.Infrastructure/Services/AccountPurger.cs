using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Schuly.Domain;
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
        // Plugin vault entries are purged by each plugin's handler, not here: a VaultEntry is
        // keyed by plugin namespace and an opaque key with no user dimension.
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
            var failedPlugins = await pluginData.PurgeAsync(applicationUserId, null, cancellationToken);

            var schoolUserIds = await dbContext.SchoolUsers
                .Where(su => su.ApplicationUserId == applicationUserId)
                .Select(su => su.Id)
                .ToListAsync(cancellationToken);

            var schoolUsersRemoved = 0;
            var documentsRemoved = 0;
            List<PendingPurge> pending = [];

            var strategy = dbContext.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async ct =>
            {
                await using var transaction = dbContext.Database.IsRelational() ? await dbContext.Database.BeginTransactionAsync(ct) : null;

                (schoolUsersRemoved, documentsRemoved, var fileUrls) = await PurgeSchoolUserScopedDataAsync(schoolUserIds, ct);

                foreach (var step in ApplicationUserScopedSteps)
                    await step(dbContext, applicationUserId, ct);

                var linkedAccounts = await dbContext.LinkedAccounts.Where(a => a.ApplicationUserId == applicationUserId).ToListAsync(ct);
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

                pending = fileUrls.Select(BlobStep).ToList();
                if (BlobKeys.IsStored(user.ProfilePictureUrl))
                    pending.Add(BlobStep(user.ProfilePictureUrl!));
                pending.AddRange(linkedAccounts.Where(a => BlobKeys.IsStored(a.PictureKey)).Select(a => BlobStep(a.PictureKey!)));
                pending.AddRange(linkedAccounts.Select(a => new PendingPurge { Kind = PendingPurgeKind.LinkedAccountSecrets, Target = a.Id.ToString() }));
                pending.AddRange(failedPlugins.Select(source => PluginStep(applicationUserId, source)));
                dbContext.PendingPurges.AddRange(pending);

                await dbContext.SaveChangesAsync(ct);

                if (transaction is not null)
                    await transaction.CommitAsync(ct);
            }, cancellationToken);

            // The plugin steps are already failed attempts; they wait for the next sweep.
            var (blobsDeleted, blobsFailed) = await RunPendingAsync(pending.Where(p => p.Kind == PendingPurgeKind.Blob).ToList(), cancellationToken);
            var (_, secretsFailed) = await RunPendingAsync(pending.Where(p => p.Kind == PendingPurgeKind.LinkedAccountSecrets).ToList(), cancellationToken);
            var summary = new AccountPurgeSummary(schoolUsersRemoved, documentsRemoved, blobsDeleted, blobsFailed, failedPlugins.Count);

            logger.LogInformation("Account purge completed for user {UserHash}: {SchoolUsers} school users, {Documents} documents, {BlobsDeleted} blobs deleted, {BlobsFailed} blob deletions failed, {PluginPurgesFailed} plugin purges failed",
                HashUserId(applicationUserId), summary.SchoolUsers, summary.Documents, summary.BlobsDeleted, summary.BlobsFailed, summary.PluginPurgesFailed);

            if (blobsFailed + secretsFailed + failedPlugins.Count > 0)
                logger.LogError("Account purge for user {UserHash} is incomplete: {Failed} steps queued for retry", HashUserId(applicationUserId), blobsFailed + secretsFailed + failedPlugins.Count);

            return summary;
        }

        public async Task<AccountPurgeSummary> PurgeSchoolUsersAsync(IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken = default)
        {
            var schoolUsersRemoved = 0;
            var documentsRemoved = 0;
            List<PendingPurge> pending = [];

            var strategy = dbContext.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async ct =>
            {
                await using var transaction = dbContext.Database.IsRelational() ? await dbContext.Database.BeginTransactionAsync(ct) : null;

                await QueueOutboxDeletionForSchoolUsersAsync(schoolUserIds, ct);
                (schoolUsersRemoved, documentsRemoved, var fileUrls) = await PurgeSchoolUserScopedDataAsync(schoolUserIds, ct);
                pending = fileUrls.Select(BlobStep).ToList();
                dbContext.PendingPurges.AddRange(pending);
                await dbContext.SaveChangesAsync(ct);

                if (transaction is not null)
                    await transaction.CommitAsync(ct);
            }, cancellationToken);

            var (blobsDeleted, blobsFailed) = await RunPendingAsync(pending, cancellationToken);
            var summary = new AccountPurgeSummary(schoolUsersRemoved, documentsRemoved, blobsDeleted, blobsFailed);

            // No single ApplicationUser is guaranteed here - this can purge SchoolUsers
            // across accounts - so there is no user id to hash into the log line.
            logger.LogInformation("Account purge completed for {SchoolUsers} school users: {Documents} documents, {BlobsDeleted} blobs deleted, {BlobsFailed} blob deletions failed",
                summary.SchoolUsers, summary.Documents, summary.BlobsDeleted, summary.BlobsFailed);

            return summary;
        }

        public async Task<int> PurgePluginDataAsync(Guid applicationUserId, string? pluginSource, CancellationToken cancellationToken = default)
        {
            var failed = await pluginData.PurgeAsync(applicationUserId, pluginSource, cancellationToken);
            if (failed.Count == 0)
                return 0;

            var target = applicationUserId.ToString();
            var queued = await dbContext.PendingPurges
                .Where(p => p.Kind == PendingPurgeKind.PluginUserData && p.Target == target)
                .Select(p => p.PluginSource)
                .ToListAsync(cancellationToken);
            dbContext.PendingPurges.AddRange(failed.Except(queued).Select(source => PluginStep(applicationUserId, source!)));
            await dbContext.SaveChangesAsync(cancellationToken);
            return failed.Count;
        }

        public async Task<PendingPurgeResult> RetryPendingAsync(CancellationToken cancellationToken = default)
        {
            var pending = await dbContext.PendingPurges.OrderBy(p => p.CreatedAt).ToListAsync(cancellationToken);
            if (pending.Count == 0)
                return new PendingPurgeResult(0, 0);

            var (completed, failed) = await RunPendingAsync(pending, cancellationToken);
            return new PendingPurgeResult(completed, failed);
        }

        private static PendingPurge BlobStep(string key) => new() { Kind = PendingPurgeKind.Blob, Target = key };

        private static PendingPurge PluginStep(Guid applicationUserId, string pluginSource) => new() { Kind = PendingPurgeKind.PluginUserData, Target = applicationUserId.ToString(), PluginSource = pluginSource };

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
            fileUrls.AddRange(schoolUsers.Where(su => BlobKeys.IsStored(su.ProfilePictureUrl)).Select(su => su.ProfilePictureUrl!));

            return (schoolUsers.Count, documents.Count, fileUrls);
        }

        // Steps outside the database run only after its transaction has committed, because a
        // row pointing at an already-deleted blob could not be recovered. Their queue rows
        // commit with that transaction, so a failed or interrupted step is retried by the
        // daily sweep. A failing step must never fail the purge, so each gets its own try/catch.
        private async Task<(int Completed, int Failed)> RunPendingAsync(IReadOnlyList<PendingPurge> pending, CancellationToken cancellationToken)
        {
            var completed = 0;
            var failed = 0;

            foreach (var step in pending)
            {
                try
                {
                    await RunStepAsync(step, cancellationToken);
                    dbContext.PendingPurges.Remove(step);
                    completed++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    step.Attempts++;
                    failed++;
                    logger.LogWarning("A {Kind} deletion step failed ({ExceptionType}); the daily sweep retries it", step.Kind, ex.GetType().Name);
                }
            }

            if (pending.Count > 0)
                await dbContext.SaveChangesAsync(cancellationToken);

            return (completed, failed);
        }

        private async Task RunStepAsync(PendingPurge step, CancellationToken cancellationToken)
        {
            switch (step.Kind)
            {
                case PendingPurgeKind.Blob:
                    await documentStorage.DeleteAsync(step.Target, cancellationToken);
                    break;
                case PendingPurgeKind.LinkedAccountSecrets:
                    new LinkedAccountStore(dbContext, vaultFactory).RemoveSecrets(Guid.Parse(step.Target));
                    break;
                case PendingPurgeKind.PluginUserData:
                    if ((await pluginData.PurgeAsync(Guid.Parse(step.Target), step.PluginSource, cancellationToken)).Count > 0)
                        throw new InvalidOperationException("The plugin purge failed again.");
                    break;
                default:
                    throw new InvalidOperationException($"Unknown purge step {step.Kind}.");
            }
        }

        // Outbox rows carry no SchoolUserId. They point at the grade, absence or agenda entry through
        // EntityId, and at a class agenda entry for each student, so those are matched by owner as well.
        private async Task QueueOutboxDeletionForSchoolUsersAsync(IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken)
        {
            var entityIds = await dbContext.Grades.Where(g => schoolUserIds.Contains(g.SchoolUserId)).Select(g => g.Id).ToListAsync(cancellationToken);
            entityIds.AddRange(await dbContext.Absences.Where(a => schoolUserIds.Contains(a.SchoolUserId)).Select(a => a.Id).ToListAsync(cancellationToken));
            entityIds.AddRange(await dbContext.AgendaEntries.Where(a => a.SchoolUserId != null && schoolUserIds.Contains(a.SchoolUserId.Value)).Select(a => a.Id).ToListAsync(cancellationToken));

            var owners = await dbContext.SchoolUsers.Where(su => schoolUserIds.Contains(su.Id)).Select(su => su.ApplicationUserId).Distinct().ToListAsync(cancellationToken);
            var classIds = await dbContext.SchoolUsers.Where(su => schoolUserIds.Contains(su.Id)).SelectMany(su => su.Classes).Select(c => c.Id).Distinct().ToListAsync(cancellationToken);
            var classEntryIds = await dbContext.AgendaEntries.Where(a => a.ClassId != null && classIds.Contains(a.ClassId.Value)).Select(a => a.Id).ToListAsync(cancellationToken);

            var rows = await dbContext.NotificationOutbox
                .Where(o => entityIds.Contains(o.EntityId) || (owners.Contains(o.ApplicationUserId) && classEntryIds.Contains(o.EntityId)))
                .ToListAsync(cancellationToken);
            dbContext.NotificationOutbox.RemoveRange(rows);
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
            var attachmentIds = await dbContext.HelplyAttachments.Where(a => a.ApplicationUserId == applicationUserId).Select(a => a.Id).ToListAsync(cancellationToken);
            dbContext.HelplyAttachmentContents.RemoveRange(await dbContext.HelplyAttachmentContents.Where(c => attachmentIds.Contains(c.AttachmentId)).ToListAsync(cancellationToken));
            dbContext.HelplyAttachments.RemoveRange(await dbContext.HelplyAttachments.Where(a => a.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
            dbContext.HelplyConversations.RemoveRange(await dbContext.HelplyConversations.Where(c => c.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
            dbContext.HelplySettings.RemoveRange(await dbContext.HelplySettings.Where(h => h.ApplicationUserId == applicationUserId).ToListAsync(cancellationToken));
        }

        private static string HashUserId(Guid id) => Convert.ToHexStringLower(SHA256.HashData(id.ToByteArray()))[..16];
    }
}
