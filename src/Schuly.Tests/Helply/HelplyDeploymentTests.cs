namespace Schuly.Tests.Helply
{
    /// <summary>Failures seen in production, reproduced in process.</summary>
    public class HelplyDeploymentTests
    {
        /// <summary>
        /// Behind the proxy, without <c>Mcp:PublicUrl</c>: the user's request arrives as https, so Helply's internal token is issued for https://host/mcp, but Helply's MCP client
        /// calls the server over plain http on loopback. Before the fix the server derived http://host/mcp for the audience check, refused the token, and every turn failed.
        /// </summary>
        [Test]
        public async Task Helply_reaches_its_own_mcp_over_loopback_http_when_the_public_url_is_https()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Helply_reaches_its_own_mcp_over_loopback_http_when_the_public_url_is_https), settings: new Dictionary<string, string?> { ["Mcp:PublicUrl"] = "", ["ForwardedHeaders:KnownNetworks:0"] = "172.16.0.0/12" }, behindProxy: true);
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);

            var turn = await host.SendMessageAsync(token, chat, "show my grades");

            await Assert.That(turn.Names).DoesNotContain("error");
            await Assert.That(turn.Names).Contains("done");
            await Assert.That(turn.Named("tool_finished").Single().Json.GetProperty("status").GetString()).IsEqualTo("done");
            await Assert.That(host.Gateway.ChatRequests[0].ToolNames).Contains("list_grades");
        }

        [Test]
        public async Task A_failed_turn_logs_the_http_status_but_no_secret()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_failed_turn_logs_the_http_status_but_no_secret));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);

            await host.SendMessageAsync(token, chat, "boom");

            var line = host.Logs.Lines.Single(l => l.Contains("Helply turn failed"));
            await Assert.That(line).Contains("HTTP status 500");
            await Assert.That(host.Logs.All).DoesNotContain(MockGatewayHandler.ApiKey);
            await Assert.That(host.Logs.All).DoesNotContain(MockGatewayHandler.Model);
            await Assert.That(host.Logs.All).DoesNotContain("secret-host");
        }

        /// <summary>The first listed model may be unusable (no access, retired). Discovery probes the candidates and takes the first that answers, once.</summary>
        [Test]
        public async Task Model_discovery_skips_listed_models_that_do_not_answer()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Model_discovery_skips_listed_models_that_do_not_answer));
            host.Gateway.Models.Insert(0, "broken-model-a");
            host.Gateway.Models.Insert(1, "broken-model-b");
            host.Gateway.BrokenModels.Add("broken-model-a");
            host.Gateway.BrokenModels.Add("broken-model-b");
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);

            await Assert.That((await host.SendMessageAsync(token, chat, "hello")).Names).Contains("done");
            await Assert.That((await host.SendMessageAsync(token, chat, "hello again")).Names).Contains("done");

            await Assert.That(host.Gateway.ChatRequests.All(r => r.Body.Contains($"\"model\":\"{MockGatewayHandler.Model}\""))).IsTrue();
            var probes = host.Gateway.Requests.Where(r => r.IsProbe).ToList();
            // a, b, then the working one; the choice is cached, so the second turn probes nothing.
            await Assert.That(probes.Count).IsEqualTo(3);
            await Assert.That(probes.Any(p => p.Body.Contains("text-embedding"))).IsFalse();
            await Assert.That(host.Logs.All).DoesNotContain(MockGatewayHandler.Model);
            await Assert.That(host.Logs.All).DoesNotContain("broken-model");
        }
    }
}
