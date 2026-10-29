using System.Text.Json;
using Mediator;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpLogging;
using Microsoft.AspNetCore.Mvc;
using Schuly.API.Helply;
using Schuly.Application.Commands.Helply;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Application.Queries.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Services;

namespace Schuly.API.Controllers
{
    public record HelplyStatusDto(bool Enabled);

    public record CreateHelplyConversationRequest(string? Title);

    public record RenameHelplyConversationRequest(string? Title);

    public record SendHelplyMessageRequest(string? Text);

    public record HelplyDecisionRequest(string? ApprovalId, bool Approved);

    public record AnswerHelplyApprovalsRequest(List<HelplyDecisionRequest>? Decisions);

    /// <summary>
    /// Helply, the in-app assistant. Everything is scoped to the signed-in user; another user's conversation answers 404. The chat endpoints stream server-sent events and answer
    /// every refusal as a plain HTTP problem before the stream starts. No response from here ever carries the model, the gateway address or the key.
    /// </summary>
    [ApiController]
    [Route("api/helply")]
    [Authorize]
    [HttpLogging(HttpLoggingFields.None)]
    public class HelplyController(IMediator mediator, HelplyAvailability availability, HelplyChatService chat, IUserService userService) : ControllerBase
    {
        private static readonly JsonSerializerOptions EventJson = new(JsonSerializerDefaults.Web);

        [HttpGet("status")]
        [ProducesResponseType(typeof(HelplyStatusDto), StatusCodes.Status200OK)]
        public IActionResult GetStatus() => Ok(new HelplyStatusDto(availability.IsEnabled));

        [HttpGet("settings")]
        [ProducesResponseType(typeof(HelplySettingsDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetSettings(CancellationToken cancellationToken) => Respond(await mediator.Send(new GetHelplySettingsQuery(), cancellationToken));

        [HttpPut("settings/permissions")]
        [ProducesResponseType(typeof(HelplySettingsDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> UpdatePermissions([FromBody] McpPermissionSet permissions, CancellationToken cancellationToken) => Respond(await mediator.Send(new UpdateHelplySettingsCommand(permissions), cancellationToken));

        [HttpGet("conversations")]
        [ProducesResponseType(typeof(List<HelplyConversationSummaryDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> ListConversations(CancellationToken cancellationToken) => Respond(await mediator.Send(new ListHelplyConversationsQuery(), cancellationToken));

        [HttpPost("conversations")]
        [ProducesResponseType(typeof(HelplyConversationSummaryDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> CreateConversation([FromBody] CreateHelplyConversationRequest? request, CancellationToken cancellationToken) => Respond(await mediator.Send(new CreateHelplyConversationCommand(request?.Title), cancellationToken));

        [HttpPatch("conversations/{id:guid}")]
        [ProducesResponseType(typeof(HelplyConversationSummaryDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> RenameConversation(Guid id, [FromBody] RenameHelplyConversationRequest request, CancellationToken cancellationToken) => Respond(await mediator.Send(new RenameHelplyConversationCommand(id, request.Title ?? string.Empty), cancellationToken));

        [HttpDelete("conversations/{id:guid}")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> DeleteConversation(Guid id, CancellationToken cancellationToken) => Respond(await mediator.Send(new DeleteHelplyConversationCommand(id), cancellationToken));

        [HttpDelete("conversations")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        public async Task<IActionResult> DeleteAllConversations(CancellationToken cancellationToken) => Respond(await mediator.Send(new DeleteAllHelplyConversationsCommand(), cancellationToken));

        [HttpGet("conversations/{id:guid}")]
        [ProducesResponseType(typeof(HelplyConversationDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> GetConversation(Guid id, CancellationToken cancellationToken) => Respond(await mediator.Send(new GetHelplyConversationQuery(id), cancellationToken));

        [HttpPost("conversations/{id:guid}/messages")]
        [Produces("text/event-stream")]
        public Task<IActionResult> SendMessage(Guid id, [FromBody] SendHelplyMessageRequest request, CancellationToken cancellationToken) => StreamAsync(id, HelplyTurnKind.Message, request.Text, null, cancellationToken);

        [HttpPost("conversations/{id:guid}/approvals")]
        [Produces("text/event-stream")]
        public Task<IActionResult> AnswerApprovals(Guid id, [FromBody] AnswerHelplyApprovalsRequest request, CancellationToken cancellationToken) =>
            StreamAsync(id, HelplyTurnKind.Approvals, null, request.Decisions?.Select(d => new HelplyDecision(d.ApprovalId ?? string.Empty, d.Approved)).ToList(), cancellationToken);

        [HttpPost("conversations/{id:guid}/retry")]
        [Produces("text/event-stream")]
        public Task<IActionResult> Retry(Guid id, CancellationToken cancellationToken) => StreamAsync(id, HelplyTurnKind.Retry, null, null, cancellationToken);

        private async Task<IActionResult> StreamAsync(Guid conversationId, HelplyTurnKind kind, string? text, IReadOnlyList<HelplyDecision>? decisions, CancellationToken cancellationToken)
        {
            if (!availability.IsEnabled)
                return Refuse(new HelplyRefusal(StatusCodes.Status503ServiceUnavailable, "Helply is not available right now."));

            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var (turn, refusal) = await chat.BeginAsync(userId, conversationId, kind, text, decisions, cancellationToken);
            if (turn is null)
                return Refuse(refusal!);

            using (turn)
            {
                Response.StatusCode = StatusCodes.Status200OK;
                Response.ContentType = "text/event-stream";
                Response.Headers.CacheControl = "no-store";
                Response.Headers["X-Accel-Buffering"] = "no";
                await Response.Body.FlushAsync(cancellationToken);
                await chat.RunAsync(turn, WriteEventAsync, cancellationToken);
            }
            return new EmptyResult();
        }

        private async Task WriteEventAsync(HelplyEvent e)
        {
            await Response.WriteAsync($"event: {e.Name}\ndata: {JsonSerializer.Serialize(e.Data, EventJson)}\n\n", HttpContext.RequestAborted);
            await Response.Body.FlushAsync(HttpContext.RequestAborted);
        }

        private IActionResult Refuse(HelplyRefusal refusal)
        {
            if (refusal.RetryAfter is { } wait)
                Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds)).ToString();
            return ProblemOf(refusal.Status, refusal.Detail);
        }

        private IActionResult ProblemOf(int status, string detail) => new ObjectResult(new ProblemDetails { Status = status, Title = Title(status), Detail = detail }) { StatusCode = status, ContentTypes = { "application/problem+json" } };

        private static string Title(int status) => status switch
        {
            StatusCodes.Status400BadRequest => "Invalid request",
            StatusCodes.Status404NotFound => "Not found",
            StatusCodes.Status409Conflict => "Already running",
            StatusCodes.Status429TooManyRequests => "Too many requests",
            StatusCodes.Status503ServiceUnavailable => "Helply is unavailable",
            _ => "Request failed",
        };

        private IActionResult Respond<T>(Result<T> result) => result.IsSuccess ? Ok(result.Value) : ProblemOf(Status(result.Status), result.Error ?? "The request failed.");

        private IActionResult Respond(Result result) => result.IsSuccess ? NoContent() : ProblemOf(Status(result.Status), result.Error ?? "The request failed.");

        private static int Status(ResultStatus status) => status switch
        {
            ResultStatus.NotFound => StatusCodes.Status404NotFound,
            ResultStatus.Forbidden => StatusCodes.Status403Forbidden,
            ResultStatus.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status400BadRequest,
        };
    }
}
