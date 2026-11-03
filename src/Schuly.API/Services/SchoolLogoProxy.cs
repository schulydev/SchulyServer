using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Caching.Memory;

namespace Schuly.API.Services
{
    public sealed record SchoolLogo(byte[] Bytes, string ContentType);

    /// <summary>
    /// Fetches a school's logo on the server, so the logo host (DuckDuckGo's favicon service, for plugin schools) sees this server and never a user. The result is cached,
    /// a failed fetch included, so the host sees at most one request per school a day. SVG is refused, because it can carry script.
    /// </summary>
    public sealed class SchoolLogoProxy(IHttpClientFactory clients, IMemoryCache cache)
    {
        public const string ClientName = "Schuly.SchoolLogo";
        public const int MaxBytes = 256 * 1024;

        private static readonly TimeSpan Hit = TimeSpan.FromDays(1);
        private static readonly TimeSpan Miss = TimeSpan.FromHours(1);

        public async Task<SchoolLogo?> GetAsync(string source, CancellationToken cancellationToken)
        {
            if (cache.TryGetValue(source, out SchoolLogo? cached))
                return cached;

            var logo = await FetchAsync(source, cancellationToken);
            cache.Set(source, logo, logo is null ? Miss : Hit);
            return logo;
        }

        private async Task<SchoolLogo?> FetchAsync(string source, CancellationToken cancellationToken)
        {
            if (!Uri.TryCreate(source, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
                return null;

            try
            {
                using var client = clients.CreateClient(ClientName);
                using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                var contentType = response.Content.Headers.ContentType?.MediaType;
                if (!response.IsSuccessStatusCode || contentType is null || !contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) || contentType.Contains("svg", StringComparison.OrdinalIgnoreCase))
                    return null;

                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var buffer = new MemoryStream();
                var chunk = new byte[16 * 1024];
                int read;
                while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
                {
                    if (buffer.Length + read > MaxBytes)
                        return null;
                    buffer.Write(chunk, 0, read);
                }

                return new SchoolLogo(buffer.ToArray(), contentType);
            }
            catch (Exception ex) when (ex is HttpRequestException or SocketException || (ex is OperationCanceledException && !cancellationToken.IsCancellationRequested))
            {
                return null;
            }
        }

        /// <summary>Refuses to connect to anything that resolves to an internal address, at connect time, so a stored URL can't reach the server's own network. Redirects are off for the same reason.</summary>
        public static SocketsHttpHandler Handler() => new()
        {
            AllowAutoRedirect = false,
            ConnectCallback = async (context, cancellationToken) =>
            {
                var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
                if (addresses.Length == 0 || addresses.Any(NetworkAddresses.IsPrivate))
                    throw new HttpRequestException("The logo host is not allowed.");

                var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                try
                {
                    await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, cancellationToken);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch
                {
                    socket.Dispose();
                    throw;
                }
            },
        };
    }
}
