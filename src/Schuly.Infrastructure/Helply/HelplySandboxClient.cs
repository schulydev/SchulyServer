using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace Schuly.Infrastructure.Helply
{
    /// <summary>
    /// The sandbox sidecar (<c>Helply:Sandbox</c>). <c>BaseUrl</c> and <c>ApiKey</c> come from the environment; without both, Helply has no workspace and works as before.
    /// The key is a secret of the deployment and is never logged or returned.
    /// </summary>
    public class HelplySandboxOptions
    {
        public const string SectionName = "Helply:Sandbox";

        public string? BaseUrl { get; set; }
        public string? ApiKey { get; set; }

        /// <summary>How long one user's commands may run in total per UTC day.</summary>
        public int SecondsPerUserPerDay { get; set; } = 900;

        /// <summary>Upper bound for a single command; the sidecar enforces its own maximum as well.</summary>
        public int MaxCommandSeconds { get; set; } = 60;

        public bool IsConfigured => Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) && (ApiKey?.Length ?? 0) >= 32;
    }

    public sealed record HelplySandboxExecResult(int ExitCode, string Stdout, string Stderr, bool Truncated, bool TimedOut);

    /// <summary>Talks to the sandbox sidecar: one microVM per conversation, addressed by the conversation id. Failures come back as text the model can read, never as the sidecar's address.</summary>
    public interface IHelplySandboxClient
    {
        bool IsConfigured { get; }

        Task<HelplySandboxExecResult> ExecAsync(Guid conversationId, string command, int timeoutSeconds, CancellationToken ct);

        /// <summary>Null on success, otherwise an error the model can read.</summary>
        Task<string?> WriteFileAsync(Guid conversationId, string path, byte[] content, CancellationToken ct);

        Task<(byte[]? Content, string? Error)> ReadFileAsync(Guid conversationId, string path, CancellationToken ct);

        Task DeleteAsync(Guid conversationId, CancellationToken ct);
    }

    public sealed class HelplySandboxClient(IHttpClientFactory clients, IOptions<HelplySandboxOptions> options) : IHelplySandboxClient
    {
        public const string ClientName = "Helply.Sandbox";

        private HelplySandboxOptions Settings => options.Value;

        public bool IsConfigured => Settings.IsConfigured;

        public async Task<HelplySandboxExecResult> ExecAsync(Guid conversationId, string command, int timeoutSeconds, CancellationToken ct)
        {
            using var response = await SendAsync(HttpMethod.Post, conversationId, "exec", JsonContent.Create(new { command, timeoutSeconds }), ct);
            if (response.IsSuccessStatusCode)
                return await response.Content.ReadFromJsonAsync<HelplySandboxExecResult>(ct) ?? new HelplySandboxExecResult(-1, string.Empty, "Error: the workspace gave no answer.", false, false);
            return new HelplySandboxExecResult(-1, string.Empty, await ErrorAsync(response, ct), false, false);
        }

        public async Task<string?> WriteFileAsync(Guid conversationId, string path, byte[] content, CancellationToken ct)
        {
            using var response = await SendAsync(HttpMethod.Put, conversationId, $"files?path={Uri.EscapeDataString(path)}", new ByteArrayContent(content), ct);
            return response.IsSuccessStatusCode ? null : await ErrorAsync(response, ct);
        }

        public async Task<(byte[]? Content, string? Error)> ReadFileAsync(Guid conversationId, string path, CancellationToken ct)
        {
            using var response = await SendAsync(HttpMethod.Get, conversationId, $"files?path={Uri.EscapeDataString(path)}", null, ct);
            if (response.IsSuccessStatusCode)
                return (await response.Content.ReadAsByteArrayAsync(ct), null);
            return (null, response.StatusCode == HttpStatusCode.NotFound ? $"Error: there is no regular file at '{path}' in the workspace." : await ErrorAsync(response, ct));
        }

        public async Task DeleteAsync(Guid conversationId, CancellationToken ct)
        {
            using var response = await SendAsync(HttpMethod.Delete, conversationId, string.Empty, null, ct);
        }

        private Task<HttpResponseMessage> SendAsync(HttpMethod method, Guid conversationId, string path, HttpContent? content, CancellationToken ct)
        {
            if (!IsConfigured)
                throw new HttpRequestException("not configured");
            var request = new HttpRequestMessage(method, $"{Settings.BaseUrl!.TrimEnd('/')}/sandboxes/{conversationId:D}/{path}") { Content = content };
            request.Headers.Add("X-Api-Key", Settings.ApiKey);
            return clients.CreateClient(ClientName).SendAsync(request, ct);
        }

        private static async Task<string> ErrorAsync(HttpResponseMessage response, CancellationToken ct) => response.StatusCode switch
        {
            HttpStatusCode.TooManyRequests => "Error: every workspace is busy right now; try again in a few minutes.",
            HttpStatusCode.RequestEntityTooLarge => "Error: the file is too large for the workspace.",
            HttpStatusCode.BadRequest => "Error: " + Trim((await response.Content.ReadAsStringAsync(ct)).Trim('"'), 300),
            _ => $"Error: the workspace failed ({(int)response.StatusCode}).",
        };

        private static string Trim(string text, int max) => text.Length <= max ? text : text[..max];
    }

    /// <summary>
    /// How much workspace time each user has left today. In memory, which is enough for Schuly's single instance; a restart forgives the day's usage, which errs on the user's side
    /// and costs nothing (there are no credits).
    /// </summary>
    public sealed class HelplySandboxQuota(IOptions<HelplySandboxOptions> options, TimeProvider time)
    {
        private readonly ConcurrentDictionary<Guid, (DateOnly Day, double Seconds)> _used = new();

        private DateOnly Today => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);

        public double RemainingSeconds(Guid applicationUserId)
        {
            var used = _used.TryGetValue(applicationUserId, out var entry) && entry.Day == Today ? entry.Seconds : 0;
            return Math.Max(0, options.Value.SecondsPerUserPerDay - used);
        }

        public void Add(Guid applicationUserId, TimeSpan elapsed)
        {
            var today = Today;
            _used.AddOrUpdate(applicationUserId, (today, elapsed.TotalSeconds), (_, entry) => entry.Day == today ? (today, entry.Seconds + elapsed.TotalSeconds) : (today, elapsed.TotalSeconds));
        }
    }
}
