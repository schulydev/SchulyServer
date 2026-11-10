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

        /// <summary>The oldest mobile app that still works with this API (<c>App:MinVersion</c>); older apps ask the user to update. Unset or not a version: none.</summary>
        public static string? MinAppVersion(IConfiguration configuration) =>
            System.Version.TryParse(configuration["App:MinVersion"]?.Trim(), out var min) ? min.ToString() : null;

        public async ValueTask<Result<AppDto>> Handle(AppQuery query, CancellationToken cancellationToken)
        {
            return Result<AppDto>.Success(new AppDto(Version, configuration.GetValue("LocalLogin:AllowSelfRegistration", false), PrivacyNotice.Version(configuration), PrivacyNotice.Url(configuration), PrivacyNotice.SwissSchoolConfirmationRequired(configuration), MinAppVersion(configuration)));
        }
    }
}
