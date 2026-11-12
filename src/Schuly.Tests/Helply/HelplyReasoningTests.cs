using Microsoft.Extensions.DependencyInjection;
using Schuly.API.Helply;
using Schuly.Domain.Helply;
using Schuly.Infrastructure.Helply;

namespace Schuly.Tests.Helply
{
    public class HelplyReasoningTests
    {
        private static string Effort(MockRequest request) => System.Text.Json.Nodes.JsonNode.Parse(request.Body)!["reasoning_effort"]?.GetValue<string>() ?? "none";

        [Test]
        public async Task Reasoning_defaults_to_high_without_a_settings_row()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Reasoning_defaults_to_high_without_a_settings_row));
            var (userId, token) = host.NewUser();

            var settings = await host.CallAsync(HttpMethod.Get, "/api/helply/settings", token);
            await Assert.That(settings.Json.GetProperty("reasoningEffort").GetString()).IsEqualTo("High");
            await Assert.That(await host.ScopedAsync(sp => sp.GetRequiredService<HelplyConversationStore>().GetReasoningEffortAsync(userId))).IsEqualTo(HelplyReasoningEffort.High);
            await Assert.That(new HelplySettings().ReasoningEffort).IsEqualTo(HelplyReasoningEffort.High);
        }

        [Test]
        public async Task Updating_reasoning_persists_and_keeps_the_other_settings()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Updating_reasoning_persists_and_keeps_the_other_settings));
            var (userId, token) = host.NewUser();

            var (status, json, _) = await host.CallAsync(HttpMethod.Put, "/api/helply/settings/reasoning", token, new { effort = "Low" });
            await Assert.That((int)status).IsEqualTo(200);
            await Assert.That(json.GetProperty("reasoningEffort").GetString()).IsEqualTo("Low");

            await host.CallAsync(HttpMethod.Put, "/api/helply/settings/workspace", token, new { enabled = true });
            var settings = await host.CallAsync(HttpMethod.Get, "/api/helply/settings", token);
            await Assert.That(settings.Json.GetProperty("reasoningEffort").GetString()).IsEqualTo("Low");
            await Assert.That(await host.ScopedAsync(sp => sp.GetRequiredService<HelplyConversationStore>().GetReasoningEffortAsync(userId))).IsEqualTo(HelplyReasoningEffort.Low);

            var bad = await host.CallAsync(HttpMethod.Put, "/api/helply/settings/reasoning", token, new { effort = 9 });
            await Assert.That((int)bad.Status).IsNotEqualTo(200);
        }

        [Test]
        public async Task The_users_effort_reaches_the_model_request()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(The_users_effort_reaches_the_model_request));
            host.Gateway.Models.Insert(0, "reasoning-model-effort");
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);

            await host.SendMessageAsync(token, id, "hello");
            await Assert.That(Effort(host.Gateway.ChatRequests.Last())).IsEqualTo("high");

            await host.CallAsync(HttpMethod.Put, "/api/helply/settings/reasoning", token, new { effort = "Medium" });
            await host.SendMessageAsync(token, id, "hello again");
            await Assert.That(Effort(host.Gateway.ChatRequests.Last())).IsEqualTo("medium");
        }

        [Test]
        public async Task A_gateway_that_rejects_reasoning_is_asked_again_without_it_and_remembered()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_gateway_that_rejects_reasoning_is_asked_again_without_it_and_remembered));
            host.Gateway.Models.Insert(0, "reasoning-model-rejecting");
            host.Gateway.RejectReasoning = true;
            var (_, token) = host.NewUser();
            var id = await host.CreateConversationAsync(token);

            var first = await host.SendMessageAsync(token, id, "hello");
            await Assert.That(first.Text).Contains("Hello from the mock.");
            var afterFirst = host.Gateway.ChatRequests;
            await Assert.That(afterFirst.Count).IsEqualTo(2);
            await Assert.That(Effort(afterFirst[0])).IsEqualTo("high");
            await Assert.That(Effort(afterFirst[1])).IsEqualTo("none");
            await Assert.That(HelplyReasoningSupport.IsRefused("reasoning-model-rejecting")).IsTrue();

            await host.SendMessageAsync(token, id, "hello again");
            var all = host.Gateway.ChatRequests;
            await Assert.That(all.Count).IsEqualTo(3);
            await Assert.That(Effort(all[2])).IsEqualTo("none");
        }

        [Test]
        public async Task Model_discovery_does_not_send_a_reasoning_effort()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Model_discovery_does_not_send_a_reasoning_effort));
            host.Gateway.Models.Insert(0, "reasoning-model-probe");
            host.Gateway.RejectReasoning = true;
            var (_, token) = host.NewUser();
            await host.SendMessageAsync(token, await host.CreateConversationAsync(token), "hello");

            await Assert.That(host.Gateway.Requests.Where(r => r.IsProbe).Any(r => r.Body.Contains("reasoning_effort"))).IsFalse();
        }
    }
}
