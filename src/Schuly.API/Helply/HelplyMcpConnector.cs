using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Client;
using Schuly.API.Mcp;
using Schuly.Domain.Mcp;

namespace Schuly.API.Helply
{
    /// <summary>What Helply knows about one tool it was offered, read from the tool's own MCP annotations.</summary>
    public sealed record HelplyToolInfo(string Name, string Title, bool ReadOnly, bool Destructive)
    {
        public bool NeedsApproval => !ReadOnly;
    }

    /// <summary>The tools of one run and the MCP session behind them. Dispose it when the run ends.</summary>
    public sealed class HelplyToolSet(McpClient? client, IList<AITool> tools, IReadOnlyDictionary<string, HelplyToolInfo> info) : IAsyncDisposable
    {
        public IList<AITool> Tools { get; } = tools;
        public IReadOnlyDictionary<string, HelplyToolInfo> Info { get; } = info;

        public ValueTask DisposeAsync() => client?.DisposeAsync() ?? ValueTask.CompletedTask;
    }

    /// <summary>
    /// Connects Helply to Schuly's own <c>/mcp</c> as the signed-in user, over the official MCP client with a 5-minute internal token that carries the user's Helply permissions.
    /// Helply is offered exactly what <c>tools/list</c> returns for that token and nothing else; every tool that is not read-only is wrapped so it needs the user's approval.
    /// </summary>
    public sealed class HelplyMcpConnector(McpInternalTokens tokens, IHttpClientFactory clients, IServer server)
    {
        public const string ClientName = "Helply.Mcp";

        public async Task<HelplyToolSet> ConnectAsync(Guid applicationUserId, McpPermissionSet permissions, CancellationToken ct)
        {
            var (accessToken, publicEndpoint) = await tokens.IssueAsync(applicationUserId, permissions, ct);
            var (endpoint, host) = ResolveEndpoint(publicEndpoint, server.Features.Get<IServerAddressesFeature>()?.Addresses ?? []);

            var headers = new Dictionary<string, string> { ["Authorization"] = "Bearer " + accessToken };
            if (host is not null)
                headers["Host"] = host;

            var transport = new HttpClientTransport(new HttpClientTransportOptions { Endpoint = endpoint, TransportMode = HttpTransportMode.StreamableHttp, AdditionalHeaders = headers }, clients.CreateClient(ClientName), ownsHttpClient: false);
            var client = await McpClient.CreateAsync(transport, cancellationToken: ct);
            try
            {
                var listed = await client.ListToolsAsync(cancellationToken: ct);
                var info = new Dictionary<string, HelplyToolInfo>(StringComparer.Ordinal);
                var tools = new List<AITool>();
                foreach (var tool in listed)
                {
                    var annotations = tool.ProtocolTool.Annotations;
                    var readOnly = annotations?.ReadOnlyHint == true;
                    info[tool.Name] = new HelplyToolInfo(tool.Name, tool.ProtocolTool.Title ?? tool.Name, readOnly, annotations?.DestructiveHint == true);
                    tools.Add(readOnly ? tool : new ApprovalRequiredAIFunction(tool));
                }
                return new HelplyToolSet(client, tools, info);
            }
            catch
            {
                await client.DisposeAsync();
                throw;
            }
        }

        /// <summary>
        /// Prefers the loopback address of this very server, so the call never leaves the machine: the first http address Kestrel listens on, with a wildcard host turned into
        /// 127.0.0.1, and the public authority as the Host header so audience checks still match. Without a known address (tests, TestServer) the public endpoint is used as is.
        /// </summary>
        public static (Uri Endpoint, string? Host) ResolveEndpoint(Uri publicEndpoint, IEnumerable<string> listenAddresses)
        {
            foreach (var address in listenAddresses)
            {
                if (!address.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                    continue;
                var authority = address["http://".Length..].TrimEnd('/');
                var split = authority.LastIndexOf(':');
                if (split <= 0 || !int.TryParse(authority[(split + 1)..], out var port))
                    continue;
                var host = authority[..split];
                if (host is "+" or "*" or "0.0.0.0" or "[::]" or "[::0]" or "::")
                    host = "127.0.0.1";
                return (new Uri($"http://{host}:{port}{publicEndpoint.PathAndQuery}"), publicEndpoint.Authority);
            }
            return (publicEndpoint, null);
        }
    }
}
