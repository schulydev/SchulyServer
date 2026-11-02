using System.Security.Cryptography;
using Microsoft.Extensions.AI;
using Schuly.API.Helply;
using Schuly.API.Mcp;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Vault;

namespace Schuly.Tests.Helply
{
    public class HelplyUnitTests
    {
        private static HelplyRedactor Redactor() => new([("secret-model-xyz-123", HelplyRedactor.ModelReplacement), ("https://gateway.secret-host.example/v1", HelplyRedactor.SecretReplacement), ("sk-test-key", HelplyRedactor.SecretReplacement)]);

        [Test]
        public async Task The_redactor_replaces_secrets_in_text_regardless_of_case()
        {
            var text = Redactor().Redact("I am SECRET-MODEL-XYZ-123, see https://gateway.secret-host.example/v1 and sk-test-key.");

            await Assert.That(text).IsEqualTo("I am Helply, see [redacted] and [redacted].");
        }

        [Test]
        public async Task The_redactor_catches_a_secret_split_across_every_possible_boundary()
        {
            const string full = "My name is secret-model-xyz-123 and that is all.";
            for (var cut = 1; cut < full.Length; cut++)
            {
                var stream = Redactor().CreateStream();
                var output = stream.Push(full[..cut]) + stream.Push(full[cut..]) + stream.Flush();
                await Assert.That(output).IsEqualTo("My name is Helply and that is all.");
            }

            var piecewise = Redactor().CreateStream();
            var combined = string.Concat(full.Select(c => piecewise.Push(c.ToString()))) + piecewise.Flush();
            await Assert.That(combined).IsEqualTo("My name is Helply and that is all.");
        }

        [Test]
        public async Task The_redactor_does_not_hold_back_text_that_cannot_start_a_secret()
        {
            var stream = Redactor().CreateStream();

            await Assert.That(stream.Push("Hello there, ")).IsEqualTo("Hello there, ");
            await Assert.That(stream.Push("sec")).IsEqualTo(string.Empty);
            await Assert.That(stream.Push("ond")).IsEqualTo("second");
        }

        [Test]
        public async Task Every_mcp_tool_has_a_friendly_label()
        {
            foreach (var name in McpToolCatalog.Names)
                await Assert.That(HelplyToolLabels.KnownTools).Contains(name);
            await Assert.That(HelplyToolLabels.For("list_grades", null)).IsEqualTo(("Looking up your grades", "Looked up your grades"));
            await Assert.That(HelplyToolLabels.For("brand_new_tool", "Brand new")).IsEqualTo(("Using Brand new", "Used Brand new"));
        }

        [Test]
        public async Task A_step_detail_says_only_harmless_things()
        {
            static Dictionary<string, object?> Args(string json) => System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, System.Text.Json.JsonElement>>(json)!.ToDictionary(p => p.Key, p => (object?)p.Value);

            await Assert.That(HelplyToolLabels.Detail("list_mail", Args("{\"offset\":20,\"limit\":20,\"unreadOnly\":true}"))).IsEqualTo("page 2 · unread only");
            await Assert.That(HelplyToolLabels.Detail("list_mail", Args("{\"folder\":\"sentitems\",\"search\":\"from:anna@example.ch\"}"))).IsEqualTo("sent mail · with a search");
            await Assert.That(HelplyToolLabels.Detail("list_mail", Args("{\"folder\":\"AAMkAD-opaque-id\"}"))).IsNull();
            await Assert.That(HelplyToolLabels.Detail("read_mail", Args("{\"messageId\":\"abc\",\"offset\":4000}"))).IsEqualTo("continued");
            await Assert.That(HelplyToolLabels.Detail("list_grades", Args("{}"))).IsNull();
            await Assert.That(HelplyToolLabels.Detail("list_grades", null)).IsNull();
        }

