using System.Security.Cryptography;
using System.Text;
using Schuly.Infrastructure.Vault;

namespace Schuly.Infrastructure.Helply
{
    /// <summary>
    /// AES-256-GCM for Helply conversations. The key is derived from the vault master key, every write gets a fresh random nonce, and the associated data binds a blob to
    /// <c>conversationId|applicationUserId|field</c>, so a blob copied into another row, another user or another column fails authentication instead of decrypting.
    /// Layout: <c>[version 1 byte][nonce 12][ciphertext][tag 16]</c>.
    /// </summary>
    public sealed class HelplyCipher
    {
        public const string KeyNamespace = "helply-conversations";
        public const string TitleField = "title";
        public const string TranscriptField = "transcript";
        public const string SessionField = "session";

        private const byte Version = 1;
        private const int NonceSize = 12;
        private const int TagSize = 16;

        private readonly byte[] _key;

        public HelplyCipher(VaultKeyring keyring) => _key = keyring.DeriveKey(KeyNamespace);

        public byte[] Encrypt(ReadOnlySpan<byte> plaintext, Guid conversationId, Guid applicationUserId, string field)
        {
            var result = new byte[1 + NonceSize + plaintext.Length + TagSize];
            result[0] = Version;
            var nonce = result.AsSpan(1, NonceSize);
            RandomNumberGenerator.Fill(nonce);
            using var aes = new AesGcm(_key, TagSize);
            aes.Encrypt(nonce, plaintext, result.AsSpan(1 + NonceSize, plaintext.Length), result.AsSpan(1 + NonceSize + plaintext.Length, TagSize), AssociatedData(conversationId, applicationUserId, field));
            return result;
        }

        public byte[] Encrypt(string plaintext, Guid conversationId, Guid applicationUserId, string field) => Encrypt(Encoding.UTF8.GetBytes(plaintext), conversationId, applicationUserId, field);

        /// <summary>Throws <see cref="CryptographicException"/> when the blob is malformed, was tampered with, or belongs to another row, user or field.</summary>
        public byte[] Decrypt(byte[] blob, Guid conversationId, Guid applicationUserId, string field)
        {
            if (blob.Length < 1 + NonceSize + TagSize || blob[0] != Version)
                throw new CryptographicException("Unrecognised Helply blob.");
            var cipherLength = blob.Length - 1 - NonceSize - TagSize;
            var plaintext = new byte[cipherLength];
            using var aes = new AesGcm(_key, TagSize);
            aes.Decrypt(blob.AsSpan(1, NonceSize), blob.AsSpan(1 + NonceSize, cipherLength), blob.AsSpan(1 + NonceSize + cipherLength, TagSize), plaintext, AssociatedData(conversationId, applicationUserId, field));
            return plaintext;
        }

        public string DecryptString(byte[] blob, Guid conversationId, Guid applicationUserId, string field) => Encoding.UTF8.GetString(Decrypt(blob, conversationId, applicationUserId, field));

        private static byte[] AssociatedData(Guid conversationId, Guid applicationUserId, string field) => Encoding.UTF8.GetBytes($"{conversationId:D}|{applicationUserId:D}|{field}");
    }
}
