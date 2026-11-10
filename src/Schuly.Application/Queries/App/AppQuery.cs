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

        /// <summary>
        /// The oldest mobile app that still works with this API. Raise it in the same change that breaks older apps; they then show
        /// "please update". An operator can override it with <c>App:MinVersion</c> (env <c>App__MinVersion</c>, "0.0.0" turns it off).
        /// </summary>
        public const string DefaultMinAppVersion = "3.5.0";

        /// <summary><c>App:MinVersion</c> when it is a version, else <see cref="DefaultMinAppVersion"/>.</summary>
        public static string MinAppVersion(IConfiguration configuration) =>
            System.Version.TryParse(configuration["App:MinVersion"]?.Trim(), out var min) ? min.ToString() : DefaultMinAppVersion;

        public async ValueTask<Result<AppDto>> Handle(AppQuery query, CancellationToken cancellationToken)
        {
            return Result<AppDto>.Success(new AppDto(Version, configuration.GetValue("LocalLogin:AllowSelfRegistration", false), PrivacyNotice.Version(configuration), PrivacyNotice.Url(configuration), PrivacyNotice.SwissSchoolConfirmationRequired(configuration), MinAppVersion(configuration)));
        }
    }
}
