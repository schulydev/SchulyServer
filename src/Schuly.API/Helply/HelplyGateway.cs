using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net.Http.Headers;
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
    /// set, asks the gateway's <c>/models</c> for the first chat-capable model. A discovery failure is not remembered: the next run tries again. Neither the model id, the
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
                return PickChatModel(ids) ?? throw new HelplyUnavailableException();
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

        /// <summary>The first model id that does not look like an embedding, speech, image or moderation model.</summary>
        public static string? PickChatModel(IEnumerable<string> ids) => ids.FirstOrDefault(id => !NotChatModels.Any(bad => id.Contains(bad, StringComparison.OrdinalIgnoreCase)));
    }
}
