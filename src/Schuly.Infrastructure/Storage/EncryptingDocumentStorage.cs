using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Schuly.Infrastructure.Storage
{
    /// <summary>
    /// Transparent envelope-encryption decorator around an inner <see cref="IDocumentStorage"/>
    /// (normally the raw S3 client) so the bucket never sees plaintext. Each object gets
    /// its own random AES-256-GCM data-encryption key (DEK), wrapped with the keyring's
    /// master key and stored in the object's own header - so rotating the master key
    /// only re-wraps future DEKs, it never needs to touch existing ciphertext. Objects
    /// written before this decorator existed (or with no "SCHDOC1" magic for any other
    /// reason) are read back as plaintext unchanged, so the rollout needs no migration
    /// to keep working; <see cref="ReencryptAsync"/> is the opt-in migration for those.
    /// </summary>
    public class EncryptingDocumentStorage(IDocumentStorage inner, DocumentEncryptionKeyring keyring) : IDocumentStorage, IDocumentEncryptionMaintenance
    {
        public async Task<UploadedBlob> UploadAsync(Stream content, string fileName, string? contentType, CancellationToken ct)
        {
            var dek = RandomNumberGenerator.GetBytes(DocumentCryptoFormat.DekSize);
            var wrapNonce = RandomNumberGenerator.GetBytes(DocumentCryptoFormat.NonceSize);
            var baseNonce = RandomNumberGenerator.GetBytes(DocumentCryptoFormat.NonceSize);
            var keyVersion = keyring.CurrentKeyVersion;
            var chunkSize = keyring.ChunkSizeBytes;

            var wrappedDek = new byte[DocumentCryptoFormat.WrappedDekLength];
            wrapNonce.CopyTo(wrappedDek, 0);
            var wrapCiphertext = wrappedDek.AsSpan(DocumentCryptoFormat.NonceSize, DocumentCryptoFormat.DekSize);
            var wrapTag = wrappedDek.AsSpan(DocumentCryptoFormat.NonceSize + DocumentCryptoFormat.DekSize, DocumentCryptoFormat.TagSize);
            var aadPrefix = DocumentCryptoFormat.BuildAadPrefix(keyVersion);
            using (var kekAes = new AesGcm(keyring.CurrentKey, DocumentCryptoFormat.TagSize))
                kekAes.Encrypt(wrapNonce, dek, wrapCiphertext, wrapTag, aadPrefix);

            var header = DocumentCryptoFormat.BuildHeader(keyVersion, wrappedDek, baseNonce, chunkSize);

            using var encryptingStream = new EncryptingReadStream(content, dek, header, baseNonce, chunkSize);
            var uploaded = await inner.UploadAsync(encryptingStream, fileName, contentType, ct);
            return new UploadedBlob(uploaded.Key, encryptingStream.PlaintextBytesRead);
        }

        public IAsyncEnumerable<StoredBlob> ListAsync(CancellationToken ct) => inner.ListAsync(ct);

        public async Task<DocumentStream> OpenReadAsync(string key, CancellationToken ct)
        {
            var raw = await inner.OpenReadAsync(key, ct);

            var prefix = new byte[DocumentCryptoFormat.MagicLength];
            var prefixRead = await ReadUpToAsync(raw.Content, prefix, ct);
            var isEncrypted = prefixRead == DocumentCryptoFormat.MagicLength && prefix.AsSpan().SequenceEqual(DocumentCryptoFormat.Magic);

            if (!isEncrypted)
            {
                var replay = new PrefixedStream(prefix.AsSpan(0, prefixRead).ToArray(), raw.Content);
                return new DocumentStream(replay, raw.ContentType, raw.ContentLength);
            }

            try
            {
                var rest1 = new byte[1 + 4 + 2];
                await ReadExactlyAsync(raw.Content, rest1, ct);
                var formatVersion = rest1[0];
                if (formatVersion != DocumentCryptoFormat.FormatVersion)
                    throw new CryptographicException($"Unsupported document encryption format version {formatVersion}.");

                var keyVersion = BinaryPrimitives.ReadInt32LittleEndian(rest1.AsSpan(1, 4));
                var wrappedDekLength = BinaryPrimitives.ReadUInt16LittleEndian(rest1.AsSpan(5, 2));
                if (wrappedDekLength != DocumentCryptoFormat.WrappedDekLength)
                    throw new CryptographicException("Invalid wrapped key length in encrypted document header.");

                var rest2 = new byte[wrappedDekLength + DocumentCryptoFormat.NonceSize + 4];
                await ReadExactlyAsync(raw.Content, rest2, ct);
                var wrappedDek = rest2.AsSpan(0, wrappedDekLength).ToArray();
                var baseNonce = rest2.AsSpan(wrappedDekLength, DocumentCryptoFormat.NonceSize).ToArray();
                var chunkSize = BinaryPrimitives.ReadInt32LittleEndian(rest2.AsSpan(wrappedDekLength + DocumentCryptoFormat.NonceSize, 4));
                if (chunkSize <= 0)
                    throw new CryptographicException("Invalid chunk size in encrypted document header.");

                var header = new byte[DocumentCryptoFormat.MagicLength + rest1.Length + rest2.Length];
                DocumentCryptoFormat.Magic.CopyTo(header, 0);
                rest1.CopyTo(header, DocumentCryptoFormat.MagicLength);
                rest2.CopyTo(header, DocumentCryptoFormat.MagicLength + rest1.Length);

                if (!keyring.TryGetKey(keyVersion, out var kek))
                    throw new CryptographicException($"Unknown document encryption key version {keyVersion}.");

                var dek = UnwrapDek(kek, wrappedDek, header.AsSpan(0, DocumentCryptoFormat.AadPrefixLength).ToArray());

                var decryptingStream = new DecryptingReadStream(raw.Content, dek, header, baseNonce, chunkSize);
                var plaintextLength = ComputePlaintextLength(raw.ContentLength, header.Length, chunkSize);
                return new DocumentStream(decryptingStream, raw.ContentType, plaintextLength);
            }
            catch
            {
                await raw.Content.DisposeAsync();
                throw;
            }
        }

        public Task DeleteAsync(string key, CancellationToken ct) => inner.DeleteAsync(key, ct);

        public async Task<ReencryptedDocument> ReencryptAsync(string key, CancellationToken ct)
        {
            var raw = await inner.OpenReadAsync(key, ct);

            var prefix = new byte[DocumentCryptoFormat.MagicLength];
            var prefixRead = await ReadUpToAsync(raw.Content, prefix, ct);
            var alreadyEncrypted = prefixRead == DocumentCryptoFormat.MagicLength && prefix.AsSpan().SequenceEqual(DocumentCryptoFormat.Magic);

            if (alreadyEncrypted)
            {
                await raw.Content.DisposeAsync();
                return new ReencryptedDocument(true, key);
            }

            var tempPath = Path.GetTempFileName();
            try
            {
                await using var tempFile = new FileStream(tempPath, FileMode.Create, FileAccess.ReadWrite, FileShare.None, 4096, FileOptions.DeleteOnClose | FileOptions.Asynchronous);
                await tempFile.WriteAsync(prefix.AsMemory(0, prefixRead), ct);
                await raw.Content.CopyToAsync(tempFile, ct);
                await raw.Content.DisposeAsync();
                tempFile.Position = 0;

                var lastSlash = key.LastIndexOf('/');
                var fileName = lastSlash >= 0 ? key[(lastSlash + 1)..] : key;

                var uploaded = await UploadAsync(tempFile, fileName, raw.ContentType, ct);
                return new ReencryptedDocument(false, uploaded.Key);
            }
            finally
            {
                if (File.Exists(tempPath))
                {
                    try { File.Delete(tempPath); }
                    catch (IOException) { /* best effort; DeleteOnClose already removes it in the common case */ }
                }
            }
        }

        private static byte[] UnwrapDek(ReadOnlySpan<byte> kek, byte[] wrappedDek, byte[] aad)
        {
            var wrapNonce = wrappedDek.AsSpan(0, DocumentCryptoFormat.NonceSize);
            var wrapCiphertext = wrappedDek.AsSpan(DocumentCryptoFormat.NonceSize, DocumentCryptoFormat.DekSize);
            var wrapTag = wrappedDek.AsSpan(DocumentCryptoFormat.NonceSize + DocumentCryptoFormat.DekSize, DocumentCryptoFormat.TagSize);
            var dek = new byte[DocumentCryptoFormat.DekSize];
            using var kekAes = new AesGcm(kek, DocumentCryptoFormat.TagSize);
            kekAes.Decrypt(wrapNonce, wrapCiphertext, wrapTag, dek, aad);
            return dek;
        }

        private static long? ComputePlaintextLength(long? ciphertextLength, int headerLength, int chunkSize)
        {
            if (ciphertextLength is not { } ctLen)
                return null;

            var body = ctLen - headerLength;
            if (body < 0)
                return null;

            var frameSize = chunkSize + DocumentCryptoFormat.FrameOverhead;
            var full = body / frameSize;
            var rem = body % frameSize;
            var plain = full * (long)chunkSize + (rem > 0 ? rem - DocumentCryptoFormat.FrameOverhead : 0);
            return plain < 0 ? null : plain;
        }

        private static async ValueTask<int> ReadUpToAsync(Stream s, Memory<byte> buffer, CancellationToken ct)
        {
            var total = 0;
            while (total < buffer.Length)
            {
                var n = await s.ReadAsync(buffer[total..], ct);
                if (n == 0) break;
                total += n;
            }
            return total;
        }

        private static async Task ReadExactlyAsync(Stream s, Memory<byte> buffer, CancellationToken ct)
        {
            var n = await ReadUpToAsync(s, buffer, ct);
            if (n != buffer.Length)
                throw new CryptographicException("Truncated encrypted document header.");
        }
    }
}
