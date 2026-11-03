using Microsoft.Extensions.Logging.Abstractions;
using Schuly.Domain;
using Schuly.Infrastructure.Services;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class PluginUserDataPurgeTests
    {
        private sealed class RecordingPurger : IPluginUserDataPurger
        {
            public readonly List<Guid> Purged = [];
            public Task<IReadOnlyList<string>> PurgeAsync(Guid applicationUserId, string? pluginSource = null, CancellationToken cancellationToken = default)
            {
                Purged.Add(applicationUserId);
                return Task.FromResult<IReadOnlyList<string>>([]);
            }
            public Task<IReadOnlyCollection<Guid>> ListOwnersAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyCollection<Guid>>([]);
        }

        [Test]
        public async Task Deleting_a_user_asks_plugins_to_purge_their_data_for_that_user()
        {
            using var ctx = TestDb.NewContext(nameof(Deleting_a_user_asks_plugins_to_purge_their_data_for_that_user));
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = Guid.NewGuid().ToString(), Email = "u@schuly.dev" };
            ctx.ApplicationUsers.Add(user);
            await ctx.SaveChangesAsync();

            var plugins = new RecordingPurger();
            var purger = new AccountPurger(ctx, new FakeDocumentStorage(), TestVault.Factory(), plugins, NullLogger<AccountPurger>.Instance);
            await purger.PurgeApplicationUserAsync(user.Id);

            await Assert.That(plugins.Purged).IsEquivalentTo(new[] { user.Id });
        }

        [Test]
        public async Task Purging_only_school_users_does_not_ask_plugins_to_purge_the_account()
        {
            using var ctx = TestDb.NewContext(nameof(Purging_only_school_users_does_not_ask_plugins_to_purge_the_account));
            var plugins = new RecordingPurger();
            var purger = new AccountPurger(ctx, new FakeDocumentStorage(), TestVault.Factory(), plugins, NullLogger<AccountPurger>.Instance);
            await purger.PurgeSchoolUsersAsync([Guid.NewGuid()]);

            await Assert.That(plugins.Purged).IsEmpty();
        }
    }
}
