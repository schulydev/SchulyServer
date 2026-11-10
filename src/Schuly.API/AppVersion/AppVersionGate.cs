using Schuly.Application.Queries.App;

namespace Schuly.API.AppVersion
{
    /// <summary>
    /// Answers 426 to a mobile app older than <c>App:MinVersion</c>, so it shows its "please update" screen instead of failing on API changes.
    /// Only requests that name their version (<see cref="Header"/>) are checked: the web app and apps from before the header pass. <c>/api/app</c>
    /// stays open so an old app can still read the minimum.
    /// </summary>
    public sealed class AppVersionGate(RequestDelegate next, IConfiguration configuration)
    {
        public const string Header = "X-Schuly-App-Version";
        public const string Code = "app_update_required";

        public async Task InvokeAsync(HttpContext context)
        {
            if (IsTooOld(context.Request, configuration) is { } min)
            {
                context.Response.StatusCode = StatusCodes.Status426UpgradeRequired;
                await context.Response.WriteAsJsonAsync(new { code = Code, minAppVersion = min, message = "This version of Schuly is too old. Update the app to continue." });
                return;
            }
            await next(context);
        }

        /// <summary>The minimum version when the request comes from an app below it, else null.</summary>
        public static string? IsTooOld(HttpRequest request, IConfiguration configuration)
        {
            var path = request.Path;
            if (!(path.StartsWithSegments("/api") || path.StartsWithSegments("/auth")) || path.StartsWithSegments("/api/app", StringComparison.OrdinalIgnoreCase) && !path.StartsWithSegments("/api/app/school-systems"))
                return null;
            if (AppQueryHandler.MinAppVersion(configuration) is not { } min) return null;
            // Pre-release or build suffixes ("3.6.0-beta+12") are cut off; an unreadable version is let through.
            var sent = request.Headers[Header].ToString().Split('-', '+')[0].Trim();
            return System.Version.TryParse(sent, out var app) && app < System.Version.Parse(min) ? min : null;
        }
    }
}
