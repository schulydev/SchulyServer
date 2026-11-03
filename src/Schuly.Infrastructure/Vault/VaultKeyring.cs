using System.Security.Cryptography;
using System.Text;

namespace Schuly.Infrastructure.Vault
{
    public sealed class VaultKeyring : IDisposable
    {
        public const int MasterKeySize = 32;

        private readonly byte[] _master;
        private readonly byte[]? _previousMaster;

        public VaultKeyring(byte[] master, byte[]? previousMaster = null)
        {
            if (master is not { Length: MasterKeySize })
                throw new ArgumentException($"Vault master key must be {MasterKeySize} bytes.", nameof(master));
            if (previousMaster is not null and not { Length: MasterKeySize })
                throw new ArgumentException($"Previous vault master key must be {MasterKeySize} bytes.", nameof(previousMaster));
            _master = (byte[])master.Clone();
            _previousMaster = (byte[]?)previousMaster?.Clone();
        }

        public static VaultKeyring Ephemeral() => new(RandomNumberGenerator.GetBytes(MasterKeySize));

        public byte[] DeriveKey(string @namespace) => Derive(_master, @namespace);

        /// <summary>The namespace key under the previous master key, or null when no rotation is in progress.</summary>
        public byte[]? DerivePreviousKey(string @namespace) => _previousMaster is null ? null : Derive(_previousMaster, @namespace);

        private static byte[] Derive(byte[] master, string @namespace)
        {
            ArgumentException.ThrowIfNullOrEmpty(@namespace);
            return HKDF.DeriveKey(
                HashAlgorithmName.SHA256,
                ikm: master,
                outputLength: 32,
                salt: null,
                info: Encoding.UTF8.GetBytes($"schuly-vault:{@namespace}"));
        }

        public void Dispose()
        {
            CryptographicOperations.ZeroMemory(_master);
            if (_previousMaster is not null)
                CryptographicOperations.ZeroMemory(_previousMaster);
        }
    }
}
