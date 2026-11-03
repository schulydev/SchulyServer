using System.Security.Cryptography;

namespace Schuly.Infrastructure.Vault
{
    public readonly record struct VaultRotationResult(int Rotated, int Unreadable);

    /// <summary>
    /// Re-encrypts vault entries from the previous master key to the current one. GCM's tag tells which key an entry is under, so this is safe to run on every start
    /// while a previous key is set, and an interrupted run just continues. An entry readable with neither key is left untouched.
    /// </summary>
    public static class VaultKeyRotator
    {
        private const int CurrentKeyVersion = 1;

        public static VaultRotationResult Rotate(VaultKeyring keyring, IVaultStore store)
        {
            int rotated = 0, unreadable = 0;
            foreach (var ns in store.Namespaces())
            {
                var previousKey = keyring.DerivePreviousKey(ns);
                if (previousKey is null)
                    return default;

                var key = keyring.DeriveKey(ns);
                foreach (var (name, record) in store.Load(ns))
                {
                    if (TryDecrypt(key, record, out var current))
                    {
                        CryptographicOperations.ZeroMemory(current);
                        continue;
                    }
                    if (!TryDecrypt(previousKey, record, out var plaintext))
                    {
                        unreadable++;
                        continue;
                    }

                    store.Save(ns, name, Encrypt(key, plaintext));
                    CryptographicOperations.ZeroMemory(plaintext);
                    rotated++;
                }
            }
            return new VaultRotationResult(rotated, unreadable);
        }

        private static bool TryDecrypt(byte[] key, VaultRecord record, out byte[] plaintext)
        {
            plaintext = new byte[record.Ciphertext.Length];
            try
            {
                using var aes = new AesGcm(key, record.Tag.Length);
                aes.Decrypt(record.Nonce, record.Ciphertext, record.Tag, plaintext);
                return true;
            }
            catch (CryptographicException)
            {
                return false;
            }
        }

        private static VaultRecord Encrypt(byte[] key, byte[] plaintext)
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var tag = new byte[16];
            var ciphertext = new byte[plaintext.Length];
            using var aes = new AesGcm(key, tag.Length);
            aes.Encrypt(nonce, plaintext, ciphertext, tag);
            return new VaultRecord(nonce, tag, ciphertext, CurrentKeyVersion);
        }
    }
}
