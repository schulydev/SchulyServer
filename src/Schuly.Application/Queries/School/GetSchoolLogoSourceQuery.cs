using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Infrastructure;

namespace Schuly.Application.Queries.School
{
    /// <summary>Where the logo of a school comes from. Only the server reads this; clients get <see cref="SchoolLogoPath"/>.</summary>
    [AllowAuthenticated]
    public record GetSchoolLogoSourceQuery(Guid SchoolId) : IQuery<Result<string>>;

    public class GetSchoolLogoSourceQueryHandler(SchulyDbContext dbContext) : IQueryHandler<GetSchoolLogoSourceQuery, Result<string>>
    {
        public async ValueTask<Result<string>> Handle(GetSchoolLogoSourceQuery query, CancellationToken cancellationToken)
        {
            var source = await dbContext.Schools.AsNoTracking().Where(s => s.Id == query.SchoolId).Select(s => s.LogoUrl).SingleOrDefaultAsync(cancellationToken);
            return string.IsNullOrWhiteSpace(source) ? Result<string>.NotFound("No logo") : Result<string>.Success(source);
        }
    }

    /// <summary>The address clients load a school's logo from: this server, so the logo's real host never sees a user.</summary>
    public static class SchoolLogoPath
    {
        public static string? For(Guid schoolId, string? source) => string.IsNullOrWhiteSpace(source) ? null : $"/api/schools/{schoolId}/logo";
    }
}
