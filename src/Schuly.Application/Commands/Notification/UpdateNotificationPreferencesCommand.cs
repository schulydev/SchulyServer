using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Domain;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Commands.Notification
{
    [AllowAuthenticated]
    public record UpdateNotificationPreferencesCommand(bool Grades, bool Absences, bool Agenda, bool IncludeGradeValue, bool IncludeDetails = false) : ICommand<Result>;

    public class UpdateNotificationPreferencesCommandHandler(SchulyDbContext dbContext, IUserService userService) : ICommandHandler<UpdateNotificationPreferencesCommand, Result>
    {
        public async ValueTask<Result> Handle(UpdateNotificationPreferencesCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var existing = await dbContext.NotificationPreferences.SingleOrDefaultAsync(p => p.ApplicationUserId == userId, cancellationToken);

            if (existing is not null)
            {
                existing.Grades = command.Grades;
                existing.Absences = command.Absences;
                existing.Agenda = command.Agenda;
                existing.IncludeGradeValue = command.IncludeGradeValue;
                existing.IncludeDetails = command.IncludeDetails;
            }
            else
            {
                await dbContext.NotificationPreferences.AddAsync(new NotificationPreference
                {
                    ApplicationUserId = userId,
                    Grades = command.Grades,
                    Absences = command.Absences,
                    Agenda = command.Agenda,
                    IncludeGradeValue = command.IncludeGradeValue,
                    IncludeDetails = command.IncludeDetails
                }, cancellationToken);
            }

            await dbContext.SaveChangesAsync(cancellationToken);

            return Result.Success();
        }
    }
}
