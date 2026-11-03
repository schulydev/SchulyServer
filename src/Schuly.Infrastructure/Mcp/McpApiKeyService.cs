using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Schuly.Domain.Mcp;

namespace Schuly.Infrastructure.Mcp
{
    /// <summary>User-created keys for MCP clients without OAuth. The plaintext exists only in the response that creates it.</summary>
    public class McpApiKeyService(SchulyDbContext db, McpOAuthService oauth, IOptions<McpOAuthOptions> options, TimeProvider time)
    {
        public const int MaxNameLength = 100;
        private const int DisplayPrefixLength = 15;
        private static readonly TimeSpan LastUsedResolution = TimeSpan.FromMinutes(5);

        private DateTime Now => time.GetUtcNow().UtcDateTime;

        public async Task<(CreatedMcpApiKey? Key, string? Error)> CreateAsync(Guid applicationUserId, string? name, McpPermissionSet? permissions, DateTime? expiresAt, CancellationToken ct = default)
        {
            var trimmed = name?.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxNameLength)
                return (null, $"Give the key a name of 1 to {MaxNameLength} characters.");
            if (expiresAt is { } expiry && expiry.ToUniversalTime() <= Now)
                return (null, "The expiry date must be in the future.");

            var active = await db.McpApiKeys.CountAsync(k => k.ApplicationUserId == applicationUserId && k.RevokedAt == null && (k.ExpiresAt == null || k.ExpiresAt > Now), ct);
            if (active >= options.Value.MaxApiKeysPerUser)
                return (null, $"You can have at most {options.Value.MaxApiKeysPerUser} active keys. Revoke one first.");

            var secret = McpSecrets.NewSecret(McpSecrets.ApiKeyPrefix);
            var key = new McpApiKey
            {
                Id = Guid.NewGuid(),
                ApplicationUserId = applicationUserId,
                Name = trimmed,
                Prefix = secret[..DisplayPrefixLength],
                KeyHash = McpSecrets.Hash(secret),
                Permissions = McpScopes.Normalize(permissions ?? McpPermissionSet.SchoolDataOnly()),
                ExpiresAt = expiresAt?.ToUniversalTime() ?? Now + options.Value.DefaultApiKeyLifetime,
            };
            db.McpApiKeys.Add(key);
            await db.SaveChangesAsync(ct);
            return (new CreatedMcpApiKey(Summary(key), secret), null);
        }

        public async Task<List<McpApiKeySummary>> ListAsync(Guid applicationUserId, CancellationToken ct = default)
        {
            var keys = await db.McpApiKeys.AsNoTracking()
                .Where(k => k.ApplicationUserId == applicationUserId && k.RevokedAt == null)
                .OrderByDescending(k => k.CreatedAt)
                .ToListAsync(ct);
            return keys.Select(Summary).ToList();
        }

        public async Task<bool> RevokeAsync(Guid applicationUserId, Guid keyId, CancellationToken ct = default)
        {
            var key = await db.McpApiKeys.SingleOrDefaultAsync(k => k.Id == keyId && k.ApplicationUserId == applicationUserId && k.RevokedAt == null, ct);
            if (key is null)
                return false;
            key.RevokedAt = Now;
            await db.SaveChangesAsync(ct);
            return true;
        }

        public async Task<McpApiKeySummary?> UpdatePermissionsAsync(Guid applicationUserId, Guid keyId, McpPermissionSet permissions, CancellationToken ct = default)
        {
            var key = await db.McpApiKeys.SingleOrDefaultAsync(k => k.Id == keyId && k.ApplicationUserId == applicationUserId && k.RevokedAt == null, ct);
            if (key is null)
                return null;
            key.Permissions = McpScopes.Normalize(permissions);
            await db.SaveChangesAsync(ct);
            return Summary(key);
        }

        public async Task<McpCaller?> ValidateAsync(string secret, CancellationToken ct = default)
        {
            if (!secret.StartsWith(McpSecrets.ApiKeyPrefix, StringComparison.Ordinal))
                return null;

            var hash = McpSecrets.Hash(secret);
            var key = await db.McpApiKeys.Include(k => k.ApplicationUser).SingleOrDefaultAsync(k => k.KeyHash == hash, ct);
            if (key?.ApplicationUser is null || !McpSecrets.HashEquals(key.KeyHash, hash) || key.RevokedAt is not null || (key.ExpiresAt is { } expiry && expiry <= Now))
                return null;
            if ((await oauth.AccountAsync(key.ApplicationUser.ExternalId, ct)).Disabled)
                return null;

            if (key.LastUsedAt is null || key.LastUsedAt < Now - LastUsedResolution)
            {
                key.LastUsedAt = Now;
                await db.SaveChangesAsync(ct);
            }

            return new McpCaller(key.ApplicationUserId, key.ApplicationUser.ExternalId, key.Permissions, "api_key", null, key.Id);
        }

        private static McpApiKeySummary Summary(McpApiKey key) => new(key.Id, key.Name, key.Prefix, key.Permissions, key.CreatedAt, key.ExpiresAt, key.LastUsedAt);
    }
}
