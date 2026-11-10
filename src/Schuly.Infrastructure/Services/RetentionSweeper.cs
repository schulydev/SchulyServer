using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Schuly.Domain;
using Schuly.Infrastructure.Storage;
using Toamaisutaa.Abstractions;

namespace Schuly.Infrastructure.Services
{
    public record RetentionSweepResult(int SchoolUsersPurged, int AccountsPurged, int WarningsSent = 0, int OrphanedOwnersPurged = 0, int OrphanedAccountsPurged = 0, int OrphanedBlobsDeleted = 0, int PendingCompleted = 0, int PendingFailing = 0, int FailedSteps = 0, int OrphanedSchoolRows = 0);

    public sealed class RetentionSweeper(SchulyDbContext dbContext, IAccountPurger accountPurger, IPluginUserDataPurger pluginData, IUserStore userStore, IDocumentStorage documentStorage, IInactivityWarningSender warningSender, IOptions<RetentionOptions> options, ILogger<RetentionSweeper> logger)
    {
        private int _failedSteps;

        public async Task<RetentionSweepResult> SweepAsync(CancellationToken cancellationToken)
        {
            if (!options.Value.Enabled)
            {
                logger.LogDebug("Retention sweep is disabled; skipping.");
                return new RetentionSweepResult(0, 0);
            }

            _failedSteps = 0;
            var pending = await RunStepAsync("retry", () => accountPurger.RetryPendingAsync(cancellationToken), new PendingPurgeResult(0, 0), cancellationToken);
            var schoolUsersPurged = await RunStepAsync("leavers", () => SweepLeaversAsync(cancellationToken), 0, cancellationToken);
            var (accountsPurged, warningsSent) = await RunStepAsync("inactive accounts", () => SweepInactiveAsync(cancellationToken), (0, 0), cancellationToken);
            var orphanedOwners = await RunStepAsync("plugin data of deleted users", () => SweepOrphanedPluginDataAsync(cancellationToken), 0, cancellationToken);
            var orphanedAccounts = await RunStepAsync("accounts without a sign-in", () => SweepAccountsWithoutSignInAsync(cancellationToken), 0, cancellationToken);
            var orphanedBlobs = await RunStepAsync("orphaned blobs", () => SweepOrphanedBlobsAsync(cancellationToken), 0, cancellationToken);
            var orphanedSchoolRows = await RunStepAsync("school rows without an owner", () => SweepOrphanedSchoolRowsAsync(cancellationToken), 0, cancellationToken);

            logger.LogInformation("Retention sweep: {SchoolUsers} school users and {Accounts} accounts purged, {Warnings} warnings sent, {OrphanedOwners} deleted users' plugin data and {OrphanedAccounts} accounts without a sign-in purged, {OrphanedBlobs} orphaned blobs and {OrphanedSchoolRows} school rows without an owner deleted, {PendingCompleted} queued deletions completed.",
                schoolUsersPurged, accountsPurged, warningsSent, orphanedOwners, orphanedAccounts, orphanedBlobs, orphanedSchoolRows, pending.Completed);

            if (pending.StillFailing > 0 || _failedSteps > 0)
                logger.LogError("Retention sweep is incomplete: {PendingFailing} queued deletions still fail and {FailedSteps} sweep steps failed. Data the policy says is deleted may still exist.", pending.StillFailing, _failedSteps);

            return new RetentionSweepResult(schoolUsersPurged, accountsPurged, warningsSent, orphanedOwners, orphanedAccounts, orphanedBlobs, pending.Completed, pending.StillFailing, _failedSteps, orphanedSchoolRows);
        }

        // One failing step must not stop the others. Its half-done changes are dropped, or the next step's save would retry them.
        private async Task<T> RunStepAsync<T>(string name, Func<Task<T>> step, T fallback, CancellationToken cancellationToken)
        {
            try
            {
                return await step();
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                _failedSteps++;
                dbContext.ChangeTracker.Clear();
                logger.LogError("Retention sweep step {Step} failed ({ExceptionType}).", name, ex.GetType().Name);
                return fallback;
            }
        }

        private async Task<int> SweepLeaversAsync(CancellationToken cancellationToken)
        {
            var leaveCutoff = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-options.Value.MonthsAfterLeave);

            var leavers = await dbContext.SchoolUsers
                .Where(su => su.LeaveDate != null && su.LeaveDate < leaveCutoff)
                .Select(su => new { su.Id, su.ApplicationUserId, su.Source })
                .ToListAsync(cancellationToken);

