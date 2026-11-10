using System.Collections.Concurrent;
using System.Reflection;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Schuly.API.Linking;
using Schuly.Application.Abstractions;
using Schuly.Domain;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Plugins;
using Schuly.Infrastructure.Storage;
using Schuly.Infrastructure.Vault;
using Schuly.Plugin.Abstractions;
using Schuly.Plugin.Abstractions.Linking;

namespace Schuly.API.Plugins
{
    public sealed record LoadedPluginInfo(string Name, string Version);

    public sealed class PluginHost(IServiceProvider rootProvider, IConfiguration configuration, ApplicationPartManager partManager, PluginEndpointDataSource endpointSource, PluginAssemblyMap assemblyMap, IPluginTaskScheduler scheduler, ILogger<PluginHost> logger) : IPluginEventDispatcher, IPluginTaskRunner, ILinkProviderCatalog
    {
        private readonly ConcurrentDictionary<string, LoadedPlugin> _loaded = new(StringComparer.OrdinalIgnoreCase);
        private readonly SemaphoreSlim _gate = new(1, 1);

        public IServiceProvider? GetProvider(string pluginName) =>
            _loaded.TryGetValue(pluginName, out var p) ? p.Provider : null;

        public IReadOnlyList<LoadedPluginInfo> List() =>
            _loaded.Values.Select(p => new LoadedPluginInfo(p.Name, p.Version)).ToList();

        public IReadOnlyList<ISchulyPlugin> Instances() =>
            _loaded.Values.Select(p => p.Instance).ToList();

