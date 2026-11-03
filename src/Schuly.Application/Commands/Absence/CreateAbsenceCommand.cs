using Mediator;
using Schuly.Application.Models;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Application.Authorization;

namespace Schuly.Application.Commands.Absence
{
    [AllowAuthenticated]
    public record CreateAbsenceCommand(string Reason, AbsenceType Type, DateTime From, DateTime Until, Guid SchoolUserId) : ICommand<Result>;

    public class CreateAbsenceCommandHandler(SchulyDbContext dbContext, IUserService userService) : ICommandHandler<CreateAbsenceCommand, Result>
    {
        public async ValueTask<Result> Handle(CreateAbsenceCommand command, CancellationToken cancellationToken)
        {
            if (ManualEdit.RequireOffset(command.From, command.Until) is { } invalid)
                return invalid;

            // Normalise before comparing: From and Until can arrive with different DateTimeKinds.
            if (UtcDateTime.Normalize(command.From) > UtcDateTime.Normalize(command.Until))
                return Result.Failure("From must not be after Until");

            if (command.Reason.Length > Domain.Absence.MaxReasonLength)
                return Result.Failure($"The reason can have at most {Domain.Absence.MaxReasonLength} characters.");

            var myIds = await userService.GetCurrentUserSchoolUserIdsAsync(cancellationToken);
            if (!myIds.Contains(command.SchoolUserId))
                return Result.Forbidden();

            await dbContext.Absences.AddAsync(new Domain.Absence
            {
                Reason = command.Reason,
                Type = command.Type,
                From = command.From,
                Until = command.Until,
                SchoolUserId = command.SchoolUserId
            }, cancellationToken);

            await dbContext.SaveChangesAsync(cancellationToken);

            return Result.Success();
        }
    }
}
