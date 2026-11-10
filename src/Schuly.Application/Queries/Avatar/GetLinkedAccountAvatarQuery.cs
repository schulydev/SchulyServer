using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;

namespace Schuly.Application.Queries.Avatar
{
    /// <summary>Only the caller's own linked account; anyone else's is "not found".</summary>
    [AllowAuthenticated]
    public record GetLinkedAccountAvatarQuery(Guid LinkedAccountId) : IQuery<Result<AvatarDownload>>;

    public class GetLinkedAccountAvatarQueryHandler(SchulyDbContext db, IDocumentStorage storage, IUserService userService) : IQueryHandler<GetLinkedAccountAvatarQuery, Result<AvatarDownload>>
    {
        public async ValueTask<Result<AvatarDownload>> Handle(GetLinkedAccountAvatarQuery query, CancellationToken ct)
        {
            var userId = await userService.GetCurrentUserIdAsync(ct);
            var key = await db.LinkedAccounts
                .AsNoTracking()
                .Where(a => a.Id == query.LinkedAccountId && a.ApplicationUserId == userId)
                .Select(a => a.PictureKey)
                .SingleOrDefaultAsync(ct);

            if (!BlobKeys.IsStored(key))
                return Result<AvatarDownload>.Failure("No stored picture for this account");

            var stream = await storage.OpenReadAsync(key!, ct);
            return Result<AvatarDownload>.Success(new AvatarDownload(stream));
        }
    }
}
