using Microsoft.Extensions.Configuration;
using Schuly.Domain;

namespace Schuly.Application.Dtos
{
    public record PrivacyNoticeStatusDto(string PolicyVersion, string PolicyUrl, bool AcceptanceRequired, bool SwissSchoolConfirmationRequired, string? AcceptedVersion, DateTime? AcceptedAt, DateTime? SwissSchoolConfirmedAt);

    /// <summary>The notice settings. The notice and its version apply to every server; the Swiss-school confirmation only to one with <c>SignUp:SwitzerlandOnly</c>.</summary>
    public static class PrivacyNotice
    {
        public const string DefaultVersion = "2026-11-03";
        public const string DefaultUrl = "https://schuly.dev/privacy";

        public static string Version(IConfiguration configuration) => configuration["Privacy:PolicyVersion"] is { Length: > 0 } version ? version : DefaultVersion;

        public static string Url(IConfiguration configuration) => configuration["Privacy:PolicyUrl"] is { Length: > 0 } url ? url : DefaultUrl;

        public static bool SwissSchoolConfirmationRequired(IConfiguration configuration) => configuration.GetValue<bool>("SignUp:SwitzerlandOnly");

        public static PrivacyNoticeStatusDto Status(ApplicationUser user, IConfiguration configuration)
        {
            var swissRequired = SwissSchoolConfirmationRequired(configuration);
            var required = user.PolicyVersionAccepted != Version(configuration) || (swissRequired && user.SwissSchoolConfirmedAt is null);
            return new PrivacyNoticeStatusDto(Version(configuration), Url(configuration), required, swissRequired, user.PolicyVersionAccepted, user.PolicyAcceptedAt, user.SwissSchoolConfirmedAt);
        }
    }
}
