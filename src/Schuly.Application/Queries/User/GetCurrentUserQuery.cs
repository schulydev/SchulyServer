using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Dtos;
using Schuly.Application.Mappers;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Application.Authorization;
using Toamaisutaa.Abstractions;

namespace Schuly.Application.Queries.User
{
    [AllowAuthenticated]
    public record GetCurrentUserQuery() : IQuery<Result<ApplicationUserDto>>;

    public class GetCurrentUserQueryHandler(IUserService userService, SchulyDbContext dbContext, IAvatarUrlSigner avatarUrlSigner, IPasswordCredentialStore credentials, IExternalLoginStore externalLogins) : IQueryHandler<GetCurrentUserQuery, Result<ApplicationUserDto>>
    {
        public async ValueTask<Result<ApplicationUserDto>> Handle(GetCurrentUserQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var user = await dbContext.ApplicationUsers
                .AsNoTracking()
                .Include(u => u.SchoolUsers)
                .SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);

            if (user == null)
                return Result<ApplicationUserDto>.Failure("User not found");

            var dto = user.ToDto();
            dto.ProfilePictureUrl = avatarUrlSigner.ToPublicUserUrl(user.Id, user.ProfilePictureUrl);
            var hasLogin = Guid.TryParse(user.ExternalId, out var loginId);
            var credential = hasLogin ? await credentials.FindByUserIdAsync(loginId, cancellationToken) : null;
            dto.HasPassword = credential is not null;
            // Confirmed here by code, or by a provider that said it verified this address.
            dto.EmailConfirmed = (credential?.EmailConfirmedAt is not null && string.Equals(credential.Email, user.Email, StringComparison.OrdinalIgnoreCase))
                || (hasLogin && (await externalLogins.ListAsync(loginId, cancellationToken)).Any(login => login.EmailVerified && string.Equals(login.Email, user.Email, StringComparison.OrdinalIgnoreCase)));
            return Result<ApplicationUserDto>.Success(dto);
        }
    }
}
