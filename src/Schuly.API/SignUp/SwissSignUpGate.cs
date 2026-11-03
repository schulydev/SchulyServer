using System.Net;
using Toamaisutaa.Abstractions;

namespace Schuly.API.SignUp
{
    public static class SwissSignUpExtensions
    {
        public static bool SwitzerlandOnly(this IConfiguration configuration) => configuration.GetValue<bool>("SignUp:SwitzerlandOnly");

        /// <summary>
        /// A first sign-in through an OIDC provider would create an account without passing the gate, and the library can't tell that apart from a returning user
        /// in time to check the address. So provider sign-ups stay off; accounts that already linked a provider keep using it from anywhere.
        /// </summary>
        // ponytail: Swiss users register with a password first and link the provider afterwards. Decorate IUserStore.CreateAsync if direct OIDC sign-up is ever needed.
        public static IServiceCollection AddSwissExternalSignUpLimit(this IServiceCollection services, IConfiguration configuration)
        {
            if (configuration.SwitzerlandOnly())
                services.PostConfigure<ToamaisutaaExternalLoginOptions>(options =>
                {
                    foreach (var provider in options.Providers.Values)
                        provider.AllowSignUp = false;
                });

            return services;
        }
    }

    /// <summary>
    /// Refuses new password sign-ups from outside Swiss networks when <c>SignUp:SwitzerlandOnly</c> is on. Signing in is never checked, so existing accounts
    /// keep working abroad. The address is only compared and is not stored or logged.
    /// </summary>
    // ponytail: registry data shows where a network is registered, not where the user is, and the list ages until the next release. Run scripts/update-swiss-networks.sh before a release.
    public sealed class SwissSignUpGate(RequestDelegate next)
    {
        public const string Message = "New Schuly accounts can only be created from a network in Switzerland. Connect from Switzerland and try again.";

        // ponytail: a linear scan, fine for how rarely people register.
        private static readonly Lazy<IPNetwork[]> Networks = new(LoadNetworks);

        public async Task InvokeAsync(HttpContext context)
        {
            if (HttpMethods.IsPost(context.Request.Method) && context.Request.Path.Equals("/auth/register", StringComparison.OrdinalIgnoreCase) && !IsSwiss(context.Connection.RemoteIpAddress))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { errors = new[] { Message } }, context.RequestAborted);
                return;
            }

            await next(context);
        }

        // A private address means the proxy settings are wrong, so it is refused rather than waved through.
        public static bool IsSwiss(IPAddress? address)
        {
            if (address is null) return false;
            var ip = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
            return Networks.Value.Any(network => network.Contains(ip));
        }

        private static IPNetwork[] LoadNetworks()
        {
            using var stream = typeof(SwissSignUpGate).Assembly.GetManifestResourceStream("swiss-networks.txt") ?? throw new InvalidOperationException("swiss-networks.txt is not embedded.");
            using var reader = new StreamReader(stream);
            return reader.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(IPNetwork.Parse).ToArray();
        }
    }
}
