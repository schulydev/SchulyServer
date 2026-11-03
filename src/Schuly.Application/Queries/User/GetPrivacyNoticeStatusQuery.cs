using Mediator;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Schuly.Application.Authorization;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Queries.User
{
    [AllowAuthenticated]
    public record GetPrivacyNoticeStatusQuery() : IQuery<Result<PrivacyNoticeStatusDto>>;

    public class GetPrivacyNoticeStatusQueryHandler(SchulyDbContext dbContext, IUserService userService, IConfiguration configuration) : IQueryHandler<GetPrivacyNoticeStatusQuery, Result<PrivacyNoticeStatusDto>>
    {
        public async ValueTask<Result<PrivacyNoticeStatusDto>> Handle(GetPrivacyNoticeStatusQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var user = await dbContext.ApplicationUsers.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
            return user is null ? Result<PrivacyNoticeStatusDto>.Failure("User not found") : Result<PrivacyNoticeStatusDto>.Success(PrivacyNotice.Status(user, configuration));
        }
    }
}
