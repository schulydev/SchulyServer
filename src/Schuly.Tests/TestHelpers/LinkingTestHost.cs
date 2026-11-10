using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Schuly.API.Controllers;
using Schuly.API.Extensions;
using Schuly.API.Linking;
using Schuly.Infrastructure.Services;
using Schuly.Plugin.Abstractions.Linking;

namespace Schuly.Tests.TestHelpers
{
    public sealed class FakeLinkCatalog(params ILinkProvider[] providers) : ILinkProviderCatalog
    {
        private readonly List<ILinkProvider> _providers = providers.ToList();

        public IReadOnlyList<LinkProviderEntry> Providers => _providers.Select(Entry).ToList();

        public LinkProviderEntry? Find(string providerId) => _providers.Where(p => p.Descriptor.Id == providerId).Select(Entry).FirstOrDefault();

        public ILinkProviderLease? Open(string providerId) => _providers.FirstOrDefault(p => p.Descriptor.Id == providerId) is { } p ? new Lease(p) : null;

        private static LinkProviderEntry Entry(ILinkProvider p)
        {
            var svg = SvgSanitizer.Sanitize(p.Descriptor.Icon.Svg);
            return new LinkProviderEntry(p.Descriptor, svg, svg is null ? null : SvgSanitizer.Version(svg));
        }

        private sealed class Lease(ILinkProvider provider) : ILinkProviderLease
        {
            public ILinkProvider Provider { get; } = provider;
            public void Dispose() { }
        }
    }

    /// <summary>Scriptable link provider: each hook defaults to a trivial one-form-then-done flow.</summary>
    public sealed class ScriptedLinkProvider(string id = "test-provider") : ILinkProvider
    {
        public LinkProviderDescriptor Descriptor { get; set; } = new()
        {
            Id = id,
            DisplayName = "Test Provider",
            Capabilities = [new ProviderCapability("mail", "Mail", null, "/api/plugins/test/accounts")],
            Flows = [new LinkFlowDescriptor { Id = "password", Label = "Password" }],
        };

        public Func<LinkStartContext, LinkStepResult> OnStart { get; set; } = _ => new LinkStepResult(CredentialsStep, "start-state");
        public Func<LinkSubmitContext, LinkStepResult> OnSubmit { get; set; } = c => LinkStepResult.Done("acc-1", "Account");
        public Func<LinkPollContext, LinkStepResult> OnPoll { get; set; } = _ => LinkStepResult.Fail("poll");
        public Func<Guid, IReadOnlyList<LinkedAccountSummary>> OnList { get; set; } = _ => [];
        public Func<Guid, string, bool> OnUnlink { get; set; } = (_, _) => true;
        public List<LinkSubmitContext> Submits { get; } = [];
        public int PollCalls;

        public static LinkStep CredentialsStep { get; } = new()
        {
            Id = "credentials",
            Kind = LinkStepKind.Form,
            Title = "Sign in",
            Fields =
            [
                new LinkField { Key = "email", Label = "Email", Type = LinkFieldType.Email },
                new LinkField { Key = "password", Label = "Password", Type = LinkFieldType.Password, Secret = true },
            ],
        };

        public Task<LinkStepResult> StartAsync(LinkStartContext context, CancellationToken cancellationToken = default) => Task.FromResult(OnStart(context));

        public Task<LinkStepResult> SubmitAsync(LinkSubmitContext context, CancellationToken cancellationToken = default)
        {
            lock (Submits)
                Submits.Add(context);
            return Task.FromResult(OnSubmit(context));
        }

        public Task<LinkStepResult> PollAsync(LinkPollContext context, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref PollCalls);
            return Task.FromResult(OnPoll(context));
        }

        public Task<IReadOnlyList<LinkedAccountSummary>> ListAccountsAsync(Guid applicationUserId, CancellationToken cancellationToken = default) => Task.FromResult(OnList(applicationUserId));

