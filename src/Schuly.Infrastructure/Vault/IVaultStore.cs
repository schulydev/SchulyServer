namespace Schuly.Infrastructure.Vault
{
    public readonly record struct VaultRecord(byte[] Nonce, byte[] Tag, byte[] Ciphertext, int KeyVersion);

    /// <summary>
    /// Durable backing store for vault entries, keyed by namespace and key. Values are
    /// opaque AES-256-GCM records — this abstraction never sees plaintext.
    /// </summary>
    public interface IVaultStore
    {
        IReadOnlyCollection<string> Namespaces();

        IReadOnlyDictionary<string, VaultRecord> Load(string @namespace);

        void Save(string @namespace, string key, VaultRecord record);

        bool Delete(string @namespace, string key);

        void DeleteAll(string @namespace);
    }

    /// <summary>
    /// No-op <see cref="IVaultStore"/> for tests and hosts without a database — nothing
    /// is ever persisted, so the vault behaves exactly like the old in-memory-only store.
    /// </summary>
    public sealed class NullVaultStore : IVaultStore
    {
        public static readonly NullVaultStore Instance = new();

        private static readonly IReadOnlyDictionary<string, VaultRecord> Empty = new Dictionary<string, VaultRecord>(StringComparer.Ordinal);

        public IReadOnlyCollection<string> Namespaces() => [];

        public IReadOnlyDictionary<string, VaultRecord> Load(string @namespace) => Empty;

        public void Save(string @namespace, string key, VaultRecord record) { }

        public bool Delete(string @namespace, string key) => false;

        public void DeleteAll(string @namespace) { }
    }
}
