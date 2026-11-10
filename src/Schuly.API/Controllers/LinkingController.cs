using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Schuly.API.Linking;
using Schuly.Infrastructure.Services;
using Schuly.Plugin.Abstractions.Linking;

namespace Schuly.API.Controllers
{
    /// <summary>Generic account linking: the plugins declare providers and flows, this controller only relays them.</summary>
    [ApiController]
    [Route("api/linking")]
    [Authorize]
    public class LinkingController(LinkingService linking, IUserService userService) : ControllerBase
    {
        [HttpGet("providers")]
        [ProducesResponseType(typeof(List<LinkProviderDto>), StatusCodes.Status200OK)]
        public IActionResult GetProviders([FromQuery] string? platform) =>
            Ok(linking.GetProviders(ResolvePlatform(platform)));

        [HttpGet("providers/{providerId}/icon.svg")]
        [AllowAnonymous]
        [Produces("image/svg+xml")]
        [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "image/svg+xml")]
        [ProducesResponseType(StatusCodes.Status304NotModified)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public IActionResult GetIcon(string providerId)
        {
            if (linking.GetIcon(providerId) is not { } icon)
                return NotFound();

            var etag = $"\"{icon.Version}\"";
            Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'";
            Response.Headers.XContentTypeOptions = "nosniff";
            Response.Headers.CacheControl = "public, max-age=3600";
            Response.Headers.ETag = etag;
            if (Request.Headers.IfNoneMatch == etag)
                return StatusCode(StatusCodes.Status304NotModified);

            return Content(icon.Svg, "image/svg+xml");
        }

        [HttpPost("providers/{providerId}/start")]
        [EnableRateLimiting(LinkRateLimits.Start)]
        [ProducesResponseType(typeof(LinkSessionDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> Start(string providerId, [FromBody] StartLinkRequest request, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var callbackBase = $"{Request.Scheme}://{Request.Host}/api/linking/callback";
            return ToAction(await linking.StartAsync(userId, providerId, request.FlowId, ResolvePlatform(request.Platform), request.ReauthAccountId, callbackBase, cancellationToken));
        }

        [HttpPost("sessions/{sessionId}/submit")]
        [EnableRateLimiting(LinkRateLimits.Submit)]
        [ProducesResponseType(typeof(LinkSessionDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> Submit(string sessionId, [FromBody] SubmitLinkRequest request, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return ToAction(await linking.SubmitAsync(userId, sessionId, request, cancellationToken));
        }

        [HttpGet("sessions/{sessionId}")]
        [EnableRateLimiting(LinkRateLimits.Poll)]
        [ProducesResponseType(typeof(LinkSessionDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> GetSession(string sessionId, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return ToAction(await linking.GetAsync(userId, sessionId, cancellationToken));
        }

        [HttpDelete("sessions/{sessionId}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        public async Task<IActionResult> CancelSession(string sessionId, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            linking.Cancel(userId, sessionId);
            return NoContent();
        }

        [HttpGet("callback")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status302Found)]
        public async Task<IActionResult> Callback([FromQuery] string? session, CancellationToken cancellationToken)
        {
            var values = Request.Query
                .Where(kv => !string.Equals(kv.Key, "session", StringComparison.OrdinalIgnoreCase))
                .ToDictionary(kv => kv.Key, kv => kv.Value.ToString(), StringComparer.Ordinal);
            var id = await linking.CompleteCallbackAsync(session ?? string.Empty, values, cancellationToken);
            return Redirect(id is null ? "/settings" : $"/settings?linkSession={Uri.EscapeDataString(id)}");
        }

        [HttpGet("accounts")]
        [ProducesResponseType(typeof(List<LinkProviderAccountDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetAccounts(CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return Ok(await linking.ListAccountsAsync(userId, cancellationToken, withPictures: true));
        }

        [HttpDelete("accounts/{providerId}/{accountId}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(typeof(LinkErrorDto), StatusCodes.Status404NotFound)]
        public async Task<IActionResult> Unlink(string providerId, string accountId, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var result = await linking.UnlinkAsync(userId, providerId, accountId, cancellationToken);
            return result.IsOk ? NoContent() : ToAction(result);
        }

        // Body platform wins; otherwise the web app (X-Schuly-Client: web) is web and everything else is mobile.
        private LinkPlatform ResolvePlatform(string? platform) => platform?.ToLowerInvariant() switch
        {
            "web" => LinkPlatform.Web,
            "mobile" => LinkPlatform.Mobile,
            _ => string.Equals(Request.Headers["X-Schuly-Client"].ToString(), "web", StringComparison.OrdinalIgnoreCase) ? LinkPlatform.Web : LinkPlatform.Mobile,
        };

        private IActionResult ToAction<T>(LinkResult<T> result) => result.Outcome switch
        {
            LinkOutcome.Ok => Ok(result.Value),
            LinkOutcome.NotFound => NotFound(result.Error),
            LinkOutcome.BadGateway => StatusCode(StatusCodes.Status502BadGateway, result.Error),
            _ => BadRequest(result.Error),
        };
    }
}