            if (leavers.Count == 0)
                return 0;

            var schoolUserIds = leavers.Select(l => l.Id).ToList();

            // The plugin that synced a leaver goes first, so its sync can't recreate the student. Its purge event covers
            // the whole user, so it can't be used while the user is still at another school through the same plugin; the
            // Schulnetz plugin then removes the one account itself, on its next sync. Other plugins aren't school data.
            foreach (var pair in leavers.Where(l => l.Source is not null).Select(l => (l.ApplicationUserId, Source: l.Source!)).Distinct())
            {
                var staysLinked = await dbContext.SchoolUsers.AnyAsync(su => su.ApplicationUserId == pair.ApplicationUserId && su.Source == pair.Source && !schoolUserIds.Contains(su.Id), cancellationToken);
                if (!staysLinked)
                    await accountPurger.PurgePluginDataAsync(pair.ApplicationUserId, pair.Source, cancellationToken);
            }

            var summary = await accountPurger.PurgeSchoolUsersAsync(schoolUserIds, cancellationToken);
            return summary.SchoolUsers;
        }

        private sealed record InactiveAccount(Guid? ApplicationUserId, Guid? LoginId, DateTime LastActive);

        private async Task<(int Purged, int Warned)> SweepInactiveAsync(CancellationToken cancellationToken)
        {
            var now = DateTime.UtcNow;
            var warningDays = Math.Max(RetentionOptions.MinimumWarningDays, options.Value.InactivityWarningDays);
            var warnFrom = now.AddDays(warningDays).AddMonths(-options.Value.MonthsInactive);

            var candidates = await FindInactiveAsync(warnFrom, cancellationToken);
            var warnings = await dbContext.InactivityWarnings.ToDictionaryAsync(w => w.LoginId, cancellationToken);
            var candidateLogins = candidates.Where(c => c.LoginId is not null).Select(c => c.LoginId!.Value).ToHashSet();
            var emails = await VerifiedEmailsAsync(candidateLogins, cancellationToken);

            // Someone who came back or was deleted another way has no use for an old warning.
            dbContext.InactivityWarnings.RemoveRange(warnings.Values.Where(w => !candidateLogins.Contains(w.LoginId)));

            var (purged, warned) = (0, 0);
            foreach (var account in candidates)
            {
                var deleteDue = account.LastActive.AddMonths(options.Value.MonthsInactive);
                var email = account.LoginId is { } loginId ? emails.GetValueOrDefault(loginId) : null;
                var warning = account.LoginId is { } id ? warnings.GetValueOrDefault(id) : null;

                // A warning from before the last activity was for an earlier period and no longer counts.
                if (warning is not null && warning.SentAt < account.LastActive)
                {
                    dbContext.InactivityWarnings.Remove(warning);
                    await dbContext.SaveChangesAsync(cancellationToken);
                    warning = null;
                }

                if (email is not null && warning is null)
                {
                    if (await TryWarnAsync(account.LoginId!.Value, email, deleteDue > now.AddDays(warningDays) ? deleteDue : now.AddDays(warningDays), now, cancellationToken))
                        warned++;
                    continue;
                }

                var deleteAfter = email is not null && warning!.DeleteAfter > deleteDue ? warning.DeleteAfter : deleteDue;
                if (now < deleteAfter)
                    continue;

                if (await TryDeleteAsync(account, warning, cancellationToken))
                    purged++;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return (purged, warned);
        }

        // Falling back to CreatedAt covers accounts created before LastSeenAt existed. A sign-in row that
        // never reached the API has no application user, and still holds an address until it is swept.
        private async Task<List<InactiveAccount>> FindInactiveAsync(DateTime warnFrom, CancellationToken cancellationToken)
        {
            var accounts = await dbContext.ApplicationUsers
                .Where(u => (u.LastSeenAt ?? u.CreatedAt) < warnFrom)
                .Select(u => new { u.Id, u.ExternalId, LastActive = u.LastSeenAt ?? u.CreatedAt })
                .ToListAsync(cancellationToken);

            var result = accounts.Select(a => new InactiveAccount(a.Id, Guid.TryParse(a.ExternalId, out var loginId) ? loginId : null, a.LastActive)).ToList();

            var externalIds = (await dbContext.ApplicationUsers.Select(u => u.ExternalId).ToListAsync(cancellationToken)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var signIns = await dbContext.Set<ToamaisutaaUser>().AsNoTracking().Select(u => new { u.Id, u.UpdatedAt }).ToListAsync(cancellationToken);
            result.AddRange(signIns
                .Where(s => s.UpdatedAt.UtcDateTime < warnFrom && !externalIds.Contains(s.Id.ToString()))
                .Select(s => new InactiveAccount(null, s.Id, s.UpdatedAt.UtcDateTime)));

            return result;
        }

        // Only an address the person proved counts; the profile address could belong to anyone.
        private async Task<Dictionary<Guid, string>> VerifiedEmailsAsync(IReadOnlyCollection<Guid> loginIds, CancellationToken cancellationToken)
        {
            var external = await dbContext.Set<ToamaisutaaExternalLogin>().AsNoTracking()
                .Where(l => l.EmailVerified && l.Email != null && loginIds.Contains(l.UserId))
                .Select(l => new { l.UserId, l.Email })
                .ToListAsync(cancellationToken);
            var password = await dbContext.Set<ToamaisutaaPasswordCredential>().AsNoTracking()
                .Where(c => c.EmailConfirmedAt != null && c.Email != null && loginIds.Contains(c.UserId))
                .Select(c => new { c.UserId, c.Email })
                .ToListAsync(cancellationToken);

            var emails = new Dictionary<Guid, string>();
            foreach (var row in external)
                emails[row.UserId] = row.Email!;
            foreach (var row in password)
                emails[row.UserId] = row.Email!;
            return emails;
        }

        // A warning that couldn't be sent is not recorded, so deletion waits and the next sweep sends it again.
        private async Task<bool> TryWarnAsync(Guid loginId, string email, DateTime deleteAfter, DateTime now, CancellationToken cancellationToken)
        {
            try
            {
                await warningSender.SendAsync(email, deleteAfter, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                _failedSteps++;
                logger.LogError("An inactivity warning could not be sent ({ExceptionType}); the account stays until one is.", ex.GetType().Name);
                return false;
            }

            dbContext.InactivityWarnings.Add(new InactivityWarning { LoginId = loginId, SentAt = now, DeleteAfter = deleteAfter });
            await dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }

        private async Task<bool> TryDeleteAsync(InactiveAccount account, InactivityWarning? warning, CancellationToken cancellationToken)
        {
            try
            {
                // Sign-in first, like a deletion by the user: tokens stop working, and a failed purge is finished by the sweep for accounts without a sign-in.
                if (account.LoginId is { } loginId)
                    await userStore.DeleteAsync(loginId, cancellationToken);
                if (account.ApplicationUserId is { } applicationUserId)
                    await accountPurger.PurgeApplicationUserAsync(applicationUserId, cancellationToken);
                if (warning is not null)
                    dbContext.InactivityWarnings.Remove(warning);
                return true;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                _failedSteps++;
                dbContext.ChangeTracker.Clear();
                logger.LogError("An inactive account could not be deleted ({ExceptionType}).", ex.GetType().Name);
                return false;
            }
        }

        // Finds users deleted before their plugin had a purge handler, or while it failed or wasn't loaded. The owner
        // is verified against the host's own table; the plugin's own handler does the deleting. Repeats harmlessly.
        private async Task<int> SweepOrphanedPluginDataAsync(CancellationToken cancellationToken)
        {
            var owners = await pluginData.ListOwnersAsync(cancellationToken);
            if (owners.Count == 0)
                return 0;

            // No users at all means a fresh or wrong database, not that everyone was deleted.
            if (!await dbContext.ApplicationUsers.AnyAsync(cancellationToken))
                return 0;

            var existing = await dbContext.ApplicationUsers.Where(u => owners.Contains(u.Id)).Select(u => u.Id).ToListAsync(cancellationToken);
            var gone = owners.Except(existing).ToList();

            var purged = 0;
            foreach (var owner in gone)
            {
                if (await accountPurger.PurgePluginDataAsync(owner, null, cancellationToken) == 0)
                    purged++;
            }

            return purged;
        }

        // Deleted sign-ins whose purge failed, and rows recreated by a token that outlived its deletion. Only version 7 ids
        // are local sign-ins: accounts from before the built-in sign-in have other ids and no sign-in row, and age out instead.
        private async Task<int> SweepAccountsWithoutSignInAsync(CancellationToken cancellationToken)
        {
            var signIns = await dbContext.Set<ToamaisutaaUser>().AsNoTracking().Select(u => u.Id).ToListAsync(cancellationToken);
            if (signIns.Count == 0)
                return 0;

            var existing = signIns.ToHashSet();
            var accounts = await dbContext.ApplicationUsers.Select(u => new { u.Id, u.ExternalId }).ToListAsync(cancellationToken);
            var orphans = accounts
                .Where(a => Guid.TryParse(a.ExternalId, out var loginId) && loginId.Version == 7 && !existing.Contains(loginId))
                .Select(a => a.Id)
                .ToList();

            foreach (var orphan in orphans)
                await accountPurger.PurgeApplicationUserAsync(orphan, cancellationToken);

            return orphans.Count;
        }

        // A class with no student and no grade belongs to nobody, and its exams and class agenda go with it. A class always gets its first student in the save that creates
        // it, so no sync is caught halfway. An exam without grades in a class that still has students stays: classmates may still see it, and it names nobody.
        private async Task<int> SweepOrphanedSchoolRowsAsync(CancellationToken cancellationToken)
        {
            // No students at all means a fresh or wrong database, not that everyone left.
            if (!await dbContext.SchoolUsers.AnyAsync(cancellationToken))
                return 0;

            var classes = await dbContext.Classes
                .Include(c => c.Exams)
                .Include(c => c.Agenda)
                .Include(c => c.Teachers)
                .Where(c => !c.Students.Any() && !c.Exams.Any(e => e.Grades.Any()))
                .ToListAsync(cancellationToken);
            var removed = classes.Count + classes.Sum(c => c.Exams.Count);

            dbContext.AgendaEntries.RemoveRange(classes.SelectMany(c => c.Agenda));
            dbContext.Exams.RemoveRange(classes.SelectMany(c => c.Exams));
            dbContext.Classes.RemoveRange(classes);
            await dbContext.SaveChangesAsync(cancellationToken);

            var teachers = await dbContext.Teachers.Where(t => t.ApplicationUserId == null && !t.Classes.Any()).ToListAsync(cancellationToken);
            dbContext.Teachers.RemoveRange(teachers);
            await dbContext.SaveChangesAsync(cancellationToken);

            return removed + teachers.Count;
        }

        // Blobs left by deletions from before avatars were purged, and by replaced pictures. A blob counts as orphaned only
        // with our key shape, no row pointing at it, and an age no upload still on its way to its row can reach.
        private async Task<int> SweepOrphanedBlobsAsync(CancellationToken cancellationToken)
        {
            if (!options.Value.SweepOrphanBlobs)
                return 0;

            var referenced = new HashSet<string>(StringComparer.Ordinal);
            referenced.UnionWith(await dbContext.StudentDocuments.Where(d => d.FileUrl != null).Select(d => d.FileUrl!).ToListAsync(cancellationToken));
            referenced.UnionWith(await dbContext.ApplicationUsers.Where(u => u.ProfilePictureUrl != null).Select(u => u.ProfilePictureUrl!).ToListAsync(cancellationToken));
            referenced.UnionWith(await dbContext.SchoolUsers.Where(su => su.ProfilePictureUrl != null).Select(su => su.ProfilePictureUrl!).ToListAsync(cancellationToken));
            referenced.UnionWith(await dbContext.SchoolUsers.Where(su => su.AccountPictureKey != null).Select(su => su.AccountPictureKey!).ToListAsync(cancellationToken));
            referenced.UnionWith(await dbContext.LinkedAccounts.Where(a => a.PictureKey != null).Select(a => a.PictureKey!).ToListAsync(cancellationToken));

            // With no references at all this is a fresh or wrong database, not a bucket full of garbage.
            if (referenced.Count == 0)
                return 0;

            var cutoff = DateTime.UtcNow.AddDays(-Math.Max(1, options.Value.OrphanBlobGraceDays));
            var deleted = 0;
            await foreach (var blob in documentStorage.ListAsync(cancellationToken))
            {
                if (blob.LastModifiedUtc >= cutoff || !BlobKeys.HasUploadShape(blob.Key) || referenced.Contains(blob.Key))
                    continue;

                await documentStorage.DeleteAsync(blob.Key, cancellationToken);
                deleted++;
            }

            return deleted;
        }
    }
}
