using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Schuly.API.Helply;
using Schuly.Infrastructure.Vault;

namespace Schuly.Tests.Helply
{
    public class HelplyPolicyTests
    {
        private static ServiceProvider Services(bool isDevelopment, string? baseUrl, string? model, CapturingLoggerProvider? logs = null)
        {
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Helply:BaseUrl"] = baseUrl,
                ["Helply:ApiKey"] = "key",
                ["Helply:Model"] = model,
            }).Build();

            var services = new ServiceCollection();
            services.AddLogging(l => { if (logs is not null) l.AddProvider(logs); });
            services.AddSingleton(VaultKeyring.Ephemeral());
            services.AddSchulyHelply(configuration, isDevelopment);
            return services.BuildServiceProvider();
        }

        private static bool Enabled(bool isDevelopment, string? baseUrl, string? model)
        {
            using var provider = Services(isDevelopment, baseUrl, model);
            return provider.GetRequiredService<HelplyAvailability>().IsEnabled;
        }

        [Test]
        [Arguments("https://gateway.example", true)]
        [Arguments("http://gateway.example", false)]
        [Arguments("http://8.8.8.8:8000", false)]
        [Arguments("http://10.0.0.5:8000", true)]
        [Arguments("http://192.168.1.20", true)]
        [Arguments("http://172.20.0.3:8000", true)]
        [Arguments("http://[fd00::1]:8000", true)]
        [Arguments("http://localhost:8000", true)]
        [Arguments("http://litellm:4000", true)]
        [Arguments("http://llm.internal:4000", true)]
        [Arguments("ftp://10.0.0.5", false)]
        [Arguments("not a url", false)]
        public async Task The_gateway_must_be_https_or_private(string baseUrl, bool enabled)
        {
            await Assert.That(Enabled(false, baseUrl, "the-model")).IsEqualTo(enabled);
        }

        [Test]
        public async Task Outside_development_helply_needs_a_configured_model()
        {
            await Assert.That(Enabled(false, "https://gateway.example", null)).IsFalse();
            await Assert.That(Enabled(false, "https://gateway.example", "the-model")).IsTrue();
        }

        [Test]
        public async Task Development_keeps_discovery_and_plain_http()
        {
            await Assert.That(Enabled(true, "http://gateway.example", null)).IsTrue();
        }

        [Test]
        public async Task Outside_development_a_missing_model_logs_an_error_without_values()
        {
            var logs = new CapturingLoggerProvider();
            using var provider = Services(false, "http://gateway.secret.example", null, logs);
            foreach (var service in provider.GetServices<IHostedService>().Where(s => s.GetType().Name == "HelplyStartupCheck"))
                await service.StartAsync(CancellationToken.None);

            await Assert.That(logs.All).Contains("[Error]");
            await Assert.That(logs.All).Contains("Helply__Model");
            await Assert.That(logs.All).Contains("Helply__BaseUrl");
            await Assert.That(logs.All).DoesNotContain("secret");
        }

        [Test]
        public async Task Outside_development_the_gateway_refuses_discovery()
        {
            using var provider = Services(false, "https://gateway.example", null);
            var gateway = provider.GetRequiredService<HelplyGateway>();

            await Assert.That(async () => await gateway.ConnectAsync(CancellationToken.None)).Throws<HelplyUnavailableException>();
        }

        [Test]
        public async Task The_prompt_no_longer_hides_the_model_and_says_it_is_an_ai()
        {
            var prompt = HelplyPrompt.System(DateTimeOffset.UtcNow);

            await Assert.That(prompt).DoesNotContain("Never reveal");
            await Assert.That(prompt).Contains("not a person");
            await Assert.That(prompt).Contains("privacy policy");
        }
    }
}
