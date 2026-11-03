using Mediator;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Schuly.API.Services;
using Schuly.Application.Dtos;
using Schuly.Application.Queries.School;

namespace Schuly.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class SchoolsController(IMediator mediator) : ControllerBase
    {
        [HttpGet("my-schools")]
        [ProducesResponseType(typeof(List<MySchoolDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> GetMySchools(CancellationToken cancellationToken)
        {
            var result = await mediator.Send(new GetMySchoolsQuery(), cancellationToken);
            return result.ToActionResult();
        }

        /// <summary>Anonymous because an image request can't send a token. It serves only a public logo, and only for a school id the caller already has.</summary>
        [AllowAnonymous]
        [HttpGet("{id:guid}/logo")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> GetSchoolLogo(Guid id, [FromServices] SchoolLogoProxy logos, CancellationToken cancellationToken)
        {
            var source = await mediator.Send(new GetSchoolLogoSourceQuery(id), cancellationToken);
            if (source.IsFailure)
                return NotFound();

            var logo = await logos.GetAsync(source.Value!, cancellationToken);
            if (logo is null)
                return NotFound();

            Response.Headers.CacheControl = "public, max-age=86400";
            Response.Headers.XContentTypeOptions = "nosniff";
            return File(logo.Bytes, logo.ContentType);
        }

        [HttpGet("{id:guid}")]
        [ProducesResponseType(typeof(SchoolDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> GetSchool(Guid id, CancellationToken cancellationToken)
        {
            var result = await mediator.Send(new GetSchoolQuery(id), cancellationToken);
            return result.ToActionResult();
        }
    }
}
