using System.Security.Cryptography;
using System.Text;

namespace Schuly.Sandbox
{
    public record ExecRequest(string? Command, int? TimeoutSeconds);

    /// <summary>
    /// The sidecar's HTTP API: per-conversation microVMs behind four routes. Only the Schuly backend may call it; the sidecar sits on a private network with the backend alone and
    /// requires the shared key on every request.
    /// </summary>
    public static class SandboxApi
    {
        public const string KeyHeader = "X-Api-Key";
        public const int MinKeyLength = 32;

        /// <summary>The configured key, or an error when it is missing or shorter than <see cref="MinKeyLength"/> characters.</summary>
        public static string RequireKey(IConfiguration configuration)
        {
            var key = configuration["Sandbox:ApiKey"];
            if (string.IsNullOrWhiteSpace(key) || key.Length < MinKeyLength)
                throw new InvalidOperationException($"Sandbox:ApiKey must be set to at least {MinKeyLength} characters.");
            return key;
        }

        /// <summary>
        /// Compares in constant time. Both sides are hashed first, so the comparison never depends on the length of the key either (Tessaly compared the raw bytes, which
        /// returns early when the lengths differ).
        /// </summary>
        public static bool KeyMatches(string? given, string expected) =>
            CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(given ?? string.Empty)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));

        public static void Map(WebApplication app, string apiKey)
        {
            app.Use(async (context, next) =>
            {
                if (!KeyMatches(context.Request.Headers[KeyHeader].ToString(), apiKey))
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return;
                }
                await next();
            });

            // Every call names a sandbox; it is created (or woken after an idle stop) on first use.
            var sandboxes = app.MapGroup("/sandboxes/{id}").AddEndpointFilter(async (context, next) =>
            {
                var id = context.HttpContext.GetRouteValue("id") as string;
                return Msb.IsValidId(id) ? await next(context) : Results.BadRequest("Invalid sandbox id.");
            });

            sandboxes.MapPost("/exec", async (string id, ExecRequest request, Msb msb, CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(request.Command))
                    return Results.BadRequest("Command is required.");
                if (request.Command.Length > Msb.MaxCommandChars)
                    return Results.BadRequest("Command is too long.");
                if (!await msb.EnsureAsync(id, ct))
                    return Results.StatusCode(StatusCodes.Status429TooManyRequests);
                var timeout = Math.Clamp(request.TimeoutSeconds ?? 60, 1, Msb.MaxExecSeconds);
                return Results.Ok(await msb.ExecAsync(id, request.Command, timeout, ct));
            });

            sandboxes.MapPut("/files", async (string id, string? path, HttpRequest request, Msb msb, CancellationToken ct) =>
            {
                var target = Msb.WorkspacePath(path);
                if (target is null)
                    return Results.BadRequest("Path must be relative to the workspace.");
                if (request.ContentLength > Msb.MaxFileBytes)
                    return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                if (!await msb.EnsureAsync(id, ct))
                    return Results.StatusCode(StatusCodes.Status429TooManyRequests);
                var error = await msb.WriteFileAsync(id, target, request.Body, ct);
                return error is null ? Results.NoContent() : Results.BadRequest($"Could not place the file: {error}");
            });

            sandboxes.MapGet("/files", async (string id, string? path, Msb msb, CancellationToken ct) =>
            {
                var target = Msb.WorkspacePath(path);
                if (target is null)
                    return Results.BadRequest("Path must be relative to the workspace.");
                if (!await msb.EnsureAsync(id, ct))
                    return Results.StatusCode(StatusCodes.Status429TooManyRequests);
                var bytes = await msb.ReadFileAsync(id, target, ct);
                return bytes is null ? Results.NotFound() : Results.File(bytes, "application/octet-stream");
            });

            sandboxes.MapDelete("/", async (string id, Msb msb, CancellationToken ct) =>
            {
                await msb.DeleteAsync(id, ct);
                return Results.NoContent();
            });
        }
    }

    /// <summary>Every five minutes, removes the sandboxes that stopped after their idle timeout or maximum duration, with their disks.</summary>
    public sealed class StoppedSandboxSweeper(Msb msb, ILogger<StoppedSandboxSweeper> logger) : BackgroundService
    {
        public static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using var timer = new PeriodicTimer(Interval);
            try
            {
                do
                {
                    try
                    {
                        await msb.RemoveStoppedAsync(stoppingToken);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        logger.LogWarning("Removing stopped sandboxes failed ({Error})", ex.GetType().Name);
                    }
                }
                while (await timer.WaitForNextTickAsync(stoppingToken));
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
            }
        }
    }

    public static class SandboxProgram
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            var apiKey = SandboxApi.RequireKey(builder.Configuration);
            builder.Services.AddSingleton<Msb>();
            builder.Services.AddHostedService<StoppedSandboxSweeper>();
            builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = Msb.MaxFileBytes);

            var app = builder.Build();
            SandboxApi.Map(app, apiKey);
            app.Run();
        }
    }
}