        [Test]
        public async Task Approval_summaries_describe_exactly_what_will_happen()
        {
            var longBody = new string('b', 500);
            var mail = HelplyToolLabels.Approval("send_mail", "Send mail", new Dictionary<string, object?> { ["to"] = new[] { "a@x.ch", "b@x.ch" }, ["subject"] = "Hallo", ["body"] = longBody, ["cc"] = new[] { "c@x.ch" } });
            var absence = HelplyToolLabels.Approval("report_absence", "Report absence", new Dictionary<string, object?> { ["dateFrom"] = "2026-11-02", ["dateTo"] = "2026-11-03", ["reason"] = "Krank", ["comment"] = "Fever" });
            var unknown = HelplyToolLabels.Approval("mystery", "Mystery tool", null);

            await Assert.That(mail.Summary).IsEqualTo("Send an email to a@x.ch, b@x.ch with the subject \"Hallo\"");
            await Assert.That(mail.Details.Single(d => d.Label == "Body preview").Value.Length).IsEqualTo(HelplyToolLabels.BodyPreviewLength + 3);
            await Assert.That(mail.Details.Single(d => d.Label == "Cc").Value).IsEqualTo("c@x.ch");
            await Assert.That(absence.Summary).IsEqualTo("Report an absence from 2026-11-02 to 2026-11-03");
            await Assert.That(absence.Details.Select(d => d.Label)).IsEquivalentTo(new[] { "From", "To", "Reason", "Comment" });
            await Assert.That(unknown.Summary).IsEqualTo("Use Mystery tool");
        }

        [Test]
        public async Task Chat_models_are_picked_by_skipping_embedding_speech_and_image_models()
        {
            await Assert.That(HelplyGateway.PickChatModel(["text-embedding-3", "whisper-1", "tts-1", "dall-e-3", "omni-moderation", "rerank-v3", "gpt-realtime", "the-chat-model", "other"])).IsEqualTo("the-chat-model");
            await Assert.That(HelplyGateway.PickChatModel(["text-embedding-3"])).IsNull();
        }

        [Test]
        public async Task The_mcp_endpoint_prefers_loopback_and_keeps_the_public_host_header()
        {
            var publicEndpoint = new Uri("https://app.schuly.dev/mcp");

            var wildcard = HelplyMcpConnector.ResolveEndpoint(publicEndpoint, ["https://+:443", "http://+:8080"]);
            await Assert.That(wildcard.Endpoint.ToString()).IsEqualTo("http://127.0.0.1:8080/mcp");
            await Assert.That(wildcard.Host).IsEqualTo("app.schuly.dev");
            await Assert.That(HelplyMcpConnector.ResolveEndpoint(publicEndpoint, ["http://0.0.0.0:5033"]).Endpoint.ToString()).IsEqualTo("http://127.0.0.1:5033/mcp");
            await Assert.That(HelplyMcpConnector.ResolveEndpoint(publicEndpoint, ["http://[::]:80"]).Endpoint.ToString()).IsEqualTo("http://127.0.0.1/mcp");
            await Assert.That(HelplyMcpConnector.ResolveEndpoint(publicEndpoint, ["http://localhost:5033"]).Endpoint.ToString()).IsEqualTo("http://localhost:5033/mcp");

            var none = HelplyMcpConnector.ResolveEndpoint(publicEndpoint, []);
            await Assert.That(none.Endpoint).IsEqualTo(publicEndpoint);
            await Assert.That(none.Host).IsNull();
            await Assert.That(HelplyMcpConnector.ResolveEndpoint(publicEndpoint, ["https://+:443"]).Host).IsNull();
        }

