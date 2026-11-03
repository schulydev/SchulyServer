namespace Schuly.Infrastructure.Services
{
    /// <summary>
    /// Wipes a deleted user's plugin-owned data (each plugin's database rows and vault
    /// secrets). The core purge reaches only host-owned tables; a plugin's own storage is
    /// reachable only through the plugin, so the API layer implements this over the plugin
    /// host. A no-op implementation is used where no plugin host is present (tests, etc.).
    /// </summary>
    public interface IPluginUserDataPurger
    {
        /// <summary>Asks every plugin, or only <paramref name="pluginSource"/>, to wipe the user. Returns the sources of the plugins that failed.</summary>
        Task<IReadOnlyList<string>> PurgeAsync(Guid applicationUserId, string? pluginSource = null, CancellationToken cancellationToken = default);

        /// <summary>The application user ids the loaded plugins hold data for, to find owners that no longer exist.</summary>
        Task<IReadOnlyCollection<Guid>> ListOwnersAsync(CancellationToken cancellationToken = default);
    }

    public sealed class NullPluginUserDataPurger : IPluginUserDataPurger
    {
        public static readonly NullPluginUserDataPurger Instance = new();
        public Task<IReadOnlyList<string>> PurgeAsync(Guid applicationUserId, string? pluginSource = null, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<string>>([]);
        public Task<IReadOnlyCollection<Guid>> ListOwnersAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyCollection<Guid>>([]);
    }
}