        public Task<bool> UnlinkAsync(Guid applicationUserId, string accountId, CancellationToken cancellationToken = default) => Task.FromResult(OnUnlink(applicationUserId, accountId));
    }

    public sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public List<string> Lines { get; } = [];

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(this);

        public void Dispose() { }

        private sealed class CapturingLogger(CapturingLoggerProvider owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                lock (owner.Lines)
                    owner.Lines.Add(formatter(state, exception) + (exception is null ? string.Empty : "\n" + exception));
            }
        }
    }

    internal sealed class HeaderAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-User", out var user))
                return Task.FromResult(AuthenticateResult.NoResult());

            var identity = new ClaimsIdentity([new Claim("sub", user.ToString())], "Test");
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), "Test")));
        }
    }

    internal sealed class HeaderUserService(IHttpContextAccessor accessor) : IUserService
    {
        public Task<Guid> GetCurrentUserIdAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Guid.Parse(accessor.HttpContext!.Request.Headers["X-Test-User"].ToString()));

        public Task<IReadOnlyList<Guid>> GetCurrentUserSchoolUserIdsAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Guid>>([]);
        public Task<bool> ExistsAsync(string externalId, CancellationToken cancellationToken = default) => Task.FromResult(true);
        public Task TouchLastSeenAsync(string externalId, string? verifiedEmail, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task SyncCurrentUserAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    /// <summary>TestServer with only the linking controller, the real linking service and the real rate limiter and OpenAPI wiring.</summary>
    public sealed class LinkingTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;
        public HttpClient Client { get; }
        public LinkSessionStore Sessions { get; }
        private readonly CapturingLoggerProvider _logs;
        public FakeTime Time { get; }
        public Guid UserA { get; } = Guid.NewGuid();
        public Guid UserB { get; } = Guid.NewGuid();

        private LinkingTestHost(WebApplication app, FakeTime time, CapturingLoggerProvider logs)
        {
            _app = app;
            _logs = logs;
            Time = time;
            Client = app.GetTestClient();
            Sessions = app.Services.GetRequiredService<LinkSessionStore>();
        }

        public sealed class FakeTime : TimeProvider
        {
            private DateTimeOffset _now = DateTimeOffset.UtcNow;
            public override DateTimeOffset GetUtcNow() => _now;
            public void Advance(TimeSpan by) => _now += by;
        }

        public static Task<LinkingTestHost> StartAsync(params ILinkProvider[] providers) => StartAsync(null, providers);

        public static async Task<LinkingTestHost> StartAsync(Action<IServiceCollection>? configure, params ILinkProvider[] providers)
        {
            var logs = new CapturingLoggerProvider();
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Logging.ClearProviders();
            builder.Logging.AddProvider(logs);
            builder.Logging.SetMinimumLevel(LogLevel.Trace);

            var time = new FakeTime();
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddSingleton<TimeProvider>(time);
            builder.Services.AddSchulyOpenApi(builder.Configuration);
            builder.Services.AddSchulyControllers().AddApplicationPart(typeof(LinkingController).Assembly);
            builder.Services.AddDataProtection();
            builder.Services.AddSingleton<ILinkProviderCatalog>(new FakeLinkCatalog(providers));
            builder.Services.AddSingleton<LinkSessionStore>();
            builder.Services.AddSingleton<LinkingService>();
            builder.Services.AddScoped<IUserService, HeaderUserService>();
            builder.Services.AddSchulyRateLimiting();
            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, HeaderAuthHandler>("Test", null);
            builder.Services.AddAuthorizationBuilder().SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
            configure?.Invoke(builder.Services);

            var app = builder.Build();
            // Stands in for the ForwardedHeaders middleware: it resolves the client IP before the rate limiter runs.
            app.Use((context, next) =>
            {
                if (context.Request.Headers.TryGetValue("X-Test-Ip", out var ip))
                    context.Connection.RemoteIpAddress = System.Net.IPAddress.Parse(ip.ToString());
                return next();
            });
            app.UseRouting();
            app.UseAuthentication();
            app.UseRateLimiter();
            app.UseAuthorization();
            app.MapControllers();
            app.MapOpenApi().AllowAnonymous();
            await app.StartAsync();

            return new LinkingTestHost(app, time, logs);
        }

        public IReadOnlyList<string> LogLines => _logs.Lines.ToList();

        public HttpRequestMessage Request(HttpMethod method, string url, Guid? user, object? body = null, string? client = null, string? ip = null)
        {
            var request = new HttpRequestMessage(method, url);
            if (ip is not null)
                request.Headers.Add("X-Test-Ip", ip);
            if (user is { } u)
                request.Headers.Add("X-Test-User", u.ToString());
            if (client is not null)
                request.Headers.Add("X-Schuly-Client", client);
            if (body is not null)
                request.Content = JsonContent.Create(body);
            return request;
        }

        public Task<HttpResponseMessage> Send(HttpMethod method, string url, Guid? user, object? body = null, string? client = null, string? ip = null) =>
            Client.SendAsync(Request(method, url, user, body, client, ip));

        public async Task<(HttpResponseMessage Response, JsonElement Json)> Json(HttpMethod method, string url, Guid? user, object? body = null, string? client = null)
        {
            var response = await Send(method, url, user, body, client);
            var text = await response.Content.ReadAsStringAsync();
            return (response, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone());
        }

        public async ValueTask DisposeAsync()
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
            Client.Dispose();
        }
    }
}