        public IReadOnlyList<LinkProviderEntry> Providers =>
            _loaded.Values.SelectMany(p => p.LinkProviders).OrderBy(e => e.Descriptor.SortOrder).ThenBy(e => e.Descriptor.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();

        public LinkProviderEntry? Find(string providerId) =>
            _loaded.Values.SelectMany(p => p.LinkProviders).FirstOrDefault(e => e.Descriptor.Id == providerId);

        public ILinkProviderLease? Open(string providerId)
        {
            var owner = _loaded.Values.FirstOrDefault(p => p.LinkProviders.Any(e => e.Descriptor.Id == providerId));
            if (owner is null)
                return null;

            var scope = owner.Provider.CreateScope();
            var provider = scope.ServiceProvider.GetServices<ILinkProvider>().FirstOrDefault(p => p.Descriptor.Id == providerId);
            if (provider is null)
            {
                scope.Dispose();
                return null;
            }

            return new LinkProviderLease(scope, provider);
        }

        /// <summary>Reads each plugin's ILinkProvider descriptors once at load; invalid or duplicate ones are logged and skipped.</summary>
        private List<LinkProviderEntry> DiscoverLinkProviders(string pluginName, IServiceProvider pluginProvider)
        {
            var entries = new List<LinkProviderEntry>();
            try
            {
                using var scope = pluginProvider.CreateScope();
                foreach (var linkProvider in scope.ServiceProvider.GetServices<ILinkProvider>())
                {
                    try
                    {
                        var descriptor = linkProvider.Descriptor;
                        var validation = LinkDescriptorValidator.ValidateDescriptor(descriptor);
                        if (!validation.IsValid)
                        {
                            logger.LogWarning("Plugin {Name} declares an invalid link provider and it is skipped: {Errors}", pluginName, string.Join(" ", validation.Errors));
                            continue;
                        }

                        if (entries.Any(e => e.Descriptor.Id == descriptor.Id) || _loaded.Values.Any(p => p.Name != pluginName && p.LinkProviders.Any(e => e.Descriptor.Id == descriptor.Id)))
                        {
                            logger.LogWarning("Plugin {Name} declares link provider {Id} which already exists; skipped", pluginName, descriptor.Id);
                            continue;
                        }

                        var svg = SvgSanitizer.Sanitize(descriptor.Icon.Svg);
                        if (descriptor.Icon.Svg is not null && svg is null)
                            logger.LogWarning("Link provider {Id} has an icon that was rejected by the SVG sanitizer", descriptor.Id);

                        entries.Add(new LinkProviderEntry(descriptor, svg, svg is null ? null : SvgSanitizer.Version(svg)));
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning("Plugin {Name} has a link provider that could not be read ({ExceptionType}); skipped", pluginName, ex.GetType().Name);
                    }
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning("Plugin {Name} link providers could not be discovered ({ExceptionType})", pluginName, ex.GetType().Name);
            }

            return entries;
        }

        public bool IsLoaded(string name) => _loaded.ContainsKey(name);

        public async Task<PluginLoginResult?> ConnectAsync(string systemKey, IReadOnlyDictionary<string, string> fields, string? displayName, CancellationToken ct = default)
        {
            foreach (var loaded in _loaded.Values)
            {
                using var scope = loaded.Provider.CreateScope();
                var login = scope.ServiceProvider.GetServices<IPluginLogin>()
                    .FirstOrDefault(l => string.Equals(l.SystemKey, systemKey, StringComparison.OrdinalIgnoreCase));
                if (login is null)
                    continue;

                return await login.ConnectAsync(fields, displayName, ct);
            }

            return null;
        }

        public Task DispatchAsync<TEvent>(TEvent message, CancellationToken cancellationToken = default) where TEvent : notnull =>
            DispatchReportingFailuresAsync(message, null, cancellationToken);

        /// <summary>Dispatches to every plugin, or only to <paramref name="pluginSource"/>. A failed handler doesn't stop the others; the sources of the plugins with a failure are returned.</summary>
        public async Task<IReadOnlyList<string>> DispatchReportingFailuresAsync<TEvent>(TEvent message, string? pluginSource, CancellationToken cancellationToken) where TEvent : notnull
        {
            var failed = new List<string>();

            foreach (var loaded in _loaded.Values.Where(p => pluginSource is null || PluginSource(p.Instance) == pluginSource))
            {
                try
                {
                    using var scope = loaded.Provider.CreateScope();
                    foreach (var handler in scope.ServiceProvider.GetServices<IPluginEventHandler<TEvent>>())
                    {
                        try
                        {
                            await handler.HandleAsync(message, cancellationToken);
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                        {
                            failed.Add(PluginSource(loaded.Instance));
                            logger.LogError("Plugin event handler {Handler} failed for {Event} ({ExceptionType})", handler.GetType().Name, typeof(TEvent).Name, ex.GetType().Name);
                        }
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    failed.Add(PluginSource(loaded.Instance));
                    logger.LogError("Plugin {Name} failed to dispatch {Event} ({ExceptionType})", loaded.Name, typeof(TEvent).Name, ex.GetType().Name);
                }
            }

            return failed.Distinct().ToList();
        }

        /// <summary>The application user ids the loaded plugins hold data for. A plugin database that can't be read is logged and skipped; it is read again on the next sweep.</summary>
        public async Task<IReadOnlyCollection<Guid>> ListDataOwnersAsync(CancellationToken cancellationToken)
        {
            var owners = new HashSet<Guid>();
            foreach (var loaded in _loaded.Values)
            {
                try
                {
                    var connectionString = PluginConnectionString(loaded.Name);
                    var database = new NpgsqlConnectionStringBuilder(connectionString).Database!;
                    var main = configuration.GetConnectionString("SchulyDatabase")!;
                    if (await PluginDataOwners.DatabaseExistsAsync(main, database, cancellationToken))
                        owners.UnionWith(await PluginDataOwners.ReadAsync(connectionString, cancellationToken));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError("Could not read the database of plugin {Name} to find orphaned data ({ExceptionType})", loaded.Name, ex.GetType().Name);
                }
            }

            return owners;
        }

        private async Task SyncSchoolSystemsAsync(LoadedPlugin loaded, CancellationToken ct)
        {
            using var pluginScope = loaded.Provider.CreateScope();
            var descriptors = pluginScope.ServiceProvider.GetServices<IPluginLogin>()
                .Select(l => l.SchoolSystem)
                .Where(d => d is not null && !string.IsNullOrWhiteSpace(d.Key))
                .DistinctBy(d => d.Key, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (descriptors.Count == 0)
                return;

            using var hostScope = rootProvider.CreateScope();
            var db = hostScope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            var existing = await db.SchoolSystems.ToDictionaryAsync(s => s.Key, ct);

            // Name, logo, enabled and order stay as seeded or edited in the database; how to log in follows the plugin.
            var added = 0;
            foreach (var d in descriptors)
            {
                if (!existing.TryGetValue(d.Key, out var system))
                {
                    system = new SchoolSystem
                    {
                        Key = d.Key,
                        DisplayName = d.DisplayName,
                        LoginMethod = d.LoginMethod,
                        LogoUrl = d.LogoUrl,
                        Enabled = d.Enabled,
                        SortOrder = d.SortOrder,
                    };
                    db.SchoolSystems.Add(system);
                    added++;
                }

                system.Source = PluginSource(loaded.Instance);
                system.LoginMethod = d.LoginMethod;
                system.PrivateAuthStrategy = d.PrivateAuthStrategy;
                system.StatelessBasePath = d.StatelessBasePath;
                system.PluginBasePath = d.PluginBasePath;
                system.LoginMethodPath = d.LoginMethodPath;
                system.LoginFields = d.LoginFields.Select(f => new SchoolSystemLoginField
                {
                    Key = f.Key,
                    Label = f.Label,
                    Type = f.Type,
                    Placeholder = f.Placeholder,
                    DefaultValue = f.DefaultValue,
                    Required = f.Required,
                    ReplacedByLinkedAccount = f.ReplacedByLinkedAccount,
                    Suggestions = f.Suggestions.Select(s => new SchoolSystemLoginFieldSuggestion { Label = s.Label, Value = s.Value }).ToList(),
                }).ToList();
            }

            await db.SaveChangesAsync(ct);
            if (added > 0)
                logger.LogInformation("Seeded {Count} school system(s) from plugin {Name}", added, loaded.Name);
        }

        public async Task LoadAsync(PluginManifest manifest, string pluginDirectory, CancellationToken ct = default)
        {
            await _gate.WaitAsync(ct);
            try
            {
                var dllPath = Path.Combine(pluginDirectory, manifest.Dll);
                var alc = new PluginLoadContext(manifest.Name, pluginDirectory);
                // Load the main assembly from a byte copy so the DLL file isn't locked —
                // lets update/remove replace it while the old context is still unloading.
                var assembly = alc.LoadFromStream(new MemoryStream(await File.ReadAllBytesAsync(dllPath, ct)));

                if (PluginContract.Incompatibility(assembly.GetReferencedAssemblies(), PluginContract.HostVersion) is { } reason)
                {
                    alc.Unload();
                    throw new InvalidOperationException($"Plugin {manifest.Name} can't be loaded: {reason}");
                }

                var pluginType = assembly.GetTypes()
                    .FirstOrDefault(t => typeof(ISchulyPlugin).IsAssignableFrom(t) && t is { IsAbstract: false, IsInterface: false });
                if (pluginType is null || Activator.CreateInstance(pluginType) is not ISchulyPlugin plugin)
                {
                    alc.Unload();
                    throw new InvalidOperationException($"No ISchulyPlugin found in {manifest.Dll}");
                }

                ServiceProvider? provider = null;
                AssemblyPart? part = null;
                LoadedPlugin? loaded = null;
                try
                {
                    var (builtProvider, pluginConfiguration) = BuildChildProvider(plugin);
                    provider = builtProvider;
                    await plugin.MigrateAsync(provider, ct);

                    var endpoints = PluginEndpointDataSource.Build(plugin.Name, rootProvider, plugin.ConfigureEndpoints);

                    part = new AssemblyPart(assembly);
                    partManager.ApplicationParts.Add(part);
                    assemblyMap.Add(assembly, plugin.Name);

                    loaded = new LoadedPlugin
                    {
                        Name = plugin.Name,
                        Version = plugin.Version,
                        Instance = plugin,
                        LoadContext = alc,
                        Assembly = assembly,
                        Provider = provider,
                        Configuration = pluginConfiguration,
                        Part = part,
                        Endpoints = endpoints,
                        TaskCts = new CancellationTokenSource(),
                        LinkProviders = DiscoverLinkProviders(plugin.Name, provider),
                    };
                    _loaded[plugin.Name] = loaded;

                    RefreshEndpoints();
                    PluginActionDescriptorChangeProvider.Instance.NotifyChanged();
                    await SyncBackgroundTasksAsync(loaded, ct);
                    await SyncSchoolSystemsAsync(loaded, ct);

                    logger.LogInformation("Loaded plugin {Name} v{Version}", plugin.Name, plugin.Version);
                }
                catch
                {
                    // A partial load must not leak the collectible ALC or the child provider
                    // (and its DbContext/HttpClient) — undo exactly what was already created,
                    // in reverse order, before letting the caller see the failure.
                    loaded?.TaskCts?.Cancel();
                    loaded?.TaskCts?.Dispose();
                    _loaded.TryRemove(plugin.Name, out _);
                    if (part is not null)
                    {
                        partManager.ApplicationParts.Remove(part);
                        assemblyMap.Remove(assembly);
                    }
                    PluginActionDescriptorChangeProvider.Instance.NotifyChanged();
                    RefreshEndpoints();
                    if (loaded is not null)
                        await scheduler.RemoveAsync(plugin.Name, CancellationToken.None);
                    if (provider is not null)
                        await provider.DisposeAsync();
                    alc.Unload();
                    throw;
                }
            }
            finally
            {
                _gate.Release();
            }
        }

        public async Task UnloadAsync(string name, CancellationToken ct = default)
        {
            await _gate.WaitAsync(ct);
            try
            {
                if (!_loaded.TryRemove(name, out var plugin))
                    return;

                await scheduler.RemoveAsync(name, ct);
                plugin.TaskCts.Cancel();

                partManager.ApplicationParts.Remove(plugin.Part);
                assemblyMap.Remove(plugin.Assembly);
                PluginActionDescriptorChangeProvider.Instance.NotifyChanged();
                RefreshEndpoints();

                await WaitForInFlightRunsAsync(plugin);

                if (plugin.Instance is IAsyncDisposable instanceAsync)
                    await instanceAsync.DisposeAsync();
                else if (plugin.Instance is IDisposable instanceSync)
                    instanceSync.Dispose();

                await plugin.Provider.DisposeAsync();

                plugin.TaskCts.Dispose();
                plugin.LoadContext.Unload();

                for (var i = 0; i < 2; i++)
                {
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                }

                logger.LogInformation("Unloaded plugin {Name}", name);
            }
            finally
            {
                _gate.Release();
            }
        }

        private (ServiceProvider Provider, IConfiguration Configuration) BuildChildProvider(ISchulyPlugin plugin)
        {
            var services = new ServiceCollection();

            services.AddSingleton(rootProvider.GetRequiredService<ILoggerFactory>());
            services.AddSingleton(typeof(ILogger<>), typeof(Logger<>));
            services.AddSingleton(rootProvider.GetRequiredService<IHttpClientFactory>());
            services.AddSingleton(rootProvider.GetRequiredService<IHttpContextAccessor>());
            services.AddSingleton(rootProvider.GetRequiredService<IPluginVaultFactory>());

            // The current request's user context, resolved lazily from the active
            // request scope so plugin code sees the real caller. Deferred (not resolved
            // at construction) so plugin services can also be built outside a request —
            // e.g. when the host reads a plugin's catalog descriptor at load time.
            services.AddScoped<IPluginUserContext>(_ => new DeferredPluginUserContext(rootProvider));

            services.AddSingleton<IPluginVault>(sp =>
                sp.GetRequiredService<IPluginVaultFactory>().GetVault($"plugin:{plugin.Name}"));

            // Plugins reach the main database and blob storage only through the contract
            // services below. The host-owned ones behind them are scoped, so each plugin
            // scope gets its own host scope to resolve them from, disposed with the plugin
            // scope; this works in both request (login) and background-task (sync) scopes.
            var source = PluginSource(plugin);
            services.AddScoped(_ => new HostServiceScope(rootProvider));
            services.AddScoped<ISchoolData>(sp => new PluginSchoolData(sp.GetRequiredService<HostServiceScope>().Services.GetRequiredService<SchulyDbContext>(), source));
            services.AddScoped<IPluginFileStore>(sp => new PluginFileStore(sp.GetRequiredService<HostServiceScope>().Services.GetRequiredService<IDocumentStorage>()));
            services.AddScoped<ILinkedAccounts>(sp =>
            {
                var host = sp.GetRequiredService<HostServiceScope>().Services;
                return new LinkedAccountStore(host.GetRequiredService<SchulyDbContext>(), sp.GetRequiredService<IPluginVaultFactory>(), host.GetRequiredService<IDocumentStorage>());
            });

            // Plugin services that inject IConfiguration see the host config with the
            // plugin's own plugins-config (yml + SCHULY_PLUGIN_* env) overlaid on top, so
            // a value in plugins-config/<assembly>.yml reaches the services that use it —
            // not just the load-time check that reads PluginServiceContext.Configuration.
            var pluginConfig = new ConfigurationBuilder()
                .AddConfiguration(configuration)
                .AddConfiguration(LoadPluginConfig(plugin))
                .Build();
            services.AddSingleton<IConfiguration>(pluginConfig);

            var context = new PluginServiceContext(PluginConnectionString(plugin.Name), pluginConfig);
            plugin.ConfigureServices(services, context);

            return (services.BuildServiceProvider(), pluginConfig);
        }

        private Task SyncBackgroundTasksAsync(LoadedPlugin plugin, CancellationToken ct)
        {
            var registrations = plugin.Provider.GetServices<IPluginBackgroundTask>()
                .Select(task => PluginTaskScheduleResolver.Resolve(plugin.Name, task, plugin.Configuration, logger))
                .ToList();

            return scheduler.SyncAsync(plugin.Name, registrations, ct);
        }

        public async Task RunTaskAsync(string pluginName, string taskName, CancellationToken cancellationToken = default)
        {
            if (!_loaded.TryGetValue(pluginName, out var plugin))
            {
                logger.LogWarning("Scheduled run fired for plugin task {Plugin}/{Task} but the plugin is not loaded", pluginName, taskName);
                return;
            }

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, plugin.TaskCts.Token);
            Interlocked.Increment(ref plugin.InFlightRuns);
            try
            {
                using var scope = plugin.Provider.CreateScope();
                var task = scope.ServiceProvider.GetServices<IPluginBackgroundTask>()
                    .FirstOrDefault(t => string.Equals(t.Name, taskName, StringComparison.OrdinalIgnoreCase));
                if (task is null)
                    throw new InvalidOperationException($"Plugin '{pluginName}' has no background task named '{taskName}'");

                await task.ExecuteAsync(scope.ServiceProvider, linkedCts.Token);
            }
            finally
            {
                Interlocked.Decrement(ref plugin.InFlightRuns);
            }
        }

        private async Task WaitForInFlightRunsAsync(LoadedPlugin plugin)
        {
            var deadline = DateTime.UtcNow.AddSeconds(10);
            while (Volatile.Read(ref plugin.InFlightRuns) > 0 && DateTime.UtcNow < deadline)
                await Task.Delay(100);

            if (Volatile.Read(ref plugin.InFlightRuns) > 0)
                logger.LogWarning("Plugin {Name} still has {Count} in-flight background task run(s) after waiting 10 seconds; unloading anyway", plugin.Name, plugin.InFlightRuns);
        }

        private void RefreshEndpoints() =>
            endpointSource.Replace(_loaded.Values.SelectMany(p => p.Endpoints));

        internal static string PluginSource(ISchulyPlugin plugin) => plugin.GetType().Assembly.GetName().Name ?? plugin.Name;

        private string PluginConnectionString(string pluginName)
        {
            var main = configuration.GetConnectionString("SchulyDatabase")
                ?? throw new InvalidOperationException("SchulyDatabase connection string not configured");
            var dbName = $"schuly_plugin_{pluginName.ToLowerInvariant().Replace(" ", "_")}";
            return new NpgsqlConnectionStringBuilder(main) { Database = dbName }.ConnectionString;
        }

        private IConfiguration LoadPluginConfig(ISchulyPlugin plugin)
        {
            var configDir = configuration["Plugins:ConfigDirectory"] ?? "plugins-config";
            if (!Path.IsPathRooted(configDir))
                configDir = Path.Combine(AppContext.BaseDirectory, configDir);

            var assemblyName = plugin.GetType().Assembly.GetName().Name ?? plugin.Name;
            var builder = new ConfigurationBuilder();
            foreach (var ext in new[] { "yml", "yaml" })
            {
                var path = Path.Combine(configDir, $"{assemblyName}.{ext}");
                if (File.Exists(path))
                {
                    builder.AddYamlFile(path, optional: true, reloadOnChange: true);
                    break;
                }
            }
            builder.AddEnvironmentVariables($"SCHULY_PLUGIN_{plugin.Name.ToUpperInvariant().Replace(" ", "_")}_");
            return builder.Build();
        }

        private sealed class HostServiceScope(IServiceProvider root) : IDisposable
        {
            private readonly IServiceScope _scope = root.CreateScope();
            public IServiceProvider Services => _scope.ServiceProvider;
            public void Dispose() => _scope.Dispose();
        }

        /// <summary>
        /// Bridges plugin code to the host's <see cref="IPluginUserContext"/> lazily.
        /// Constructing it touches no HttpContext, so plugin services that depend on the
        /// user context can be built outside a request (e.g. reading a plugin's catalog
        /// descriptor at load time); each call resolves the host implementation.
        /// <para>
        /// It resolves from a fresh <b>root</b> scope, never from
        /// <c>HttpContext.RequestServices</c>: for a plugin endpoint the request services
        /// are swapped to the plugin's own provider (see <see cref="PluginScopeMiddleware"/>),
        /// where this very type is registered as <see cref="IPluginUserContext"/> — resolving
        /// from there would re-enter this wrapper and recurse forever (stack overflow). The
        /// host's user service reads the caller's identity from the ambient
        /// <see cref="IHttpContextAccessor"/>, so a root scope still sees the real request user.
        /// </para>
        /// </summary>
        private sealed class DeferredPluginUserContext(IServiceProvider root) : IPluginUserContext
        {
            public async Task<Guid> GetCurrentUserIdAsync(CancellationToken cancellationToken = default)
            {
                using var scope = root.CreateScope();
                return await scope.ServiceProvider.GetRequiredService<IPluginUserContext>()
                    .GetCurrentUserIdAsync(cancellationToken);
            }

            public async Task<Guid?> GetCurrentSchoolUserIdAsync(CancellationToken cancellationToken = default)
            {
                using var scope = root.CreateScope();
                return await scope.ServiceProvider.GetRequiredService<IPluginUserContext>()
                    .GetCurrentSchoolUserIdAsync(cancellationToken);
            }
        }

        private sealed class LoadedPlugin
        {
            public required string Name { get; init; }
            public required string Version { get; init; }
            public required ISchulyPlugin Instance { get; init; }
            public required PluginLoadContext LoadContext { get; init; }
            public required Assembly Assembly { get; init; }
            public required ServiceProvider Provider { get; init; }
            public required IConfiguration Configuration { get; init; }
            public required AssemblyPart Part { get; init; }
            public required IReadOnlyList<Endpoint> Endpoints { get; init; }
            public required CancellationTokenSource TaskCts { get; init; }
            public required IReadOnlyList<LinkProviderEntry> LinkProviders { get; init; }
            public int InFlightRuns;
        }

        private sealed class LinkProviderLease(IServiceScope scope, ILinkProvider provider) : ILinkProviderLease
        {
            public ILinkProvider Provider { get; } = provider;
            public void Dispose() => scope.Dispose();
        }
    }
}
