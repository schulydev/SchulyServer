using Schuly.Infrastructure.Services;

namespace Schuly.Tests.TestHelpers
{
    public sealed class FakeAvatarUrlSigner : IAvatarUrlSigner
    {
        public string? ToPublicUrl(Guid schoolUserId, string? stored) => stored;
        public string? ToPublicUserUrl(Guid applicationUserId, string? stored) => stored;
        public string? ToPublicAccountUrl(Guid linkedAccountId, string? stored) => stored is null ? null : $"/api/avatars/accounts/{linkedAccountId}";
        public string? ToPublicSchoolAccountUrl(Guid schoolUserId, string? stored) => stored is null ? null : $"/api/avatars/school-accounts/{schoolUserId}";
    }
}
