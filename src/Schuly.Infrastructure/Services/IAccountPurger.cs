namespace Schuly.Infrastructure.Services
{
    public record AccountPurgeSummary(int SchoolUsers, int Documents, int BlobsDeleted, int BlobsFailed, int PluginPurgesFailed = 0);

    public record PendingPurgeResult(int Completed, int StillFailing);

    public interface IAccountPurger
    {
        /// <summary>
        /// Permanently deletes an ApplicationUser and everything owned by it: every
        /// SchoolUser linked to the account and all of their user-scoped data, the
        /// document blobs those SchoolUsers own, and the ApplicationUser row itself.
        /// Teacher records linked to the account are unlinked, not deleted, since they
        /// are school-owned master data. Returns a summary of what was removed.
        /// </summary>
        Task<AccountPurgeSummary> PurgeApplicationUserAsync(Guid applicationUserId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Permanently deletes the given SchoolUser rows and everything scoped to them
        /// (grades, absences, agenda entries, semester reports, documents, class
        /// memberships) without touching the owning ApplicationUser. Returns a summary
        /// of what was removed.
        /// </summary>
        Task<AccountPurgeSummary> PurgeSchoolUsersAsync(IReadOnlyCollection<Guid> schoolUserIds, CancellationToken cancellationToken = default);

        /// <summary>
        /// Asks every plugin, or only <paramref name="pluginSource"/>, to wipe the user's data, without
        /// touching host rows. A failure is queued for retry. Returns the number of plugins that failed.
        /// </summary>
        Task<int> PurgePluginDataAsync(Guid applicationUserId, string? pluginSource, CancellationToken cancellationToken = default);

        /// <summary>Retries every deletion step that failed earlier.</summary>
        Task<PendingPurgeResult> RetryPendingAsync(CancellationToken cancellationToken = default);
    }
}
