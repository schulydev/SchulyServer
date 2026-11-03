using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using OpenAI;
using OpenAI.Chat;

namespace Schuly.API.Helply
{
    /// <summary>The upstream could not be reached or answered badly. Carries no message on purpose: whatever the gateway said may contain its address or the model name.</summary>
    public sealed class HelplyUnavailableException() : Exception("Helply is unavailable.");

    /// <summary>A chat client for one run, plus the redactor that knows this deployment's secrets.</summary>
    public sealed record HelplyConnection(ChatClient Chat, HelplyRedactor Redactor);

    /// <summary>
    /// The OpenAI-compatible gateway behind Helply. It builds the SDK client over the "Helply.Gateway" HTTP client (which has no logging) and, when <c>Helply:Model</c> is not
    /// set, asks the gateway's <c>/models</c> and probes the chat candidates in order with a tiny tool-call request, taking the first that answers 200. Discovery only runs in Development. A discovery failure is not remembered: the next run tries again. Neither the model id, the
    /// URL nor the key is ever logged or returned from here.
    /// </summary>
    public sealed class HelplyGateway(IOptions<HelplyOptions> options, IHttpClientFactory clients)
    {
        public const string ClientName = "Helply.Gateway";

        private static readonly string[] NotChatModels = ["embed", "whisper", "tts", "dall-e", "image", "moderation", "rerank", "audio", "transcribe", "realtime", "speech"];

        private readonly SemaphoreSlim _discovery = new(1, 1);
        private string? _discovered;

        private HelplyOptions Settings => options.Value;

        private string BaseUrl => (Settings.BaseUrl ?? string.Empty).TrimEnd('/');

        public async Task<HelplyConnection> ConnectAsync(CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(Settings.BaseUrl) || string.IsNullOrWhiteSpace(Settings.ApiKey))
                throw new HelplyUnavailableException();

            var model = await ResolveModelAsync(ct);
            var transportOptions = new OpenAIClientOptions
            {
                Endpoint = new Uri(BaseUrl),
                Transport = new HttpClientPipelineTransport(clients.CreateClient(ClientName)),
                RetryPolicy = new ClientRetryPolicy(1),
                NetworkTimeout = TimeSpan.FromSeconds(150),
            };
            return new HelplyConnection(new ChatClient(model, new ApiKeyCredential(Settings.ApiKey), transportOptions), Redactor(model));
        }

        /// <summary>Everything that must not reach a user, as a redactor. The model id is only included once it is known.</summary>
        public HelplyRedactor Redactor(string? model = null)
        {
            var rules = new List<(string, string)>();
            if (!string.IsNullOrWhiteSpace(Settings.ApiKey))
                rules.Add((Settings.ApiKey, HelplyRedactor.SecretReplacement));
            if (!string.IsNullOrWhiteSpace(Settings.BaseUrl))
            {
                rules.Add((BaseUrl, HelplyRedactor.SecretReplacement));
                if (Uri.TryCreate(Settings.BaseUrl, UriKind.Absolute, out var uri))
                {
                    rules.Add((uri.Authority, HelplyRedactor.SecretReplacement));
                    rules.Add((uri.Host, HelplyRedactor.SecretReplacement));
                }
            }
            if (!string.IsNullOrWhiteSpace(model))
                rules.Add((model, HelplyRedactor.ModelReplacement));
            if (!string.IsNullOrWhiteSpace(Settings.Model))
                rules.Add((Settings.Model, HelplyRedactor.ModelReplacement));
            return new HelplyRedactor(rules);
        }

        private async Task<string> ResolveModelAsync(CancellationToken ct)
        {
            if (!string.IsNullOrWhiteSpace(Settings.Model))
                return Settings.Model;
            if (!Settings.AllowModelDiscovery)
                throw new HelplyUnavailableException();
            if (_discovered is { } known)
                return known;

            await _discovery.WaitAsync(ct);
            try
            {
                return _discovered ??= await DiscoverAsync(ct);
            }
            finally
            {
                _discovery.Release();
            }
        }

        private async Task<string> DiscoverAsync(CancellationToken ct)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, BaseUrl + "/models");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Settings.ApiKey);
                using var http = clients.CreateClient(ClientName);
                using var response = await http.SendAsync(request, ct);
                response.EnsureSuccessStatusCode();
                using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
                var ids = document.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array
                    ? data.EnumerateArray().Select(m => m.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString() : null).OfType<string>().ToList()
                    : [];
                foreach (var candidate in ChatCandidates(ids).Take(MaxProbes))
                    if (await ProbeAsync(http, candidate, ct))
                        return candidate;
                throw new HelplyUnavailableException();
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (HelplyUnavailableException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new HelplyUnavailableException();
            }
        }

        /// <summary>How many listed models discovery tries before it gives up.</summary>
        public const int MaxProbes = 8;

        /// <summary>The tool name of the probe request; a gateway sees nothing else of Helply in it.</summary>
        public const string ProbeTool = "helply_probe";

        /// <summary>The listed ids that may be chat models, in the gateway's order.</summary>
        public static IEnumerable<string> ChatCandidates(IEnumerable<string> ids) => ids.Where(id => !NotChatModels.Any(bad => id.Contains(bad, StringComparison.OrdinalIgnoreCase)));

        /// <summary>
        /// Asks one model a tiny question with one tool offered. Only a model that answers 200 to that can run Helply: a listed model may be unusable (no access, retired) or
        /// refuse tools. The answer is not read beyond its status, and nothing about the attempt is logged.
        /// </summary>
        private async Task<bool> ProbeAsync(HttpClient http, string model, CancellationToken ct)
        {
            var body = new
            {
                model,
                stream = false,
                messages = new[] { new { role = "user", content = "Reply with the word ok." } },
                tools = new[] { new { type = "function", function = new { name = ProbeTool, description = "Not used.", parameters = new { type = "object", properties = new { } } } } },
            };
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(30));
                using var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl + "/chat/completions") { Content = JsonContent.Create(body) };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Settings.ApiKey);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                return response.IsSuccessStatusCode;
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                return false;
            }
        }

        /// <summary>The first model id that does not look like an embedding, speech, image or moderation model.</summary>
        public static string? PickChatModel(IEnumerable<string> ids) => ids.FirstOrDefault(id => !NotChatModels.Any(bad => id.Contains(bad, StringComparison.OrdinalIgnoreCase)));
    }
}
