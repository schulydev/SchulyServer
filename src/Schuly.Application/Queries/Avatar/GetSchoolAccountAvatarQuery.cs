using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;

namespace Schuly.Application.Queries.Avatar
{
    /// <summary>The own picture of one of the caller's school accounts; anyone else's is "not found".</summary>
    [AllowAuthenticated]
    public record GetSchoolAccountAvatarQuery(Guid SchoolUserId) : IQuery<Result<AvatarDownload>>;

    public class GetSchoolAccountAvatarQueryHandler(SchulyDbContext db, IDocumentStorage storage, IUserService userService) : IQueryHandler<GetSchoolAccountAvatarQuery, Result<AvatarDownload>>
    {
        public async ValueTask<Result<AvatarDownload>> Handle(GetSchoolAccountAvatarQuery query, CancellationToken ct)
        {
            var userId = await userService.GetCurrentUserIdAsync(ct);
            var key = await db.SchoolUsers
                .AsNoTracking()
                .Where(su => su.Id == query.SchoolUserId && su.ApplicationUserId == userId)
                .Select(su => su.AccountPictureKey)
                .SingleOrDefaultAsync(ct);

            if (!BlobKeys.IsStored(key))
                return Result<AvatarDownload>.Failure("No stored picture for this school account");

            var stream = await storage.OpenReadAsync(key!, ct);
            return Result<AvatarDownload>.Success(new AvatarDownload(stream));
        }
    }
}
