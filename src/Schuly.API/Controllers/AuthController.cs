using Mediator;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Schuly.Application.Commands.User;
using Schuly.Application.Dtos;
using Schuly.Application.Queries.User;
using Schuly.API.Extensions;
using Schuly.API.Plugins;
using Schuly.API.Security;
using System.Text.Json;

namespace Schuly.API.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class AuthController(IMediator mediator, PluginHost pluginHost) : ControllerBase
    {
        private static readonly JsonSerializerOptions ExportSerializerOptions = new() { WriteIndented = true };

        [HttpGet("me")]
        [ProducesResponseType(typeof(ApplicationUserDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> GetCurrentUser(CancellationToken cancellationToken)
        {
            var result = await mediator.Send(new GetCurrentUserQuery(), cancellationToken);
            return result.ToActionResult();
        }

        [HttpDelete("me")]
        [EnableRateLimiting(AccountRateLimits.Delete)]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> DeleteCurrentUser([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] DeleteAccountRequest? request, [FromServices] AccountPasswordCheck passwordCheck, CancellationToken cancellationToken)
        {
            if (await passwordCheck.RefusalAsync(User, request?.Password, cancellationToken) is { } refusal)
                return BadRequest(new { message = refusal });

            var result = await mediator.Send(new DeleteCurrentUserCommand(), cancellationToken);
            return result.ToActionResult();
        }

        [HttpGet("me/export")]
        [ProducesResponseType(typeof(AccountExportDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> ExportCurrentUser(CancellationToken cancellationToken)
        {
            var result = await mediator.Send(new ExportCurrentUserQuery(), cancellationToken);
            if (result.IsFailure)
                return result.ToActionResult();

            var bytes = JsonSerializer.SerializeToUtf8Bytes(result.Value, ExportSerializerOptions);
            return File(bytes, "application/json", "schuly-export.json");
        }

        [HttpGet("sync")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> Sync(CancellationToken cancellationToken)
        {
            var result = await mediator.Send(new SyncUserCommand(), cancellationToken);
            return result.ToActionResult();
        }

        [HttpPost("login")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> Login([FromBody] UnifiedLoginRequest request, CancellationToken cancellationToken)
        {
            var result = await pluginHost.ConnectAsync(
                request.SystemKey, request.Fields ?? new Dictionary<string, string>(), request.DisplayName, cancellationToken);
            if (result is null)
                return BadRequest(new { message = $"No plugin handles system '{request.SystemKey}'." });

            return result.Success
                ? Ok(new { accountId = result.AccountId, message = result.Message })
                : BadRequest(new { message = result.Message });
        }
    }

    public record DeleteAccountRequest(string? Password);

    public record UnifiedLoginRequest(string SystemKey, Dictionary<string, string>? Fields, string? DisplayName);
}
