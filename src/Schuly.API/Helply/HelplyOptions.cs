using System.Net;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Schuly.API.Services;
using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Helply's OpenAI-compatible chat-completions gateway, from <c>Helply__BaseUrl</c>, <c>Helply__ApiKey</c> and optional <c>Helply__Model</c>. None of these
    /// has a default and none belongs in appsettings. They are secrets of the deployment: no API response, error message or log line may contain the URL, key or model.
    /// Outside Development the model is required, and the gateway must be https or on a private address, so what the privacy policy says about the model can be checked.
    /// </summary>
    public class HelplyOptions
    {
        public const string SectionName = "Helply";

        public string? BaseUrl { get; set; }
        public string? ApiKey { get; set; }
        public string? Model { get; set; }

        /// <summary>Set by <see cref="HelplyExtensions.AddSchulyHelply"/>, never from configuration: only Development may pick whichever model answers.</summary>
        public bool AllowModelDiscovery { get; set; }
    }

    public static class HelplyGatewayRules
    {
        private static readonly string[] PrivateSuffixes = [".local", ".internal", ".lan", ".home.arpa", ".localhost"];

        /// <summary>https anywhere; plain http only to a place that can't be on the public internet: a private IP, localhost, a single-label service name or a private suffix.</summary>
        public static bool IsAllowed(Uri uri)
        {
            if (uri.Scheme == Uri.UriSchemeHttps)
                return true;
            if (uri.Scheme != Uri.UriSchemeHttp)
                return false;

            if (uri.HostNameType is UriHostNameType.IPv4 or UriHostNameType.IPv6)
                return IPAddress.TryParse(uri.Host.Trim('[', ']'), out var ip) && NetworkAddresses.IsPrivate(ip);

            var host = uri.IdnHost.TrimEnd('.').ToLowerInvariant();
            return !host.Contains('.') || PrivateSuffixes.Any(suffix => host.EndsWith(suffix, StringComparison.Ordinal));
        }
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
        public int MaxOutputTokens { get; set; } = 8192;

        /// <summary>Tool round trips in a turn that has the workspace; running and fixing code takes more steps than looking something up.</summary>
        public int MaxToolIterationsWithWorkspace { get; set; } = 16;

        /// <summary>The turn's time budget when the workspace is on, since a single command may take up to a minute.</summary>
        public int RunTimeoutSecondsWithWorkspace { get; set; } = 300;

        /// <summary>The longest text any one tool result may put into the prompt; longer results are cut with a note.</summary>
        public int MaxToolResultChars { get; set; } = 16_000;

        /// <summary>The longest arguments (serialized) a tool call may carry; a larger call is refused before it runs.</summary>
        public int MaxToolArgumentChars { get; set; } = 20_000;

        /// <summary>The most text of one attachment that goes into the prompt as text.</summary>
        public int MaxAttachmentTextChars { get; set; } = 30_000;

        /// <summary>The most attachment text all attachments together may put into one model request.</summary>
        public int MaxAttachmentTextTotalChars { get; set; } = 60_000;

        /// <summary>The most file bytes (images, PDFs) sent as files in one model request.</summary>
        public long MaxNativeBytesPerRequest { get; set; } = 12_000_000;
    }

    /// <summary>
    /// How attachments reach the model, <c>Helply:Attachments</c>. OpenAI-compatible gateways almost all take images as <c>image_url</c> parts, while far fewer take PDF
    /// <c>file</c> parts, so images go natively by default and PDFs as extracted text. A gateway that rejects a request carrying files is answered by sending the same turn again
    /// with text only, and files then stay text for the rest of the process.
    /// </summary>
    public class HelplyAttachmentOptions
    {
        public const string SectionName = "Helply:Attachments";

        public bool NativeImages { get; set; } = true;
        public bool NativePdf { get; set; }
    }

    /// <summary>Whether Helply can run. Decided once at startup; a missing setting only switches Helply off, it never stops the server.</summary>
    public sealed class HelplyAvailability
    {
        public bool IsEnabled { get; init; }

        /// <summary>Why settings that were given can't be used. Names settings, never a value.</summary>
        public IReadOnlyList<string> Refused { get; init; } = [];
    }

    public static class HelplyExtensions
    {
        public static IServiceCollection AddSchulyHelply(this IServiceCollection services, IConfiguration configuration, bool isDevelopment)
        {
            services.Configure<HelplyOptions>(configuration.GetSection(HelplyOptions.SectionName));
            services.PostConfigure<HelplyOptions>(o => o.AllowModelDiscovery = isDevelopment);

            var options = configuration.GetSection(HelplyOptions.SectionName).Get<HelplyOptions>() ?? new HelplyOptions();
            var enabled = Uri.TryCreate(options.BaseUrl, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && !string.IsNullOrWhiteSpace(options.ApiKey);
            var refused = new List<string>();
            if (enabled && !isDevelopment)
            {
                if (string.IsNullOrWhiteSpace(options.Model))
                    refused.Add("set Helply__Model: outside Development the server does not pick a model itself");
                if (!HelplyGatewayRules.IsAllowed(uri!))
                    refused.Add("point Helply__BaseUrl at https or a private address");
            }
            services.AddSingleton(new HelplyAvailability { IsEnabled = enabled && refused.Count == 0, Refused = refused });
            services.Configure<HelplyLimits>(configuration.GetSection(HelplyLimits.SectionName));
            services.Configure<HelplyAttachmentOptions>(configuration.GetSection(HelplyAttachmentOptions.SectionName));
            services.Configure<HelplySandboxOptions>(configuration.GetSection(HelplySandboxOptions.SectionName));

            // Named clients carry no logging at all: the default handlers would log the request URI, which is the gateway address.
            services.AddHttpClient(HelplyGateway.ClientName, client => client.Timeout = TimeSpan.FromSeconds(180)).RemoveAllLoggers();
            services.AddHttpClient(HelplyMcpConnector.ClientName, client => client.Timeout = TimeSpan.FromSeconds(120)).RemoveAllLoggers();
            services.AddHttpClient(HelplySandboxClient.ClientName, client => client.Timeout = TimeSpan.FromSeconds(150)).RemoveAllLoggers();

            services.TryAddSingleton(TimeProvider.System);
            services.AddSingleton<HelplyCipher>();
            services.AddScoped<HelplyConversationStore>();
            services.AddSingleton<HelplyGateway>();
            services.AddSingleton<HelplyRateLimiter>();
            services.AddSingleton<HelplyTurnLocks>();
            services.AddSingleton<IHelplySandboxClient, HelplySandboxClient>();
            services.AddSingleton<HelplySandboxQuota>();
            services.AddSingleton<HelplyNativeFiles>();
            services.AddScoped<HelplyMcpConnector>();
            services.AddScoped<HelplyChatService>();
            services.AddHostedService<HelplyCleanupService>();
            services.AddHostedService<HelplyStartupCheck>();
            return services;
        }
    }

    /// <summary>Says once whether Helply is on. It names the missing setting, never a value.</summary>
    internal sealed class HelplyStartupCheck(HelplyAvailability availability, IHelplySandboxClient sandbox, ILogger<HelplyStartupCheck> logger) : IHostedService
    {
        public Task StartAsync(CancellationToken cancellationToken)
        {
            if (availability.IsEnabled)
                logger.LogInformation("Helply is enabled");
            else if (availability.Refused.Count > 0)
                logger.LogError("Helply is off: {Reasons}", string.Join("; ", availability.Refused));
            else
                logger.LogWarning("Helply is disabled: set Helply__BaseUrl (an absolute http or https URL) and Helply__ApiKey to enable it");
            if (availability.IsEnabled)
            {
                if (sandbox.IsConfigured)
                    logger.LogInformation("Helply's workspace sandbox is configured");
                else
                    logger.LogInformation("Helply has no workspace: set Helply__Sandbox__BaseUrl and Helply__Sandbox__ApiKey (at least 32 characters) to offer it");
            }
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
