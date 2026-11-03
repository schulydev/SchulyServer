using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Toamaisutaa.Abstractions;

namespace Schuly.Application.Commands.User
{
    [AllowAuthenticated]
    public record DeleteCurrentUserCommand() : ICommand<Result>;

    public class DeleteCurrentUserCommandHandler(SchulyDbContext dbContext, IUserService userService, IAccountPurger accountPurger, IUserStore userStore) : ICommandHandler<DeleteCurrentUserCommand, Result>
    {
        public async ValueTask<Result> Handle(DeleteCurrentUserCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var externalId = await dbContext.ApplicationUsers.Where(u => u.Id == userId).Select(u => u.ExternalId).SingleOrDefaultAsync(cancellationToken);

            if (externalId is null)
                return Result.Failure("User not found");

            // The sign-in goes first: from here on every token is refused, so no request can recreate the
            // user while the purge runs. If the purge then fails, the daily sweep finishes it.
            if (Guid.TryParse(externalId, out var loginId))
                await userStore.DeleteAsync(loginId, cancellationToken);

            await accountPurger.PurgeApplicationUserAsync(userId, cancellationToken);

            return Result.Success();
        }
    }
}
