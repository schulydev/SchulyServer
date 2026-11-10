using Microsoft.EntityFrameworkCore;

namespace Schuly.Infrastructure.Services
{
    /// <summary>
    /// Signed picture URLs for the rows of the accounts list. A plugin names the student profile or linked account a row
    /// stands for; only ones that belong to <c>applicationUserId</c> are looked at, so a row can never show someone else's picture.
    /// </summary>
    public sealed class AccountPictureUrls(SchulyDbContext db, IAvatarUrlSigner signer)
    {
        public async Task<AccountPictureLookup> ResolveAsync(Guid applicationUserId, IReadOnlyCollection<Guid> schoolUserIds, IReadOnlyCollection<Guid> linkedAccountIds, CancellationToken ct)
        {
            var students = schoolUserIds.Count == 0
                ? []
                : await db.SchoolUsers.AsNoTracking()
                    .Where(su => su.ApplicationUserId == applicationUserId && schoolUserIds.Contains(su.Id) && su.ProfilePictureUrl != null)
                    .Select(su => new { su.Id, su.ProfilePictureUrl })
                    .ToListAsync(ct);

            var accounts = linkedAccountIds.Count == 0
                ? []
                : await db.LinkedAccounts.AsNoTracking()
                    .Where(a => a.ApplicationUserId == applicationUserId && linkedAccountIds.Contains(a.Id) && a.PictureKey != null)
                    .Select(a => new { a.Id, a.PictureKey })
                    .ToListAsync(ct);

            return new AccountPictureLookup(
                students.Select(s => (s.Id, Url: signer.ToPublicUrl(s.Id, s.ProfilePictureUrl))).Where(s => s.Url is not null).ToDictionary(s => s.Id, s => s.Url!),
                accounts.Select(a => (a.Id, Url: signer.ToPublicAccountUrl(a.Id, a.PictureKey))).Where(a => a.Url is not null).ToDictionary(a => a.Id, a => a.Url!));
        }
    }

    public sealed record AccountPictureLookup(IReadOnlyDictionary<Guid, string> SchoolUsers, IReadOnlyDictionary<Guid, string> LinkedAccounts)
    {
        /// <summary>The linked account's own picture wins over the student profile's.</summary>
        public string? For(Guid? schoolUserId, Guid? linkedAccountId) =>
            linkedAccountId is { } a && LinkedAccounts.TryGetValue(a, out var account) ? account
            : schoolUserId is { } s && SchoolUsers.TryGetValue(s, out var student) ? student
            : null;
    }
}
