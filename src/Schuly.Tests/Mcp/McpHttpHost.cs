using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using Mediator;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol.Client;
using Schuly.API.Mcp;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Mcp;

namespace Schuly.Tests.Mcp
{
    /// <summary>
    /// The MCP endpoint in process, wired exactly like Program.cs (authentication, the MCP guards, the rate limiter, authorization, the OAuth endpoints and /mcp),
    /// with a JWT bearer default scheme standing in for the Schuly sign-in and a mediator that answers the school queries with empty data.
    /// </summary>
    public sealed class McpHttpHost : IAsyncDisposable
    {
        public const string JwtKey = "test-signing-key-that-is-long-enough-for-hs256-0123456789";

        private readonly WebApplication _app;

        public HttpClient Http { get; }
        public IServiceProvider Services => _app.Services;

        private McpHttpHost(WebApplication app)
        {
            _app = app;
            Http = app.GetTestClient();
        }

        public static async Task<McpHttpHost> StartAsync(string databaseName, Action<IServiceCollection>? configureServices = null, Action<WebApplication>? mapPlugins = null)
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Mcp:PublicUrl"] = "http://localhost" });

            builder.Services.AddDbContext<SchulyDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddHttpClient();
            builder.Services.AddScoped<IMediator, EmptyMediator>();
            builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
            {
                o.MapInboundClaims = false;
                o.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = false, ValidateAudience = false, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey)) };
            });
            builder.Services.AddAuthorization(o => o.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
            builder.Services.AddSchulyMcp(builder.Configuration);
            configureServices?.Invoke(builder.Services);

            var app = builder.Build();
            app.UseAuthentication();
            app.UseSchulyMcpGuards();
            app.UseRateLimiter();
            app.UseAuthorization();
            app.MapGet("/api/ping", (HttpContext c) => c.User.FindFirst("sub")?.Value ?? "none");
            app.MapSchulyOAuthEndpoints();
            app.MapSchulyMcp();
            if (mapPlugins is not null)
            {
                mapPlugins(app);
                Schuly.API.Mcp.InProcessPluginApi.Build(app);
            }
            await app.StartAsync();
            return new McpHttpHost(app);
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

        /// <summary>The official SDK client over the in-process server, as Helply would use it.</summary>
        public async Task<McpClient> ConnectAsync(string? bearer)
        {
            var headers = new Dictionary<string, string>();
            if (bearer is not null)
                headers["Authorization"] = "Bearer " + bearer;
            var transport = new HttpClientTransport(new HttpClientTransportOptions { Endpoint = new Uri(Http.BaseAddress!, "/mcp"), TransportMode = HttpTransportMode.StreamableHttp, AdditionalHeaders = headers }, Http, ownsHttpClient: false);
            return await McpClient.CreateAsync(transport);
        }

        public HttpRequestMessage Post(string path, string json, string? bearer = null)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
            if (bearer is not null)
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            return request;
        }

        /// <summary>A valid Schuly sign-in JWT, the kind /api accepts.</summary>
        public static string WebToken(string sub)
        {
            var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey)), SecurityAlgorithms.HmacSha256);
            var token = new JwtSecurityToken(claims: [new Claim("sub", sub)], expires: DateTime.UtcNow.AddMinutes(10), signingCredentials: credentials);
            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        public async Task<string> ApiKeyAsync(Guid userId, McpPermissionSet permissions) =>
            await ScopedAsync(async sp => (await sp.GetRequiredService<McpApiKeyService>().CreateAsync(userId, "test", permissions, null)).Key!.Secret);

        public async ValueTask DisposeAsync()
        {
            Http.Dispose();
            await _app.DisposeAsync();
        }
    }

    /// <summary>Answers every school query with an empty list, so tools run end to end without a database of school data.</summary>
    public sealed class EmptyMediator : IMediator
    {
        private static TResponse Empty<TResponse>()
        {
            var type = typeof(TResponse);
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Result<>))
            {
                var inner = type.GetGenericArguments()[0];
                object value = inner == typeof(ApplicationUserDto) ? new ApplicationUserDto { ExternalId = "x", Email = "student@schuly.test", DisplayName = "Student" } : Activator.CreateInstance(inner)!;
                return (TResponse)type.GetMethod("Success")!.Invoke(null, [value])!;
            }
            throw new NotSupportedException(type.Name);
        }

        public ValueTask<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default) => new(Empty<TResponse>());
        public ValueTask<TResponse> Send<TResponse>(ICommand<TResponse> command, CancellationToken cancellationToken = default) => new(Empty<TResponse>());
        public ValueTask<TResponse> Send<TResponse>(IQuery<TResponse> query, CancellationToken cancellationToken = default) => new(Empty<TResponse>());
        public ValueTask<object?> Send(object message, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamQuery<TResponse> query, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamCommand<TResponse> command, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object message, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask Publish<TNotification>(TNotification notification, CancellationToken cancellationToken = default) where TNotification : INotification => ValueTask.CompletedTask;
        public ValueTask Publish(object notification, CancellationToken cancellationToken = default) => ValueTask.CompletedTask;
    }
}
