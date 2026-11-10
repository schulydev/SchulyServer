using Schuly.API.SignUp;
using Mediator;
using Schuly.API.Extensions;
using Schuly.API.Helply;
using Schuly.API.Mcp;
using Schuly.API.Plugins;
using Schuly.API.Services;
using Schuly.Application.Behaviors;
using Schuly.Infrastructure.Plugins;
using Schuly.Infrastructure.Security;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;
using Schuly.Infrastructure.Vault;
using Schuly.Plugin.Abstractions;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);

var mvcBuilder = builder.Services.AddSchulyControllers();

builder.Services.AddSchulyOpenApi(builder.Configuration);
builder.Services.AddMediator(options => { options.ServiceLifetime = ServiceLifetime.Scoped; });
builder.Services.AddScoped(typeof(IPipelineBehavior<,>), typeof(AuthorizationBehavior<,>));
builder.Services.AddScoped(typeof(IPipelineBehavior<,>), typeof(NotificationOriginBehavior<,>));
builder.Services.AddScoped(typeof(IPipelineBehavior<,>), typeof(PluginEventBehavior<,>));
builder.Services.AddSchulyDatabase(builder.Configuration);
builder.Services.AddSchulyPushNotifications(builder.Configuration);

builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient(SchoolLogoProxy.ClientName, client => client.Timeout = TimeSpan.FromSeconds(5)).ConfigurePrimaryHttpMessageHandler(SchoolLogoProxy.Handler).RemoveAllLoggers();
builder.Services.AddSingleton<SchoolLogoProxy>();
builder.Services.AddHttpContextAccessor();

builder.Services.AddScoped<IOidcService, OidcService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddSingleton<IAvatarUrlSigner, AvatarUrlSigner>();
builder.Services.AddScoped<AccountPictureUrls>();
builder.Services.AddScoped<IPluginUserContext, PluginUserContext>();
builder.Services.AddScoped<IPluginUserDataPurger, Schuly.API.Plugins.PluginUserDataPurger>();
builder.Services.AddScoped<AccountPurger>();
builder.Services.AddScoped<IAccountPurger, AuditedAccountPurger>();
builder.Services.AddScoped<ILinkedAccounts>(sp => new LinkedAccountStore(sp.GetRequiredService<Schuly.Infrastructure.SchulyDbContext>(), sp.GetRequiredService<IPluginVaultFactory>(), sp.GetRequiredService<IDocumentStorage>()));
builder.Services.AddSchulyDocumentStorage(builder.Configuration, builder.Environment.IsDevelopment());

builder.Services.Configure<RetentionOptions>(builder.Configuration.GetSection(RetentionOptions.SectionName));
builder.Services.AddScoped<RetentionSweeper>();
builder.Services.AddSingleton<IInactivityWarningSender, Schuly.API.Email.SmtpInactivityWarningSender>();
builder.Services.AddHostedService<RetentionHostedService>();

builder.Services.AddSchulyVault(builder.Configuration, builder.Environment.IsDevelopment());
builder.Services.AddSingleton<PluginTaskScheduler>();
builder.Services.AddSingleton<IPluginTaskScheduler>(sp => sp.GetRequiredService<PluginTaskScheduler>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<PluginTaskScheduler>());
builder.Services.AddSchulyPlugins(builder.Configuration, mvcBuilder);
builder.Services.AddSchulyLinking();

builder.Services.AddSchulyAuthentication(builder.Configuration);
builder.Services.AddSchulyAuthorization(builder.Configuration);
builder.Services.AddSchulyMcp(builder.Configuration);
builder.Services.AddSchulyHelply(builder.Configuration, builder.Environment.IsDevelopment());
builder.Services.AddSchulyExceptionHandling();
builder.Services.AddSchulyForwardedHeaders(builder.Configuration);
builder.Services.AddSchulyRateLimiting();
builder.Services.AddSchulyResponseCompression();

if (builder.Environment.IsDevelopment())
    builder.Services.AddSchulyRequestLogging();

var app = builder.Build();

app.ApplyMigrations();
app.Services.RotateVaultKey();
await app.EncryptSensitiveTextAsync();
await app.SeedSchoolSystemsAsync();

app.UseForwardedHeaders();
app.UseMiddleware<SecurityHeaders>();

app.UseExceptionHandler();

app.UseMiddleware<Schuly.API.AppVersion.AppVersionGate>();

if (app.Configuration.SwitzerlandOnly())
    app.UseMiddleware<SwissSignUpGate>();

app.UseSchulyResponseCompression();
app.UseDefaultFiles();
app.UseStaticFiles(StaticAssetCaching.Options);

if (app.Environment.IsDevelopment())
{
    app.UseHttpLogging();
    app.MapSchulyApiReference();
}

app.UseSchulyMcpCors();
app.UseMiddleware<WebTokenCookies>();
app.UseAuthentication();
app.UseSchulyMcpGuards();
// Partitions on the authenticated "sub" claim, so it has to run after authentication.
app.UseRateLimiter();
app.UseAuthorization();
app.UseMiddleware<PluginScopeMiddleware>();
app.MapSchulyAuthEndpoints();
app.MapControllers();
app.MapSchulyOAuthEndpoints();
app.MapSchulyMcp();
app.MapFallbackToFile("{*path:nonfile:regex(^(?!api/|auth/|openapi/|scalar|oauth/|mcp(/|$)|[.]well-known/).*$)}", "index.html", StaticAssetCaching.Options).AllowAnonymous();
await app.UseSchulyPluginsAsync();
// Built last, so its routing sees every endpoint, plugin ones included.
InProcessPluginApi.Build(app);

app.Run();
