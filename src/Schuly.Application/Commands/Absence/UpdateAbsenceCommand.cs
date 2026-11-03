using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Models;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Application.Authorization;

namespace Schuly.Application.Commands.Absence
{
    [AllowAuthenticated]
    public record UpdateAbsenceCommand(Guid AbsenceId, string Reason, AbsenceType Type, DateTime From, DateTime Until, Guid SchoolUserId) : ICommand<Result>;

    public class UpdateAbsenceCommandHandler(SchulyDbContext dbContext, IUserService userService) : ICommandHandler<UpdateAbsenceCommand, Result>
    {
        public async ValueTask<Result> Handle(UpdateAbsenceCommand command, CancellationToken cancellationToken)
        {
            if (ManualEdit.RequireOffset(command.From, command.Until) is { } invalid)
                return invalid;

            // Normalise before comparing: From and Until can arrive with different DateTimeKinds.
            if (UtcDateTime.Normalize(command.From) > UtcDateTime.Normalize(command.Until))
                return Result.Failure("From must not be after Until");

            if (command.Reason.Length > Domain.Absence.MaxReasonLength)
                return Result.Failure($"The reason can have at most {Domain.Absence.MaxReasonLength} characters.");

            var myIds = await userService.GetCurrentUserSchoolUserIdsAsync(cancellationToken);

            var absence = await dbContext.Absences
                .SingleOrDefaultAsync(a => a.Id == command.AbsenceId && myIds.Contains(a.SchoolUserId), cancellationToken);

            if (absence == null)
                return Result.NotFound($"Absence with ID '{command.AbsenceId}' not found");

            if (ManualEdit.RefuseSynced(absence) is { } synced)
                return synced;

            if (!myIds.Contains(command.SchoolUserId))
                return Result.Forbidden();

            absence.Reason = command.Reason;
            absence.Type = command.Type;
            absence.From = command.From;
            absence.Until = command.Until;
            absence.SchoolUserId = command.SchoolUserId;

            await dbContext.SaveChangesAsync(cancellationToken);

            return Result.Success();
        }
    }
}
