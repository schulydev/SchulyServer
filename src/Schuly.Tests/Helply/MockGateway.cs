using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Schuly.Tests.Helply
{
    /// <summary>One request the mock gateway received: where it went and, for chat completions, what the model was offered and told.</summary>
    public sealed record MockRequest(string Method, string Path, string Body, IReadOnlyList<string> ToolNames, IReadOnlyList<MockMessage> Messages)
    {
        public bool IsChat => Path.EndsWith("/chat/completions", StringComparison.Ordinal);
    }

    public sealed record MockMessage(string Role, string? Content, IReadOnlyList<string> ToolCallNames);

    /// <summary>
    /// An in-process OpenAI-compatible gateway: <c>GET /models</c> and streaming <c>POST /chat/completions</c>, wired in as the primary handler of the "Helply.Gateway" client.
    /// What it answers depends on the last user message ("grades" calls list_grades, "send mail" calls send_mail, "boom" fails with the model and URL in the body, "leak" says the
    /// model id), and after a tool result it answers with text. Every request is recorded.
    /// </summary>
    public sealed class MockGatewayHandler : HttpMessageHandler
    {
        public const string BaseUrl = "https://gateway.secret-host.example/v1";
        public const string ApiKey = "sk-test-secret-key-123";
        public const string Model = "secret-model-xyz-123";

        private readonly List<MockRequest> _requests = [];

        public IReadOnlyList<MockRequest> Requests
        {
            get
            {
                lock (_requests)
                    return _requests.ToList();
            }
        }

        public IReadOnlyList<MockRequest> ChatRequests => Requests.Where(r => r.IsChat).ToList();

        /// <summary>Model ids returned by <c>/models</c>, embeddings first like many real gateways.</summary>
        public List<string> Models { get; } = ["text-embedding-x", Model];

        /// <summary>Fail every <c>/models</c> call, to see that discovery is retried.</summary>
        public bool ModelsFail { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            var path = request.RequestUri!.AbsolutePath;
            var parsed = Parse(request.Method.Method, path, body);
            lock (_requests)
                _requests.Add(parsed);

            if (request.Headers.Authorization?.Parameter != ApiKey)
                return new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("{\"error\":\"bad key\"}") };

            if (path.EndsWith("/models", StringComparison.Ordinal))
            {
                if (ModelsFail)
                    return new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent($"upstream {BaseUrl} down") };
                var list = new JsonObject { ["object"] = "list", ["data"] = new JsonArray(Models.Select(m => (JsonNode)new JsonObject { ["id"] = m, ["object"] = "model" }).ToArray()) };
                return Json(list);
            }

            if (path.EndsWith("/chat/completions", StringComparison.Ordinal))
                return Reply(parsed);

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private static MockRequest Parse(string method, string path, string body)
        {
            var tools = new List<string>();
            var messages = new List<MockMessage>();
            if (body.StartsWith('{'))
            {
                var root = JsonNode.Parse(body)!.AsObject();
                if (root["tools"] is JsonArray toolArray)
                    tools.AddRange(toolArray.Select(t => t?["function"]?["name"]?.GetValue<string>()).OfType<string>());
                if (root["messages"] is JsonArray messageArray)
                {
                    foreach (var m in messageArray)
                    {
                        var content = m?["content"] switch
                        {
                            JsonValue v when v.TryGetValue<string>(out var s) => s,
                            JsonArray parts => string.Concat(parts.Select(p => p?["text"]?.GetValue<string>())),
                            _ => null,
                        };
                        var calls = (m?["tool_calls"] as JsonArray)?.Select(c => c?["function"]?["name"]?.GetValue<string>()).OfType<string>().ToList() ?? [];
                        messages.Add(new MockMessage(m?["role"]?.GetValue<string>() ?? string.Empty, content, calls));
                    }
                }
            }
            return new MockRequest(method, path, body, tools, messages);
        }

        /// <summary>The next this many chat requests fail with an error whose body names the model, the URL and the key.</summary>
        public int FailNextChats { get; set; }

        private HttpResponseMessage Reply(MockRequest request)
        {
            if (FailNextChats > 0)
            {
                FailNextChats--;
                return Failure();
            }

            var last = request.Messages.Last();
            if (last.Role == "tool")
            {
                var earlier = request.Messages.LastOrDefault(m => m.ToolCallNames.Count > 0)?.ToolCallNames[0];
                var declined = last.Content?.Contains("declin", StringComparison.OrdinalIgnoreCase) == true || last.Content?.Contains("reject", StringComparison.OrdinalIgnoreCase) == true;
                return Stream(Text(declined ? "Okay, I did not do it." : earlier == "send_mail" ? "The mail is handled." : "Your grades look good", 5));
            }

            var user = request.Messages.LastOrDefault(m => m.Role == "user")?.Content ?? string.Empty;
            if (user.Contains("boom", StringComparison.OrdinalIgnoreCase))
                return Failure();
            if (user.Contains("leak", StringComparison.OrdinalIgnoreCase))
                return Stream(Text($"I am {Model} behind {BaseUrl} on gateway.secret-host.example, key {ApiKey}. Done.", 3));
            if (user.Contains("grades", StringComparison.OrdinalIgnoreCase))
                return Stream(ToolCall("call_grades", "list_grades", "{}"));
            if (user.Contains("send mail", StringComparison.OrdinalIgnoreCase))
                return Stream(ToolCall("call_mail", "send_mail", "{\"to\":[\"anna@example.ch\"],\"subject\":\"Hallo\",\"body\":\"Hi Anna, see you tomorrow.\"}"));
            return Stream(Text("Hello from the mock.", 4));
        }

        private static HttpResponseMessage Failure() => new(HttpStatusCode.InternalServerError) { Content = new StringContent($"{{\"error\":{{\"message\":\"The model {Model} failed at {BaseUrl}/chat/completions with key {ApiKey}\"}}}}", Encoding.UTF8, "application/json") };

        private static IEnumerable<JsonObject> Text(string text, int piece)
        {
            yield return Chunk(new JsonObject { ["role"] = "assistant", ["content"] = string.Empty }, null);
            for (var i = 0; i < text.Length; i += piece)
                yield return Chunk(new JsonObject { ["content"] = text.Substring(i, Math.Min(piece, text.Length - i)) }, null);
            yield return Chunk(new JsonObject(), "stop");
        }

        private static IEnumerable<JsonObject> ToolCall(string id, string name, string arguments)
        {
            yield return Chunk(new JsonObject { ["role"] = "assistant", ["content"] = null }, null);
            yield return Chunk(new JsonObject { ["tool_calls"] = new JsonArray(new JsonObject { ["index"] = 0, ["id"] = id, ["type"] = "function", ["function"] = new JsonObject { ["name"] = name, ["arguments"] = arguments } }) }, null);
            yield return Chunk(new JsonObject(), "tool_calls");
        }

        private static JsonObject Chunk(JsonObject delta, string? finish) => new()
        {
            ["id"] = "chatcmpl-1",
            ["object"] = "chat.completion.chunk",
            ["created"] = 1_700_000_000,
            ["model"] = Model,
            ["choices"] = new JsonArray(new JsonObject { ["index"] = 0, ["delta"] = delta, ["finish_reason"] = finish }),
        };

        private static HttpResponseMessage Stream(IEnumerable<JsonObject> chunks)
        {
            var builder = new StringBuilder();
            foreach (var chunk in chunks)
                builder.Append("data: ").Append(chunk.ToJsonString()).Append("\n\n");
            builder.Append("data: [DONE]\n\n");
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(builder.ToString(), Encoding.UTF8, "text/event-stream") };
        }

        private static HttpResponseMessage Json(JsonNode node) => new(HttpStatusCode.OK) { Content = new StringContent(node.ToJsonString(), Encoding.UTF8, "application/json") };
    }
}
