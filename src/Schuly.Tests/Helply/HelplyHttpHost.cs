using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Mediator;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Schuly.API.Controllers;
using Schuly.API.Extensions;
using Schuly.API.Helply;
using Schuly.API.Mcp;
using Schuly.Application.Models;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Vault;
using Schuly.Tests.Mcp;

namespace Schuly.Tests.Helply
{
    /// <summary>Collects every log line (category, level, message and the full exception text), so a test can prove a secret never reached any log.</summary>
    public sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly ConcurrentQueue<string> _lines = new();

        public IReadOnlyList<string> Lines => _lines.ToList();

        public string All => string.Join("\n", _lines);

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _lines);

        public void Dispose()
        {
        }

        private sealed class CapturingLogger(string category, ConcurrentQueue<string> lines) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                lines.Enqueue($"{category} [{logLevel}] {formatter(state, exception)} {exception}");
        }
    }

    /// <summary>The signed-in user of a test request: the JWT's sub is the application user's external id.</summary>
    public sealed class TestUserService(IHttpContextAccessor accessor, SchulyDbContext db) : IUserService
    {
        public async Task<Guid> GetCurrentUserIdAsync(CancellationToken cancellationToken = default)
        {
            var sub = accessor.HttpContext?.User.FindFirst("sub")?.Value ?? throw new UnauthorizedAccessException();
            return (await db.ApplicationUsers.SingleAsync(u => u.ExternalId == sub, cancellationToken)).Id;
        }

        public Task SyncCurrentUserAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<bool> ExistsAsync(string externalId, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task TouchLastSeenAsync(string externalId, string? verifiedEmail, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<IReadOnlyList<Guid>> GetCurrentUserSchoolUserIdsAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Guid>>([]);
    }

    /// <summary>Every message that reached the mediator, by type name. A tool that ran shows up here, which is how a test tells "approved and executed" from "waiting".</summary>
    public sealed class MediatorCalls
    {
        /// <summary>The linked accounts the mediator reports for the signed-in user (the real handler needs the web sign-in, which the MCP token does not carry).</summary>
        public List<Schuly.Application.Dtos.LinkedAccountDto> LinkedAccounts { get; } = [];

        private readonly ConcurrentQueue<string> _names = new();

        public void Add(string name) => _names.Enqueue(name);

        public int Count(string name) => _names.Count(n => n == name);

        public IReadOnlyList<string> All => _names.ToList();
    }

    /// <summary>Stands in for the in-process plugin pipeline: answers the Microsoft and Schulnetz paths from canned JSON and records every call (method, path and body), so a test can tell a lookup from a write.</summary>
    public static class FakePluginApi
    {
        public const string SchulnetzAccount = "7c9d1a52-3f0e-4b8a-9d2e-5a6b7c8d9e01";

        private static readonly ConcurrentDictionary<string, string> Responses = new();
        private static readonly ConcurrentQueue<string> Log = new();
        private static int _installed;

        public static IReadOnlyList<string> Calls => Log.ToList();

        public static void Answer(string method, string path, string json) => Responses[method + " " + path] = json;

        public static void Install()
        {
            if (Interlocked.Exchange(ref _installed, 1) == 1)
                return;
            Answer("GET", "/api/plugins/schulware/accounts", $"[{{\"id\":\"{SchulnetzAccount}\"}}]");
            RequestDelegate pipeline = async context =>
            {
                var request = context.Request;
                var body = request.Body.CanRead ? await new StreamReader(request.Body).ReadToEndAsync() : string.Empty;
                Log.Enqueue($"{request.Method} {request.Path.Value}{request.QueryString} {body}");
                var key = request.Method + " " + request.Path.Value;
                if (Responses.TryGetValue(key, out var json) || (request.Method != "GET" && Responses.TryGetValue("ANY " + request.Path.Value, out json)))
                {
                    context.Response.StatusCode = 200;
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(json);
                    return;
                }
                context.Response.StatusCode = request.Method == "GET" ? 404 : 200;
                if (request.Method != "GET")
                {
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync("{}");
                }
            };
            typeof(Schuly.API.Mcp.InProcessPluginApi).GetField("_pipeline", BindingFlags.NonPublic | BindingFlags.Static)!.SetValue(null, pipeline);
        }
    }

    /// <summary>Runs the Helply handlers for real and answers every school query the MCP tools make with empty data.</summary>
    public sealed class HelplyTestMediator(IServiceProvider services, MediatorCalls calls) : IMediator
    {
        private readonly EmptyMediator _empty = new();

        private async ValueTask<TResponse> Dispatch<TResponse>(object message, Type handlerInterface, Func<ValueTask<TResponse>> fallback, CancellationToken ct)
        {
            calls.Add(message.GetType().Name);
            var handlerType = handlerInterface.MakeGenericType(message.GetType(), typeof(TResponse));
            if (services.GetService(handlerType) is not { } handler)
                return await fallback();
            return await (ValueTask<TResponse>)handlerType.GetMethod("Handle")!.Invoke(handler, [message, ct])!;
        }

        public ValueTask<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default) => _empty.Send(request, cancellationToken);

        public ValueTask<TResponse> Send<TResponse>(ICommand<TResponse> command, CancellationToken cancellationToken = default) => Dispatch(command, typeof(ICommandHandler<,>), () => _empty.Send(command, cancellationToken), cancellationToken);

        public ValueTask<TResponse> Send<TResponse>(IQuery<TResponse> query, CancellationToken cancellationToken = default) => query is Schuly.Application.Queries.LinkedAccount.GetMyLinkedAccountsQuery linked && calls.LinkedAccounts.Count > 0 ? Linked<TResponse>(linked) : Dispatch(query, typeof(IQueryHandler<,>), () => _empty.Send(query, cancellationToken), cancellationToken);

        private ValueTask<TResponse> Linked<TResponse>(Schuly.Application.Queries.LinkedAccount.GetMyLinkedAccountsQuery query)
        {
            calls.Add(query.GetType().Name);
            var accounts = calls.LinkedAccounts.Where(a => query.Provider is null || a.Provider == query.Provider).ToList();
            return new ValueTask<TResponse>((TResponse)(object)Schuly.Application.Models.Result<List<Schuly.Application.Dtos.LinkedAccountDto>>.Success(accounts));
        }

        public ValueTask<object?> Send(object message, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamQuery<TResponse> query, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamCommand<TResponse> command, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public IAsyncEnumerable<object?> CreateStream(object message, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public ValueTask Publish<TNotification>(TNotification notification, CancellationToken cancellationToken = default) where TNotification : INotification => ValueTask.CompletedTask;

        public ValueTask Publish(object notification, CancellationToken cancellationToken = default) => ValueTask.CompletedTask;
    }

    public sealed record SseEvent(string Name, string Data)
    {
        public JsonElement Json => JsonDocument.Parse(Data).RootElement.Clone();
    }

    public sealed record SseResult(int Status, HttpResponseMessage Response, string Body, List<SseEvent> Events)
    {
        public IEnumerable<SseEvent> Named(string name) => Events.Where(e => e.Name == name);

        public IReadOnlyList<string> Names => Events.Select(e => e.Name).ToList();

        public string Text => string.Concat(Named("delta").Select(e => e.Json.GetProperty("text").GetString()));
    }

    /// <summary>
    /// The Helply API in process: the real controller, MCP server, internal-token path and chat service on a TestServer, an in-memory database, the mock gateway as the
    /// "Helply.Gateway" client's transport and the server itself as the "Helply.Mcp" client's transport, with every log line captured.
    /// </summary>
    public sealed class HelplyHttpHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        public HttpClient Http { get; }
        public MockGatewayHandler Gateway { get; }
        public CapturingLoggerProvider Logs { get; }
        public MutableTimeProvider Time { get; }
        public MediatorCalls Calls { get; }
        public IServiceProvider Services => _app.Services;

        private HelplyHttpHost(WebApplication app, MockGatewayHandler gateway, CapturingLoggerProvider logs, MutableTimeProvider time, MediatorCalls calls)
        {
            Calls = calls;
            _app = app;
            Gateway = gateway;
            Logs = logs;
            Time = time;
            Http = app.GetTestClient();
        }

        public static async Task<HelplyHttpHost> StartAsync(string databaseName, bool enabled = true, Dictionary<string, string?>? settings = null, Action<IServiceCollection>? configure = null, bool behindProxy = false)
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            var configuration = new Dictionary<string, string?> { ["Mcp:PublicUrl"] = "http://localhost" };
            if (enabled)
            {
                configuration["Helply:BaseUrl"] = MockGatewayHandler.BaseUrl;
                configuration["Helply:ApiKey"] = MockGatewayHandler.ApiKey;
            }
            foreach (var (key, value) in settings ?? [])
                configuration[key] = value;
            builder.Configuration.AddInMemoryCollection(configuration);

            var logs = new CapturingLoggerProvider();
            builder.Logging.ClearProviders();
            builder.Logging.SetMinimumLevel(LogLevel.Trace);
            builder.Logging.AddProvider(logs);

            FakePluginApi.Install();
            var gateway = new MockGatewayHandler();
            var time = new MutableTimeProvider(DateTimeOffset.UtcNow);
            var calls = new MediatorCalls();
            builder.Services.AddSingleton(calls);

            builder.Services.AddDbContext<SchulyDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddHttpClient();
            builder.Services.AddSingleton(VaultKeyring.Ephemeral());
            builder.Services.AddScoped<IUserService, TestUserService>();
            builder.Services.AddScoped<IMediator, HelplyTestMediator>();
            foreach (var handler in typeof(Schuly.Application.Commands.Helply.CreateHelplyConversationCommand).Assembly.GetTypes().Where(t => t is { IsClass: true, IsAbstract: false } && t.Namespace?.EndsWith(".Helply") == true))
                foreach (var contract in handler.GetInterfaces().Where(i => i.IsGenericType && i.GetGenericTypeDefinition() is var d && (d == typeof(ICommandHandler<,>) || d == typeof(IQueryHandler<,>))))
                    builder.Services.AddScoped(contract, handler);
            builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
            {
                o.MapInboundClaims = false;
                o.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = false, ValidateAudience = false, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(McpHttpHost.JwtKey)) };
            });
            builder.Services.AddAuthorization(o => o.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
            builder.Services.AddSchulyMcp(builder.Configuration);
            builder.Services.AddSchulyHelply(builder.Configuration);
            builder.Services.AddSingleton<TimeProvider>(time);
            configure?.Invoke(builder.Services);
            if (behindProxy)
                builder.Services.AddSchulyForwardedHeaders(builder.Configuration);

            builder.Services.AddHttpClient(HelplyGateway.ClientName).ConfigurePrimaryHttpMessageHandler(() => gateway);
            builder.Services.AddHttpClient(HelplyMcpConnector.ClientName).ConfigurePrimaryHttpMessageHandler(sp => ((TestServer)sp.GetRequiredService<IServer>()).CreateHandler());

            builder.Services.AddSchulyControllers()
                .AddApplicationPart(typeof(HelplyController).Assembly)
                .ConfigureApplicationPartManager(m => m.FeatureProviders.Add(new OnlyHelplyController()));

            var app = builder.Build();
            if (behindProxy)
            {
                // Kestrel reports loopback for Helply's own MCP calls; the test server reports no address at all.
                app.Use((context, next) =>
                {
                    context.Connection.RemoteIpAddress ??= System.Net.IPAddress.Loopback;
                    return next(context);
                });
                app.UseForwardedHeaders();
            }
            app.UseAuthentication();
            app.UseSchulyMcpGuards();
            app.UseRateLimiter();
            app.UseAuthorization();
            app.MapControllers();
            app.MapSchulyOAuthEndpoints();
            app.MapSchulyMcp();
            await app.StartAsync();
            if (behindProxy)
            {
                // Like production: the server listens on plain http, so Helply's MCP client goes to http://127.0.0.1 with the public host in the Host header.
                var server = (TestServer)app.Services.GetRequiredService<IServer>();
                var addresses = new Microsoft.AspNetCore.Hosting.Server.Features.ServerAddressesFeature();
                addresses.Addresses.Add("http://0.0.0.0:8080");
                server.Features.Set<Microsoft.AspNetCore.Hosting.Server.Features.IServerAddressesFeature>(addresses);
            }
            var host = new HelplyHttpHost(app, gateway, logs, time, calls);
            if (behindProxy)
                host.Http.BaseAddress = new Uri("https://app.schuly.test");
            return host;
        }

        private sealed class OnlyHelplyController : IApplicationFeatureProvider<ControllerFeature>
        {
            public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
            {
                foreach (var other in feature.Controllers.Where(c => c != typeof(HelplyController).GetTypeInfo()).ToList())
                    feature.Controllers.Remove(other);
            }
        }

        public T Scoped<T>(Func<IServiceProvider, T> use)
        {
            using var scope = _app.Services.CreateScope();
            return use(scope.ServiceProvider);
        }

        public async Task<T> ScopedAsync<T>(Func<IServiceProvider, Task<T>> use)
        {
            await using var scope = _app.Services.CreateAsyncScope();
            return await use(scope.ServiceProvider);
        }

        /// <summary>Links a Microsoft account to the user, in the database (for the risk check) and in what the MCP tools see.</summary>
        public Guid LinkMicrosoft(Guid userId, string email)
        {
            var id = Guid.NewGuid();
            Scoped(sp =>
            {
                var db = sp.GetRequiredService<SchulyDbContext>();
                db.LinkedAccounts.Add(new Schuly.Domain.LinkedAccount { Id = id, ApplicationUserId = userId, Provider = Schuly.Plugin.Abstractions.LinkedProviders.Microsoft, ExternalId = id.ToString("N"), Email = email });
                db.SaveChanges();
                return 0;
            });
            Calls.LinkedAccounts.Add(new Schuly.Application.Dtos.LinkedAccountDto { Id = id, Provider = Schuly.Plugin.Abstractions.LinkedProviders.Microsoft, Email = email });
            return id;
        }

        /// <summary>A new student with a Schuly sign-in token.</summary>
        public (Guid UserId, string Token) NewUser() => Scoped(sp =>
        {
            var (user, _) = McpTestSupport.NewUser(sp.GetRequiredService<SchulyDbContext>());
            return (user.Id, McpHttpHost.WebToken(user.ExternalId));
        });

        public HttpRequestMessage Request(HttpMethod method, string path, string token, object? body = null)
        {
            var request = new HttpRequestMessage(method, path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (body is not null)
                request.Content = new StringContent(body as string ?? JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            return request;
        }

        public async Task<(int Status, JsonElement Json, string Body)> CallAsync(HttpMethod method, string path, string token, object? body = null)
        {
            using var response = await Http.SendAsync(Request(method, path, token, body));
            var text = await response.Content.ReadAsStringAsync();
            return ((int)response.StatusCode, text.StartsWith('{') || text.StartsWith('[') ? JsonDocument.Parse(text).RootElement.Clone() : default, text);
        }

        public async Task<Guid> CreateConversationAsync(string token, string? title = null)
        {
            var (_, json, _) = await CallAsync(HttpMethod.Post, "/api/helply/conversations", token, title is null ? new { } : new { title });
            return json.GetProperty("id").GetGuid();
        }

        /// <summary>Posts a chat request and reads the whole event stream (or the plain problem response).</summary>
        public async Task<SseResult> StreamAsync(string token, string path, object? body = null)
        {
            var response = await Http.SendAsync(Request(HttpMethod.Post, path, token, body ?? new { }), HttpCompletionOption.ResponseHeadersRead);
            var text = await response.Content.ReadAsStringAsync();
            var events = new List<SseEvent>();
            if (response.Content.Headers.ContentType?.MediaType == "text/event-stream")
            {
                foreach (var block in text.Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
                {
                    var lines = block.Split('\n');
                    events.Add(new SseEvent(lines[0]["event: ".Length..], lines[1]["data: ".Length..]));
                }
            }
            return new SseResult((int)response.StatusCode, response, text, events);
        }

        public Task<SseResult> SendMessageAsync(string token, Guid conversationId, string text) => StreamAsync(token, $"/api/helply/conversations/{conversationId}/messages", new { text });

        public Task<SseResult> SendMessageAsync(string token, Guid conversationId, string text, params Guid[] attachmentIds) => StreamAsync(token, $"/api/helply/conversations/{conversationId}/messages", new { text, attachmentIds });

        /// <summary>Uploads a file as the browser would: multipart, field "file", with the given name and declared content type.</summary>
        public async Task<(int Status, JsonElement Json, string Body)> UploadAsync(string token, Guid conversationId, string fileName, string? contentType, byte[] data)
        {
            using var form = new MultipartFormDataContent();
            var part = new ByteArrayContent(data);
            if (contentType is not null)
                part.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            form.Add(part, "file", fileName);
            using var request = Request(HttpMethod.Post, $"/api/helply/conversations/{conversationId}/attachments", token);
            request.Content = form;
            using var response = await Http.SendAsync(request);
            var text = await response.Content.ReadAsStringAsync();
            return ((int)response.StatusCode, text.StartsWith('{') ? JsonDocument.Parse(text).RootElement.Clone() : default, text);
        }

        public async Task<Guid> UploadIdAsync(string token, Guid conversationId, string fileName, string? contentType, byte[] data)
        {
            var (status, json, body) = await UploadAsync(token, conversationId, fileName, contentType, data);
            if (status != 200)
                throw new InvalidOperationException($"Upload failed ({status}): {body}");
            return json.GetProperty("id").GetGuid();
        }

        public Task<SseResult> AnswerAsync(string token, Guid conversationId, params (string ApprovalId, bool Approved)[] decisions) =>
            StreamAsync(token, $"/api/helply/conversations/{conversationId}/approvals", new { decisions = decisions.Select(d => new { approvalId = d.ApprovalId, approved = d.Approved }).ToArray() });

        private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web) { Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };

        public async Task SetPermissionsAsync(string token, McpPermissionSet permissions) => await CallAsync(HttpMethod.Put, "/api/helply/settings/permissions", token, JsonSerializer.Serialize(permissions, WebJson));

        public async ValueTask DisposeAsync()
        {
            Http.Dispose();
            await _app.DisposeAsync();
        }
    }
}
