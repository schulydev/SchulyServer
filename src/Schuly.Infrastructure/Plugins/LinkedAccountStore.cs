using Microsoft.EntityFrameworkCore;
using Schuly.Infrastructure.Storage;
using Schuly.Infrastructure.Vault;
using Schuly.Plugin.Abstractions;

namespace Schuly.Infrastructure.Plugins
{
    /// <summary>
    /// <see cref="ILinkedAccounts"/> for the host and every plugin: rows in <c>LinkedAccounts</c>,
    /// secrets in the <see cref="VaultNamespace"/> vault under <c>{linkedAccountId}:{name}</c>,
    /// pictures in the encrypted document storage (without <paramref name="storage"/> pictures are refused).
    /// </summary>
    public sealed class LinkedAccountStore(SchulyDbContext db, IPluginVaultFactory vaultFactory, IDocumentStorage? storage = null) : ILinkedAccounts
    {
        public const long MaxPictureBytes = 2_000_000;
        public const string VaultNamespace = "linked-accounts";
        private const string NamesSecret = "__names";

        private IPluginVault Vault => vaultFactory.GetVault(VaultNamespace);

        public async Task<IReadOnlyList<LinkedAccount>> ListAsync(Guid applicationUserId, string provider, CancellationToken cancellationToken = default)
        {
            var accounts = await db.LinkedAccounts
                .AsNoTracking()
                .Where(a => a.ApplicationUserId == applicationUserId && a.Provider == provider)
                .OrderBy(a => a.Email)
                .ToListAsync(cancellationToken);
            return accounts.Select(ToContract).ToList();
        }

        public async Task<LinkedAccount?> GetAsync(Guid applicationUserId, Guid linkedAccountId, CancellationToken cancellationToken = default)
        {
            var account = await FindAsync(applicationUserId, linkedAccountId, cancellationToken);
            return account is null ? null : ToContract(account);
        }

        public async Task<LinkedAccount> SaveAsync(Guid applicationUserId, LinkedAccountRecord account, CancellationToken cancellationToken = default)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(account.Provider);
            ArgumentException.ThrowIfNullOrWhiteSpace(account.ExternalId);
            ArgumentException.ThrowIfNullOrWhiteSpace(account.Email);

            var existing = await db.LinkedAccounts.FirstOrDefaultAsync(a => a.ApplicationUserId == applicationUserId && a.Provider == account.Provider && a.ExternalId == account.ExternalId, cancellationToken);
            if (existing is null)
            {
                existing = new Domain.LinkedAccount
                {
                    ApplicationUserId = applicationUserId,
                    Provider = account.Provider,
                    ExternalId = account.ExternalId,
                    Email = account.Email,
                    DisplayName = account.DisplayName,
                };
                db.LinkedAccounts.Add(existing);
            }
            else
            {
                existing.Email = account.Email;
                existing.DisplayName = account.DisplayName;
                existing.UpdatedAt = DateTime.UtcNow;
            }

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException) when (db.Entry(existing).State == EntityState.Added)
            {
                // A concurrent save of the same external account won the unique index: link to its row instead of failing.
                db.Entry(existing).State = EntityState.Detached;
                var winner = await db.LinkedAccounts.FirstOrDefaultAsync(a => a.ApplicationUserId == applicationUserId && a.Provider == account.Provider && a.ExternalId == account.ExternalId, cancellationToken);
                if (winner is null)
                    throw;

                winner.Email = account.Email;
                winner.DisplayName = account.DisplayName;
                winner.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(cancellationToken);
                existing = winner;
            }

