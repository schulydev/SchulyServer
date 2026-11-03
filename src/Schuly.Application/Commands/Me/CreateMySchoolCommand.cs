using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Commands.Me
{
    /// <summary>Creates a school of the user's own, with them as its student, for using Schuly without a provider.</summary>
    [AllowAuthenticated]
    public record CreateMySchoolCommand(string SchoolName, string FirstName, string LastName) : ICommand<Result<Guid>>;

    public class CreateMySchoolCommandHandler(SchulyDbContext dbContext, IUserService userService) : ICommandHandler<CreateMySchoolCommand, Result<Guid>>
    {
        public async ValueTask<Result<Guid>> Handle(CreateMySchoolCommand command, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(command.SchoolName) || command.SchoolName.Length > 200)
                return Result.Failure<Guid>("School name must be 1 to 200 characters");
            if (command.FirstName.Length > 100 || command.LastName.Length > 100)
                return Result.Failure<Guid>("Names must be at most 100 characters");

            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var email = await dbContext.ApplicationUsers
                .Where(u => u.Id == userId)
                .Select(u => u.Email)
                .SingleOrDefaultAsync(cancellationToken);

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var school = new Domain.School { Name = command.SchoolName.Trim() };
            var student = new Domain.SchoolUser
            {
                ApplicationUserId = userId,
                School = school,
                FirstName = command.FirstName.Trim(),
                LastName = command.LastName.Trim(),
                Email = email ?? "",
                EntryDate = today,
                Role = Roles.Student,
            };

            dbContext.Schools.Add(school);
            dbContext.SchoolUsers.Add(student);
            await dbContext.SaveChangesAsync(cancellationToken);

            return Result.Success(student.Id);
        }
    }
}
