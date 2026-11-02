using Microsoft.AspNetCore.HttpOverrides;
using System.Net;

namespace Schuly.API.Extensions
{
    public static class ForwardedHeadersExtensions
    {
        public static IServiceCollection AddSchulyForwardedHeaders(this IServiceCollection services, IConfiguration configuration)
        {
            services.Configure<ForwardedHeadersOptions>(options =>
            {
                options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

                var knownProxies = configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>();
                var knownNetworks = configuration.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>();

                if ((knownProxies is null || knownProxies.Length == 0) && (knownNetworks is null || knownNetworks.Length == 0))
                    return;

                options.KnownProxies.Clear();
                options.KnownIPNetworks.Clear();

                foreach (var proxy in knownProxies ?? [])
                    options.KnownProxies.Add(IPAddress.Parse(proxy));

                foreach (var network in knownNetworks ?? [])
                    options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));

                // Loopback stays trusted: Helply's own MCP client calls this server over http://127.0.0.1 and says with X-Forwarded-Proto which scheme the public
                // URL has, so the resource it computes matches the one its internal token was issued for. Only this process can connect from loopback.
                options.KnownProxies.Add(IPAddress.Loopback);
                options.KnownProxies.Add(IPAddress.IPv6Loopback);
            });

            return services;
        }
    }
}
