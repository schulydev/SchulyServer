using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Commands.User;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;

namespace Schuly.Application.Queries.Avatar
{
    [AllowAuthenticated]
    public record GetUserAvatarQuery(Guid ApplicationUserId) : IQuery<Result<AvatarDownload>>;

    public class GetUserAvatarQueryHandler(SchulyDbContext db, IDocumentStorage storage, IUserService userService) : IQueryHandler<GetUserAvatarQuery, Result<AvatarDownload>>
    {
        public async ValueTask<Result<AvatarDownload>> Handle(GetUserAvatarQuery query, CancellationToken ct)
        {
            if (query.ApplicationUserId != await userService.GetCurrentUserIdAsync(ct))
                return Result<AvatarDownload>.Failure("No stored avatar for this user");

            var key = await db.ApplicationUsers
                .AsNoTracking()
                .Where(u => u.Id == query.ApplicationUserId)
                .Select(u => u.ProfilePictureUrl)
                .SingleOrDefaultAsync(ct);

            if (!SetMyAvatarCommandHandler.IsStoredKey(key))
                return Result<AvatarDownload>.Failure("No stored avatar for this user");

            var stream = await storage.OpenReadAsync(key!, ct);
            return Result<AvatarDownload>.Success(new AvatarDownload(stream));
        }
    }
}
