using Schuly.Infrastructure.Services;
using Toamaisutaa.Abstractions;

namespace Schuly.Tests.TestHelpers
{
    public sealed class FakeUserStore : IUserStore
    {
        public HashSet<Guid> Existing { get; } = [];
        public List<Guid> Deleted { get; } = [];
        public Action? OnDelete { get; set; }

        public Task<ToamaisutaaUser?> FindByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
            Task.FromResult(Existing.Contains(id) ? new ToamaisutaaUser { Id = id, SecurityStamp = "stamp" } : null);

        public Task DeleteAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            OnDelete?.Invoke();
            Existing.Remove(userId);
            Deleted.Add(userId);
            return Task.CompletedTask;
        }

        public Task<ToamaisutaaUser?> FindByEmailAsync(string email, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ToamaisutaaUser> CreateAsync(ExternalUserProfile profile, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ToamaisutaaUser> CreateAsync(ToamaisutaaUser user, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task UpdateProfileAsync(ToamaisutaaUser user, ExternalUserProfile profile, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task UpdateSecurityStampAsync(Guid userId, string securityStamp, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task SetUserNameAsync(Guid userId, string userName, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task SetEmailAsync(Guid userId, string email, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    public sealed class FakeWarningSender : IInactivityWarningSender
    {
        public List<(string Email, DateTime DeleteAfter)> Sent { get; } = [];
        public bool Fail { get; set; }

        public Task SendAsync(string email, DateTime deleteAfterUtc, CancellationToken cancellationToken)
        {
            if (Fail)
                throw new InvalidOperationException("Simulated mail failure");
            Sent.Add((email, deleteAfterUtc));
            return Task.CompletedTask;
        }
    }

    /// <summary>Records what the plugins were asked, and fails for the sources it is told to.</summary>
    public sealed class FakePluginPurger : IPluginUserDataPurger
    {
        public List<(Guid UserId, string? Source)> Purged { get; } = [];
        public List<Guid> Owners { get; } = [];
        public List<string> FailingSources { get; } = [];

        public Task<IReadOnlyList<string>> PurgeAsync(Guid applicationUserId, string? pluginSource = null, CancellationToken cancellationToken = default)
        {
            Purged.Add((applicationUserId, pluginSource));
            return Task.FromResult<IReadOnlyList<string>>(FailingSources.Where(s => pluginSource is null || s == pluginSource).ToList());
        }

        public Task<IReadOnlyCollection<Guid>> ListOwnersAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyCollection<Guid>>(Owners);
    }
}
