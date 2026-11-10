using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;

namespace Schuly.Application.Queries.Avatar
{
    public record AvatarDownload(DocumentStream Stream);

    /// <summary>Only the caller's own school profile; anyone else's is "not found".</summary>
    [AllowAuthenticated]
    public record GetAvatarQuery(Guid SchoolUserId) : IQuery<Result<AvatarDownload>>;

    public class GetAvatarQueryHandler(SchulyDbContext db, IDocumentStorage storage, IUserService userService) : IQueryHandler<GetAvatarQuery, Result<AvatarDownload>>
    {
        public async ValueTask<Result<AvatarDownload>> Handle(GetAvatarQuery query, CancellationToken ct)
        {
            var userId = await userService.GetCurrentUserIdAsync(ct);
            var key = await db.SchoolUsers
                .AsNoTracking()
                .Where(su => su.Id == query.SchoolUserId && su.ApplicationUserId == userId)
                .Select(su => su.ProfilePictureUrl)
                .SingleOrDefaultAsync(ct);

            if (string.IsNullOrWhiteSpace(key) ||
                key.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                key.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return Result<AvatarDownload>.Failure("No stored avatar for this user");

            var stream = await storage.OpenReadAsync(key, ct);
            return Result<AvatarDownload>.Success(new AvatarDownload(stream));
        }
    }
}