            return ToContract(existing);
        }

        public async Task<bool> RemoveAsync(Guid applicationUserId, Guid linkedAccountId, CancellationToken cancellationToken = default)
        {
            var account = await FindAsync(applicationUserId, linkedAccountId, cancellationToken);
            if (account is null)
                return false;

            db.LinkedAccounts.Remove(account);
            await db.SaveChangesAsync(cancellationToken);
            RemoveSecrets(linkedAccountId);
            await DeletePictureAsync(account.PictureKey, cancellationToken);
            return true;
        }

        public async Task<bool> SetPictureAsync(Guid applicationUserId, Guid linkedAccountId, Stream? content, string? contentType, CancellationToken cancellationToken = default)
        {
            if (storage is null)
                return false;

            var account = await FindAsync(applicationUserId, linkedAccountId, cancellationToken);
            if (account is null)
                return false;

            var previous = account.PictureKey;
            if (await StorePictureAsync(content, cancellationToken) is not { } picture)
                return false;

            account.PictureKey = picture.Key;
            account.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            await DeletePictureAsync(previous, cancellationToken);
            return true;
        }

        /// <summary>The school account's own picture (<see cref="Domain.SchoolUser.AccountPictureKey"/>), only on the user's own school users.</summary>
        public async Task<bool> SetSchoolUserPictureAsync(Guid applicationUserId, Guid schoolUserId, Stream? content, string? contentType, CancellationToken cancellationToken = default)
        {
            if (storage is null)
                return false;

            var schoolUser = await db.SchoolUsers.FirstOrDefaultAsync(su => su.Id == schoolUserId && su.ApplicationUserId == applicationUserId, cancellationToken);
            if (schoolUser is null)
                return false;

            var previous = schoolUser.AccountPictureKey;
            if (await StorePictureAsync(content, cancellationToken) is not { } picture)
                return false;

            schoolUser.AccountPictureKey = picture.Key;
            schoolUser.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            await DeletePictureAsync(previous, cancellationToken);
            return true;
        }

        // Uploads the picture and returns its key (null key for null content), or null when it is no picture.
        private async Task<StoredPicture?> StorePictureAsync(Stream? content, CancellationToken cancellationToken)
        {
            if (content is null)
                return new StoredPicture(null);

            // The declared type is ignored: the bytes decide, so nothing but a real picture is ever served from here.
            var bytes = await ReadAtMostAsync(content, MaxPictureBytes, cancellationToken);
            if (bytes is null || PictureType(bytes) is not { } type)
                return null;

            var blob = await storage!.UploadAsync(new MemoryStream(bytes, writable: false), $"account-picture.{type.Extension}", type.ContentType, cancellationToken);
            return new StoredPicture(blob.Key);
        }

        private sealed record StoredPicture(string? Key);

        /// <summary>The PNG, JPEG or WebP type of <paramref name="data"/>, or null for anything else.</summary>
        public static (string ContentType, string Extension)? PictureType(ReadOnlySpan<byte> data)
        {
            if (data.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
                return ("image/png", "png");
            if (data.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]))
                return ("image/jpeg", "jpg");
            if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8))
                return ("image/webp", "webp");
            return null;
        }

        private static async Task<byte[]?> ReadAtMostAsync(Stream content, long max, CancellationToken cancellationToken)
        {
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await content.ReadAsync(chunk, cancellationToken)) > 0)
            {
                if (buffer.Length + read > max)
                    return null;
                buffer.Write(chunk, 0, read);
            }
            return buffer.Length == 0 ? null : buffer.ToArray();
        }

        // A blob that can't be deleted now is queued for the daily retention sweep rather than failing the caller.
        private async Task DeletePictureAsync(string? key, CancellationToken cancellationToken)
        {
            if (storage is null || !BlobKeys.IsStored(key))
                return;

            try
            {
                await storage.DeleteAsync(key!, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                db.PendingPurges.Add(new Domain.PendingPurge { Kind = Domain.PendingPurgeKind.Blob, Target = key! });
                await db.SaveChangesAsync(CancellationToken.None);
            }
        }

        public async Task<string?> GetSecretAsync(Guid applicationUserId, Guid linkedAccountId, string name, CancellationToken cancellationToken = default)
        {
            if (await FindAsync(applicationUserId, linkedAccountId, cancellationToken) is null)
                return null;
            return Vault.Get(Key(linkedAccountId, name));
        }

        public async Task SetSecretAsync(Guid applicationUserId, Guid linkedAccountId, string name, string value, CancellationToken cancellationToken = default)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            if (name == NamesSecret)
                throw new ArgumentException($"'{NamesSecret}' is reserved.", nameof(name));
            if (await FindAsync(applicationUserId, linkedAccountId, cancellationToken) is null)
                throw new InvalidOperationException("Linked account not found for this user.");

            Vault.Set(Key(linkedAccountId, name), value);
            var names = SecretNames(linkedAccountId);
            if (names.Add(name))
                Vault.Set(Key(linkedAccountId, NamesSecret), string.Join('\n', names));
        }

        /// <summary>Deletes every secret stored for the account (used once its row is gone).</summary>
        public void RemoveSecrets(Guid linkedAccountId)
        {
            foreach (var name in SecretNames(linkedAccountId))
                Vault.Remove(Key(linkedAccountId, name));
            Vault.Remove(Key(linkedAccountId, NamesSecret));
        }

        private Task<Domain.LinkedAccount?> FindAsync(Guid applicationUserId, Guid linkedAccountId, CancellationToken cancellationToken) =>
            db.LinkedAccounts.FirstOrDefaultAsync(a => a.Id == linkedAccountId && a.ApplicationUserId == applicationUserId, cancellationToken);

        private HashSet<string> SecretNames(Guid linkedAccountId) =>
            (Vault.Get(Key(linkedAccountId, NamesSecret)) ?? string.Empty).Split('\n', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);

        private static string Key(Guid linkedAccountId, string name) => $"{linkedAccountId:N}:{name}";

        private static LinkedAccount ToContract(Domain.LinkedAccount a) =>
            new(a.Id, a.Provider, a.ExternalId, a.Email, a.DisplayName, new DateTimeOffset(DateTime.SpecifyKind(a.CreatedAt, DateTimeKind.Utc)), new DateTimeOffset(DateTime.SpecifyKind(a.UpdatedAt, DateTimeKind.Utc)));
    }
}
