using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Queries.Notification
{
    [AllowAuthenticated]
    public record GetNotificationPreferencesQuery() : IQuery<Result<NotificationPreferencesDto>>;

    public class GetNotificationPreferencesQueryHandler(SchulyDbContext dbContext, IUserService userService) : IQueryHandler<GetNotificationPreferencesQuery, Result<NotificationPreferencesDto>>
    {
        public async ValueTask<Result<NotificationPreferencesDto>> Handle(GetNotificationPreferencesQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);

            var preference = await dbContext.NotificationPreferences
                .AsNoTracking()
                .SingleOrDefaultAsync(p => p.ApplicationUserId == userId, cancellationToken);

            var dto = preference is null
                ? new NotificationPreferencesDto(true, true, true, false, false)
                : new NotificationPreferencesDto(preference.Grades, preference.Absences, preference.Agenda, preference.IncludeGradeValue, preference.IncludeDetails);

            return Result<NotificationPreferencesDto>.Success(dto);
        }
    }
}
