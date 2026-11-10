using System.Security.Cryptography;
using System.Text;
using Schuly.Infrastructure.Storage;

namespace Schuly.Infrastructure.Services
{
    /// <summary>
    /// Builds the API paths of stored pictures. They are not capabilities: every avatar endpoint requires the normal
    /// sign-in and answers only the picture's owner, so clients fetch them with their bearer token (not a plain img src).
    /// The DB holds only a bare blob key; the <c>v</c> query value changes with it, so clients may cache by URL.
    /// </summary>
    public interface IAvatarUrlSigner
    {
        string? ToPublicUrl(Guid schoolUserId, string? stored);

        string? ToPublicUserUrl(Guid applicationUserId, string? stored);

        /// <summary>A linked account's picture.</summary>
        string? ToPublicAccountUrl(Guid linkedAccountId, string? stored);

        /// <summary>A school account's own picture (<c>SchoolUser.AccountPictureKey</c>).</summary>
        string? ToPublicSchoolAccountUrl(Guid schoolUserId, string? stored);
    }

    public class AvatarUrlSigner : IAvatarUrlSigner
    {
        public string? ToPublicUrl(Guid schoolUserId, string? stored) => Build(schoolUserId, stored, "/api/avatars", passExternal: true);

        public string? ToPublicUserUrl(Guid applicationUserId, string? stored) => Build(applicationUserId, stored, "/api/avatars/users", passExternal: true);

        public string? ToPublicAccountUrl(Guid linkedAccountId, string? stored) => Build(linkedAccountId, stored, "/api/avatars/accounts", passExternal: false);

        public string? ToPublicSchoolAccountUrl(Guid schoolUserId, string? stored) => Build(schoolUserId, stored, "/api/avatars/school-accounts", passExternal: false);

        private static string? Build(Guid id, string? stored, string route, bool passExternal)
        {
            if (string.IsNullOrWhiteSpace(stored)) return null;
            if (!BlobKeys.IsStored(stored))
                return passExternal ? stored : null; // external URL (e.g. OIDC) - pass through

            var version = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(stored)))[..12];
            return $"{route}/{id}?v={version}";
        }
    }
}
