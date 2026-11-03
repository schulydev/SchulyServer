using System.Reflection;
using Mediator;
using Microsoft.Extensions.Configuration;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Application.Authorization;

namespace Schuly.Application.Queries.App
{
    [AllowAuthenticated]
    public record AppQuery() : IQuery<Result<AppDto>>;

    public class AppQueryHandler(IConfiguration configuration) : IQueryHandler<AppQuery, Result<AppDto>>
    {
        private static readonly string Version =
            (Assembly.GetEntryAssembly() ?? typeof(AppQueryHandler).Assembly)
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion
                ?.Split('+')[0]
            ?? "0.0.0";

        public async ValueTask<Result<AppDto>> Handle(AppQuery query, CancellationToken cancellationToken)
        {
            return Result<AppDto>.Success(new AppDto(Version, configuration.GetValue("LocalLogin:AllowSelfRegistration", false), PrivacyNotice.Version(configuration), PrivacyNotice.Url(configuration), PrivacyNotice.SwissSchoolConfirmationRequired(configuration)));
        }
    }
}