        private sealed class CapturingHandler : HttpMessageHandler
        {
            public List<(Uri? Uri, string? Host, string? Authorization)> Seen { get; } = [];

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                Seen.Add((request.RequestUri, request.Headers.Host, request.Headers.Authorization?.ToString()));
                return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable));
            }
        }

        [Test]
        public async Task The_mcp_client_sends_the_loopback_request_with_the_public_host_header()
        {
            var handler = new CapturingHandler();
            var (endpoint, host) = HelplyMcpConnector.ResolveEndpoint(new Uri("https://app.schuly.dev/mcp"), ["http://+:8080"]);
            var headers = new Dictionary<string, string> { ["Authorization"] = "Bearer abc", ["Host"] = host! };
            var transport = new ModelContextProtocol.Client.HttpClientTransport(new ModelContextProtocol.Client.HttpClientTransportOptions { Endpoint = endpoint, TransportMode = ModelContextProtocol.Client.HttpTransportMode.StreamableHttp, AdditionalHeaders = headers }, new HttpClient(handler), ownsHttpClient: true);

            try
            {
                await ModelContextProtocol.Client.McpClient.CreateAsync(transport);
            }
            catch (Exception)
            {
                // The handler answers 503 on purpose; only the request it saw matters.
            }

            await Assert.That(handler.Seen).IsNotEmpty();
            await Assert.That(handler.Seen[0].Uri!.ToString()).IsEqualTo("http://127.0.0.1:8080/mcp");
            await Assert.That(handler.Seen[0].Host).IsEqualTo("app.schuly.dev");
            await Assert.That(handler.Seen[0].Authorization).IsEqualTo("Bearer abc");
        }

        [Test]
        public async Task The_history_reducer_keeps_recent_messages_without_splitting_a_tool_exchange()
        {
            var history = new List<ChatMessage>();
            for (var i = 0; i < 10; i++)
            {
                history.Add(new ChatMessage(ChatRole.User, $"question {i}"));
                history.Add(new ChatMessage(ChatRole.Assistant, [new FunctionCallContent($"c{i}", "list_grades")]));
                history.Add(new ChatMessage(ChatRole.Tool, [new FunctionResultContent($"c{i}", "{}")]));
                history.Add(new ChatMessage(ChatRole.Assistant, $"answer {i}"));
            }

            for (var cap = 3; cap <= 9; cap++)
            {
                var reduced = new HelplyChatReducer(cap, 100_000).Reduce(history);
                await Assert.That(reduced.Count).IsLessThanOrEqualTo(cap + 3);
                await Assert.That(reduced[0].Role).IsEqualTo(ChatRole.User);
                await Assert.That(reduced[0].Contents.Any(c => c is FunctionResultContent)).IsFalse();
                await Assert.That(reduced[^1]).IsEqualTo(history[^1]);
            }

            var capped = new HelplyChatReducer(1000, 120).Reduce(history);
            await Assert.That(capped.Count).IsLessThan(history.Count);
            await Assert.That(capped[0].Role).IsEqualTo(ChatRole.User);

            var one = new List<ChatMessage> { new(ChatRole.User, new string('x', 10_000)) };
            await Assert.That(new HelplyChatReducer(5, 100).Reduce(one).Count).IsEqualTo(1);
        }

        [Test]
        public async Task The_cipher_round_trips_and_binds_a_blob_to_its_row_user_and_field()
        {
            var cipher = new HelplyCipher(VaultKeyring.Ephemeral());
            var conversation = Guid.NewGuid();
            var user = Guid.NewGuid();

            var blob = cipher.Encrypt("Grüezi", conversation, user, HelplyCipher.TitleField);
            var again = cipher.Encrypt("Grüezi", conversation, user, HelplyCipher.TitleField);

            await Assert.That(blob[0]).IsEqualTo((byte)1);
            await Assert.That(blob.SequenceEqual(again)).IsFalse();
            await Assert.That(cipher.DecryptString(blob, conversation, user, HelplyCipher.TitleField)).IsEqualTo("Grüezi");
            foreach (var wrong in new Func<string>[]
            {
                () => cipher.DecryptString(blob, Guid.NewGuid(), user, HelplyCipher.TitleField),
                () => cipher.DecryptString(blob, conversation, Guid.NewGuid(), HelplyCipher.TitleField),
                () => cipher.DecryptString(blob, conversation, user, HelplyCipher.TranscriptField),
                () => cipher.DecryptString([.. blob[..^1], (byte)(blob[^1] ^ 1)], conversation, user, HelplyCipher.TitleField),
                () => new HelplyCipher(VaultKeyring.Ephemeral()).DecryptString(blob, conversation, user, HelplyCipher.TitleField),
            })
            {
                var rejected = false;
                try
                {
                    wrong();
                }
                catch (CryptographicException)
                {
                    rejected = true;
                }
                await Assert.That(rejected).IsTrue();
            }
        }

        [Test]
        public async Task Titles_come_from_the_first_message_and_are_cut_at_sixty_characters()
        {
            await Assert.That(HelplyChatService.AutoTitle("  What   is\nmy average? ")).IsEqualTo("What is my average?");
            var title = HelplyChatService.AutoTitle(new string('a', 100));
            await Assert.That(title).IsEqualTo(new string('a', 60) + "...");
        }
    }
}
