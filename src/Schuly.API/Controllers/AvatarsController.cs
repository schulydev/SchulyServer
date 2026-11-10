using Mediator;
using Microsoft.AspNetCore.Mvc;
using Schuly.Application.Queries.Avatar;

namespace Schuly.API.Controllers
{
    /// <summary>
    /// Stored pictures. Every route needs the normal sign-in (the default policy) and answers only the picture's owner;
    /// anyone else, and a missing picture, get 404. Clients fetch these with their bearer token, not a plain img src.
    /// </summary>
    [ApiController]
    [Route("api/avatars")]
    public class AvatarsController(IMediator mediator) : ControllerBase
    {
        /// <summary>The picture of one of the caller's own school profiles.</summary>
        [HttpGet("{schoolUserId:guid}")]
        public async Task<IActionResult> Get(Guid schoolUserId, CancellationToken ct) =>
            Picture(await mediator.Send(new GetAvatarQuery(schoolUserId), ct));

        /// <summary>The picture of one of the caller's linked accounts.</summary>
        [HttpGet("accounts/{linkedAccountId:guid}")]
        public async Task<IActionResult> GetAccount(Guid linkedAccountId, CancellationToken ct) =>
            Picture(await mediator.Send(new GetLinkedAccountAvatarQuery(linkedAccountId), ct));

        /// <summary>The caller's own profile picture.</summary>
        [HttpGet("users/{applicationUserId:guid}")]
        public async Task<IActionResult> GetUser(Guid applicationUserId, CancellationToken ct) =>
            Picture(await mediator.Send(new GetUserAvatarQuery(applicationUserId), ct));

        private IActionResult Picture(Application.Models.Result<AvatarDownload> result)
        {
            if (!result.IsSuccess) return NotFound();

            var stream = result.Value!.Stream;
            Response.Headers.CacheControl = "private, max-age=3600";
            return File(stream.Content, stream.ContentType ?? "image/png");
        }
    }
}
