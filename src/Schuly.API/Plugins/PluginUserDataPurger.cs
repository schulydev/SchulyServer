using Schuly.Infrastructure.Services;
using Schuly.Plugin.Abstractions;

namespace Schuly.API.Plugins
{
    /// <summary>Wipes a user's plugin-owned data by dispatching <see cref="PluginUserPurgeEvent"/> to the plugins.</summary>
    public sealed class PluginUserDataPurger(PluginHost host) : IPluginUserDataPurger
    {
        public Task<IReadOnlyList<string>> PurgeAsync(Guid applicationUserId, string? pluginSource = null, CancellationToken cancellationToken = default) =>
            host.DispatchReportingFailuresAsync(new PluginUserPurgeEvent(applicationUserId), pluginSource, cancellationToken);

        public Task<IReadOnlyCollection<Guid>> ListOwnersAsync(CancellationToken cancellationToken = default) =>
            host.ListDataOwnersAsync(cancellationToken);
    }
}
