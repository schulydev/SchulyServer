using Mediator;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Schuly.Application.Authorization;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Commands.User
{
    /// <summary>Records that the user saw this version of the notice and, on a server with <c>SignUp:SwitzerlandOnly</c>, that they attend a school in Switzerland.</summary>
    [AllowAuthenticated]
    public record AcceptPrivacyNoticeCommand(string PolicyVersion, bool SwissSchoolConfirmed) : ICommand<Result<PrivacyNoticeStatusDto>>;

    public class AcceptPrivacyNoticeCommandHandler(SchulyDbContext dbContext, IUserService userService, IConfiguration configuration) : ICommandHandler<AcceptPrivacyNoticeCommand, Result<PrivacyNoticeStatusDto>>
    {
        public async ValueTask<Result<PrivacyNoticeStatusDto>> Handle(AcceptPrivacyNoticeCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var user = await dbContext.ApplicationUsers.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (user is null)
                return Result<PrivacyNoticeStatusDto>.Failure("User not found");

            if (command.PolicyVersion != PrivacyNotice.Version(configuration))
                return Result<PrivacyNoticeStatusDto>.Failure("The privacy policy has changed. Read the current version and try again.");

            var swissRequired = PrivacyNotice.SwissSchoolConfirmationRequired(configuration);
            if (swissRequired && !command.SwissSchoolConfirmed)
                return Result<PrivacyNoticeStatusDto>.Failure("Confirm that you attend a school in Switzerland.");

            var now = DateTime.UtcNow;
            user.PolicyVersionAccepted = command.PolicyVersion;
            user.PolicyAcceptedAt = now;
            if (swissRequired)
                user.SwissSchoolConfirmedAt = now;
            await dbContext.SaveChangesAsync(cancellationToken);

            return Result<PrivacyNoticeStatusDto>.Success(PrivacyNotice.Status(user, configuration));
        }
    }
}
