using Schuly.Infrastructure.Services;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Schuly.Infrastructure.Mcp;

namespace Schuly.API.Mcp
{
    /// <summary>
    /// Accepts the opaque credentials this server issues for <c>/mcp</c>: OAuth access tokens and user API keys. It is used only by the MCP endpoint's policy, so these
    /// credentials do nothing on <c>/api</c> (whose JWT bearer scheme cannot read them), and the sign-in JWTs of <c>/api</c> do nothing here.
    /// </summary>
    /// <remarks>The principal carries the user's <c>sub</c> and the scopes the connection's current permissions amount to, and deliberately no role: an AI app acts as the user on their own data, never with administrator rights.</remarks>
    public sealed class McpTokenAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, McpOAuthService oauth, McpApiKeyService apiKeys, McpPublicUrls urls) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string SchemeName = "SchulyMcpToken";
        public const string CallerItemKey = "Schuly.McpCaller";
        public const string AuthKindClaim = "schuly_mcp_auth";

        protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Context.Items.TryGetValue(CallerItemKey, out var cached) && cached is AuthenticateResult earlier)
                return earlier;

            var result = await AuthenticateCoreAsync();
            Context.Items[CallerItemKey] = result;
            return result;
        }

        private async Task<AuthenticateResult> AuthenticateCoreAsync()
        {
            string? header = Request.Headers.Authorization;
            if (string.IsNullOrEmpty(header) || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                return AuthenticateResult.NoResult();

            var token = header["Bearer ".Length..].Trim();
            McpCaller? caller = null;
            if (token.StartsWith(McpSecrets.AccessTokenPrefix, StringComparison.Ordinal))
                caller = await oauth.ValidateAccessTokenAsync(token, urls.Resource, Context.RequestAborted);
            else if (token.StartsWith(McpSecrets.ApiKeyPrefix, StringComparison.Ordinal))
                caller = await apiKeys.ValidateAsync(token, Context.RequestAborted);

            if (caller is null)
                return AuthenticateResult.Fail("The MCP access token or API key is invalid, expired or revoked.");

            Context.Items[typeof(McpCaller)] = caller;
            // Use through an AI app counts as use: the inactivity sweep must not delete an account that is in use.
            if (Context.RequestServices.GetService<IUserService>() is { } users)
                await users.TouchLastSeenAsync(caller.ExternalId, null, Context.RequestAborted);
            var claims = new List<Claim> { new("sub", caller.ExternalId), new(AuthKindClaim, caller.Kind) };
            // Read from the grant or key on every request, so a permission edit is live on the next call.
            claims.AddRange(McpScopes.Granted(caller.Permissions).Select(scope => new Claim(McpScopes.ClaimType, scope)));

            var identity = new ClaimsIdentity(claims, SchemeName, "sub", ClaimTypes.Role);
            return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
        }
    }
}
