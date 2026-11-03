using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Schuly.Infrastructure.Vault;

namespace Schuly.Infrastructure.Services
{
    /// <summary>
    /// AES-256-GCM for free text that can reveal health or discipline details: absence reasons and document metadata. The key comes from the vault master key. A stored value is
    /// <c>enc:v1:</c> + base64 of <c>[nonce 12][ciphertext][tag 16]</c>; anything without the prefix is a row from before encryption and is returned as it is until the backfill reaches it.
    /// </summary>
    // ponytail: EF caches the model per context type, so a converter can't take a per-context key. The key is process-wide and the first keyring wins, which is one key in any deployment. Blobs aren't bound to their row, unlike HelplyCipher, because a converter never sees the row.
    public static class SensitiveText
    {
        public const string Prefix = "enc:v1:";

        /// <summary>What a value reads as when the key that wrote it is gone. A synced row heals on its next sync, and the server keeps working.</summary>
        public const string Unreadable = "(unreadable)";

        private const string KeyNamespace = "school-text";
        private const int NonceSize = 12;
        private const int TagSize = 16;

        private static byte[]? _key;

        public static readonly ValueConverter<string, string> Converter = new(value => Protect(value), value => Reveal(value));

        public static void UseKeyring(VaultKeyring keyring) => Interlocked.CompareExchange(ref _key, keyring.DeriveKey(KeyNamespace), null);

        public static string Protect(string plaintext)
        {
            var bytes = Encoding.UTF8.GetBytes(plaintext);
            var blob = new byte[NonceSize + bytes.Length + TagSize];
            var nonce = blob.AsSpan(0, NonceSize);
            RandomNumberGenerator.Fill(nonce);
            using var aes = new AesGcm(Key, TagSize);
            aes.Encrypt(nonce, bytes, blob.AsSpan(NonceSize, bytes.Length), blob.AsSpan(NonceSize + bytes.Length, TagSize));
            return Prefix + Convert.ToBase64String(blob);
        }

        public static string Reveal(string stored)
        {
            if (!stored.StartsWith(Prefix, StringComparison.Ordinal))
                return stored;

            try
            {
                var blob = Convert.FromBase64String(stored[Prefix.Length..]);
                var plaintext = new byte[blob.Length - NonceSize - TagSize];
                using var aes = new AesGcm(Key, TagSize);
                aes.Decrypt(blob.AsSpan(0, NonceSize), blob.AsSpan(NonceSize, plaintext.Length), blob.AsSpan(NonceSize + plaintext.Length, TagSize), plaintext);
                return Encoding.UTF8.GetString(plaintext);
            }
            catch (Exception ex) when (ex is CryptographicException or FormatException or OverflowException)
            {
                return Unreadable;
            }
        }

        private static byte[] Key => _key ?? throw new InvalidOperationException("SensitiveText has no key: AddSchulyVault must run first.");
    }
}
