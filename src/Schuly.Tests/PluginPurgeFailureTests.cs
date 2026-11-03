using Schuly.API.Plugins;
using Schuly.Tests.Plugin;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    [NotInParallel("PluginHost")]
    public class PluginPurgeFailureTests
    {
        [Test]
        public async Task A_throwing_purge_handler_is_reported_instead_of_swallowed()
        {
            await using var h = await PluginTestHarness.StartAsync();
            await h.Host.LoadAsync(h.CopyTestPlugin(), h.Directory);

            var failed = await new PluginUserDataPurger(h.Host).PurgeAsync(TestPurgeHandler.FailFor);

            await Assert.That(failed).IsEquivalentTo(new[] { "Schuly.Tests.Plugin" });
        }

        [Test]
        public async Task A_purge_that_succeeds_reports_nothing()
        {
            await using var h = await PluginTestHarness.StartAsync();
            await h.Host.LoadAsync(h.CopyTestPlugin(), h.Directory);

            await Assert.That(await new PluginUserDataPurger(h.Host).PurgeAsync(Guid.NewGuid())).IsEmpty();
        }

        [Test]
        public async Task A_purge_for_one_plugin_skips_the_others()
        {
            await using var h = await PluginTestHarness.StartAsync();
            await h.Host.LoadAsync(h.CopyTestPlugin(), h.Directory);

            await Assert.That(await new PluginUserDataPurger(h.Host).PurgeAsync(TestPurgeHandler.FailFor, "Schuly.Plugin.Other")).IsEmpty();
        }
    }
}
