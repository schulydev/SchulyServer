namespace Schuly.API.Extensions
{
    /// <summary>Sets the browser security headers on every response, however Schuly is hosted. A response that already set one, like the consent page or a file download, keeps its stricter value.</summary>
    public class SecurityHeaders(RequestDelegate next)
    {
        // Camera and microphone stay allowed for this site: chats record video clips with them.
        private const string PermissionsPolicy = "camera=(self), microphone=(self), geolocation=()";

        // Report-only: browsers log what it would block in the console, and nothing breaks.
        // https: images and media are for mail, Teams and OneNote content. blob: is for the file viewer, chat clips and previews.
        private const string ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

        public Task InvokeAsync(HttpContext context)
        {
            context.Response.OnStarting(() =>
            {
                var headers = context.Response.Headers;
                // Only over HTTPS, which behind a proxy needs the proxy in ForwardedHeaders:KnownNetworks.
                if (context.Request.IsHttps)
                    headers.TryAdd("Strict-Transport-Security", "max-age=31536000");
                headers.TryAdd("X-Content-Type-Options", "nosniff");
                headers.TryAdd("X-Frame-Options", "DENY");
                headers.TryAdd("Referrer-Policy", "same-origin");
                headers.TryAdd("Permissions-Policy", PermissionsPolicy);
                headers.TryAdd("Content-Security-Policy-Report-Only", ContentSecurityPolicy);
                return Task.CompletedTask;
            });
            return next(context);
        }
    }
}
