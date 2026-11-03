using System.Text.Json.Serialization;
using Schuly.Domain.Mcp;

namespace Schuly.Infrastructure.Mcp
{
    public class McpOAuthOptions
    {
        public const string SectionName = "Mcp";

        /// <summary>Public origin of this server (for example https://app.schuly.dev). When empty it is taken from the request, which the forwarded-headers setup makes correct behind the proxy.</summary>
        public string? PublicUrl { get; set; }

        /// <summary>How long an API key lasts when the request names no expiry.</summary>
        public TimeSpan DefaultApiKeyLifetime { get; set; } = TimeSpan.FromDays(90);

        /// <summary>Browser origins besides this server's own that may call /mcp. Empty by default: desktop and CLI clients send no Origin at all.</summary>
        public List<string> AllowedOrigins { get; set; } = [];

        public TimeSpan AccessTokenLifetime { get; set; } = TimeSpan.FromMinutes(15);
        public TimeSpan RefreshTokenLifetime { get; set; } = TimeSpan.FromDays(30);
        public TimeSpan CodeLifetime { get; set; } = TimeSpan.FromSeconds(60);
        public int MaxApiKeysPerUser { get; set; } = 20;
        /// <summary>Registration is anonymous by design (RFC 7591), so a global ceiling keeps it from filling the table.</summary>
        public int MaxClientRegistrationsPerHour { get; set; } = 300;

        public int MaxClientRegistrationsPerIpPerDay { get; set; } = 20;

        /// <summary>A registered client nobody ever approved is deleted after this.</summary>
        public TimeSpan UnusedClientLifetime { get; set; } = TimeSpan.FromHours(24);
    }

    /// <summary>RFC 7591 client metadata. Only what a public client needs; everything else is ignored.</summary>
    public record ClientRegistrationRequest([property: JsonPropertyName("redirect_uris")] List<string>? RedirectUris, [property: JsonPropertyName("client_name")] string? ClientName, [property: JsonPropertyName("client_uri")] string? ClientUri, [property: JsonPropertyName("token_endpoint_auth_method")] string? TokenEndpointAuthMethod, [property: JsonPropertyName("grant_types")] List<string>? GrantTypes, [property: JsonPropertyName("response_types")] List<string>? ResponseTypes, [property: JsonPropertyName("software_id")] string? SoftwareId, [property: JsonPropertyName("software_version")] string? SoftwareVersion, [property: JsonPropertyName("scope")] string? Scope);

    public record ClientRegistrationResponse([property: JsonPropertyName("client_id")] string ClientId, [property: JsonPropertyName("client_id_issued_at")] long ClientIdIssuedAt, [property: JsonPropertyName("client_name")] string ClientName, [property: JsonPropertyName("redirect_uris")] IReadOnlyList<string> RedirectUris, [property: JsonPropertyName("token_endpoint_auth_method")] string TokenEndpointAuthMethod, [property: JsonPropertyName("grant_types")] IReadOnlyList<string> GrantTypes, [property: JsonPropertyName("response_types")] IReadOnlyList<string> ResponseTypes, [property: JsonPropertyName("scope")] string Scope);

    /// <summary>The query of an authorization request, exactly as the client sent it.</summary>
    public record AuthorizationRequest(string? ResponseType, string? ClientId, string? RedirectUri, string? Scope, string? State, string? CodeChallenge, string? CodeChallengeMethod, string? Resource);

    public enum AuthorizationRequestStatus
    {
        Valid,

        /// <summary>The client or redirect URI cannot be trusted, so the user must not be sent anywhere: show the error instead.</summary>
        Fatal,

        /// <summary>The client is known and the redirect URI matches, so the error goes back to it.</summary>
        Redirect,
    }

    public record AuthorizationRequestCheck(AuthorizationRequestStatus Status, string? Error, string? ErrorDescription, string? ClientName, string? ClientUri, string? RedirectUri, McpPermissionSet Requested, string? Resource)
    {
        public static AuthorizationRequestCheck Fatal(string error, string description) => new(AuthorizationRequestStatus.Fatal, error, description, null, null, null, McpPermissionSet.None(), null);
    }

    public record TokenResponse([property: JsonPropertyName("access_token")] string AccessToken, [property: JsonPropertyName("token_type")] string TokenType, [property: JsonPropertyName("expires_in")] long ExpiresIn, [property: JsonPropertyName("refresh_token")] string? RefreshToken, [property: JsonPropertyName("scope")] string Scope);

    public record OAuthError(string Error, string Description);

    /// <summary>Who a valid MCP credential belongs to and what it may do.</summary>
    public record McpCaller(Guid ApplicationUserId, string ExternalId, McpPermissionSet Permissions, string Kind, Guid? GrantId, Guid? ApiKeyId);

    public record McpGrantSummary(Guid Id, string ClientName, string? ClientUri, IReadOnlyList<string> RedirectHosts, McpPermissionSet Permissions, DateTime CreatedAt, DateTime? LastUsedAt);

    public record McpApiKeySummary(Guid Id, string Name, string Prefix, McpPermissionSet Permissions, DateTime CreatedAt, DateTime? ExpiresAt, DateTime? LastUsedAt);

    public record CreatedMcpApiKey(McpApiKeySummary Key, string Secret);

    public record McpActivityEntry(string ToolName, bool Allowed, DateTime At);
}
