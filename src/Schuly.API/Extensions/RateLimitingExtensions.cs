using System.Net;
using System.Net.Sockets;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Schuly.API.Extensions
{
    public static class LinkRateLimits
    {
        public const string Start = "link-start";
        public const string Submit = "link-submit";
        public const string Poll = "link-poll";
    }

    public static class AccountRateLimits
    {
        public const string Delete = "account-delete";
    }

    public static class RateLimitingExtensions
    {
        public static IServiceCollection AddSchulyRateLimiting(this IServiceCollection services)
        {
            services.AddRateLimiter(options =>
            {
                options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                options.OnRejected = async (context, token) =>
                {
                    context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                    if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                        context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString();
                    await context.HttpContext.Response.WriteAsJsonAsync(new { message = "Too many requests. Please wait a moment and try again." }, token);
                };
                AddLinkPolicy(options, LinkRateLimits.Start, 10);
                AddLinkPolicy(options, LinkRateLimits.Submit, 20);
                AddLinkPolicy(options, LinkRateLimits.Poll, 60);
                AddLinkPolicy(options, AccountRateLimits.Delete, 5, TimeSpan.FromMinutes(15));
                var perUser = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                {
                    var subject = context.User.Identity?.IsAuthenticated == true
                        ? context.User.FindFirst("sub")?.Value ?? context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                        : null;

                    var partitionKey = subject is { Length: > 0 }
                        ? $"sub:{subject}"
                        : $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";

                    return RateLimitPartition.GetFixedWindowLimiter(
                        partitionKey,
                        _ => new FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1) });
                });

                options.GlobalLimiter = PartitionedRateLimiter.CreateChained(perUser, LinkIpLimiter(), AnonymousLoginIpLimiter());
            });

            return services;
        }

        /// <summary>
        /// Per-client-IP cap on linking start/submit. The IP is Connection.RemoteIpAddress, which the ForwardedHeaders
        /// middleware (run earlier, with the configured trusted proxies) has already resolved; X-Forwarded-For is never read here.
        /// </summary>
        public static PartitionedRateLimiter<HttpContext> LinkIpLimiter(int startPerMinute = 30, int submitPerMinute = 60) =>
            PartitionedRateLimiter.Create<HttpContext, string>(context =>
            {
                if (!HttpMethods.IsPost(context.Request.Method))
                    return RateLimitPartition.GetNoLimiter("none");

                var path = context.Request.Path.Value ?? string.Empty;
                var (kind, permits) = path switch
                {
                    _ when path.StartsWith("/api/linking/providers/", StringComparison.OrdinalIgnoreCase) && path.EndsWith("/start", StringComparison.OrdinalIgnoreCase) => ("start", startPerMinute),
                    _ when path.StartsWith("/api/linking/sessions/", StringComparison.OrdinalIgnoreCase) && path.EndsWith("/submit", StringComparison.OrdinalIgnoreCase) => ("submit", submitPerMinute),
                    _ => ("", 0),
                };
                if (permits == 0)
                    return RateLimitPartition.GetNoLimiter("none");

                var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                return RateLimitPartition.GetFixedWindowLimiter($"link-ip-{kind}:{ip}", _ => new FixedWindowRateLimiterOptions { PermitLimit = permits, Window = TimeSpan.FromMinutes(1) });
            });

        /// <summary>
        /// Per-client-IP cap on the anonymous private-mode routes that take a school password, so the server can't be used to test passwords against a school.
        /// Done here rather than on the plugin controllers so it holds for whichever plugin version is installed. IPv6 clients count as their /64.
        /// </summary>
        public static PartitionedRateLimiter<HttpContext> AnonymousLoginIpLimiter(int perMinute = 10) =>
            PartitionedRateLimiter.Create<HttpContext, string>(context =>
            {
                if (!HttpMethods.IsPost(context.Request.Method) || !IsAnonymousLogin(context.Request.Path.Value))
                    return RateLimitPartition.GetNoLimiter("none");

                return RateLimitPartition.GetFixedWindowLimiter($"anonymous-login:{ClientKey(context.Connection.RemoteIpAddress)}", _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1) });
            });

        private static bool IsAnonymousLogin(string? path) => path is not null && path.TrimEnd('/').ToLowerInvariant() is "/api/plugins/schulware/stateless/login" or "/api/plugins/odaorg/stateless/data";

        private static string ClientKey(IPAddress? address)
        {
            if (address is null)
                return "unknown";
            if (address.IsIPv4MappedToIPv6)
                return address.MapToIPv4().ToString();
            if (address.AddressFamily != AddressFamily.InterNetworkV6)
                return address.ToString();

            var bytes = address.GetAddressBytes();
            Array.Clear(bytes, 8, 8);
            return new IPAddress(bytes).ToString();
        }

        private static void AddLinkPolicy(RateLimiterOptions options, string name, int permits, TimeSpan? window = null) =>
            options.AddPolicy(name, context =>
            {
                var subject = context.User.FindFirst("sub")?.Value ?? context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                return RateLimitPartition.GetFixedWindowLimiter($"{name}:{subject}", _ => new FixedWindowRateLimiterOptions { PermitLimit = permits, Window = window ?? TimeSpan.FromMinutes(1) });
            });
    }
}
