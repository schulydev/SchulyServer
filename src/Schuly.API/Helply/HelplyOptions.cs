using Microsoft.Extensions.DependencyInjection.Extensions;
using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Helply's OpenAI-compatible chat-completions gateway, from <c>Helply__BaseUrl</c>, <c>Helply__ApiKey</c> and optional <c>Helply__Model</c>. None of these
    /// has a default and none belongs in appsettings. They are secrets of the deployment: no API response, error message or log line may contain the URL, key or model.
    /// </summary>
    public class HelplyOptions
    {
        public const string SectionName = "Helply";

        public string? BaseUrl { get; set; }
        public string? ApiKey { get; set; }
        public string? Model { get; set; }
    }

    /// <summary>Per-user and per-run limits, <c>Helply:Limits</c>. Nothing secret, so these may live in appsettings.</summary>
    public class HelplyLimits
    {
        public const string SectionName = "Helply:Limits";

        public int MessagesPerMinute { get; set; } = 10;
        public int MessagesPerDay { get; set; } = 200;
        public int MaxInputChars { get; set; } = 4000;
        public int RunTimeoutSeconds { get; set; } = 120;
        public int MaxToolIterations { get; set; } = 8;
        public int MaxHistoryMessages { get; set; } = 40;
        public int MaxHistoryChars { get; set; } = 60000;
        public int MaxOutputTokens { get; set; } = 2048;
    }

    /// <summary>Whether Helply can run. Decided once at startup; a missing setting only switches Helply off, it never stops the server.</summary>
    public sealed class HelplyAvailability
    {
        public bool IsEnabled { get; init; }
    }

    public static class HelplyExtensions
    {
        public static IServiceCollection AddSchulyHelply(this IServiceCollection services, IConfiguration configuration)
        {
            services.Configure<HelplyOptions>(configuration.GetSection(HelplyOptions.SectionName));

            var options = configuration.GetSection(HelplyOptions.SectionName).Get<HelplyOptions>() ?? new HelplyOptions();
            var enabled = Uri.TryCreate(options.BaseUrl, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && !string.IsNullOrWhiteSpace(options.ApiKey);
            services.AddSingleton(new HelplyAvailability { IsEnabled = enabled });
            services.Configure<HelplyLimits>(configuration.GetSection(HelplyLimits.SectionName));

            // Named clients carry no logging at all: the default handlers would log the request URI, which is the gateway address.
            services.AddHttpClient(HelplyGateway.ClientName, client => client.Timeout = TimeSpan.FromSeconds(180)).RemoveAllLoggers();
            services.AddHttpClient(HelplyMcpConnector.ClientName, client => client.Timeout = TimeSpan.FromSeconds(120)).RemoveAllLoggers();

            services.TryAddSingleton(TimeProvider.System);
            services.AddSingleton<HelplyCipher>();
            services.AddScoped<HelplyConversationStore>();
            services.AddSingleton<HelplyGateway>();
            services.AddSingleton<HelplyRateLimiter>();
            services.AddSingleton<HelplyTurnLocks>();
            services.AddScoped<HelplyMcpConnector>();
            services.AddScoped<HelplyChatService>();
            services.AddHostedService<HelplyCleanupService>();
            services.AddHostedService<HelplyStartupCheck>();
            return services;
        }
    }

    /// <summary>Says once whether Helply is on. It names the missing setting, never a value.</summary>
    internal sealed class HelplyStartupCheck(HelplyAvailability availability, ILogger<HelplyStartupCheck> logger) : IHostedService
    {
        public Task StartAsync(CancellationToken cancellationToken)
        {
            if (availability.IsEnabled)
                logger.LogInformation("Helply is enabled");
            else
                logger.LogWarning("Helply is disabled: set Helply__BaseUrl (an absolute http or https URL) and Helply__ApiKey to enable it");
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
