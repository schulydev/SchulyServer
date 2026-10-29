using System.IO.Compression;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace Schuly.API.Extensions
{
    public static class PerformanceExtensions
    {
        public static IServiceCollection AddSchulyResponseCompression(this IServiceCollection services)
        {
            services.AddResponseCompression(options =>
            {
                options.EnableForHttps = true;
                options.Providers.Add<BrotliCompressionProvider>();
                options.Providers.Add<GzipCompressionProvider>();
                options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["image/svg+xml", "application/problem+json"]);
            });
            services.Configure<BrotliCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
            services.Configure<GzipCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
            return services;
        }

        /// <summary>
        /// Compresses everything except <c>/auth</c>, whose responses carry tokens (compressing secrets next to request-influenced content over TLS invites BREACH), and the
        /// POSTs under <c>/api/helply</c>, which are server-sent event streams that a compressor would buffer until they end.
        /// </summary>
        public static IApplicationBuilder UseSchulyResponseCompression(this IApplicationBuilder app) =>
            app.UseWhen(context => !context.Request.Path.StartsWithSegments("/auth") && !(HttpMethods.IsPost(context.Request.Method) && context.Request.Path.StartsWithSegments("/api/helply")), branch => branch.UseResponseCompression());
    }

    /// <summary>Cache headers for the web app's files: hashed build output is immutable, index.html is always revalidated so a release shows up at once.</summary>
    public static partial class StaticAssetCaching
    {
        [GeneratedRegex(@"-[A-Z0-9]{8}\.(js|css|woff2?)$")]
        private static partial Regex HashedName();

        public static StaticFileOptions Options { get; } = new()
        {
            OnPrepareResponse = context =>
            {
                var name = context.File.Name;
                context.Context.Response.Headers[HeaderNames.CacheControl] = HashedName().IsMatch(name)
                    ? "public, max-age=31536000, immutable"
                    : name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
                        ? "no-cache"
                        : "public, max-age=86400";
            },
        };
    }
}
