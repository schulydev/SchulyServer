using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Schuly.Plugin.Abstractions;

namespace Schuly.Infrastructure.Vault
{
    public interface IPluginVaultFactory
    {
        IPluginVault GetVault(string @namespace);
    }

    public sealed class PluginVaultFactory(VaultKeyring keyring, IVaultStore store, ILoggerFactory? loggerFactory = null) : IPluginVaultFactory
    {
        private readonly ConcurrentDictionary<string, IPluginVault> _vaults = new(StringComparer.Ordinal);

        public IPluginVault GetVault(string @namespace)
        {
            ArgumentException.ThrowIfNullOrEmpty(@namespace);
            return _vaults.GetOrAdd(@namespace, ns => new PersistentVault(ns, keyring.DeriveKey(ns), store, loggerFactory?.CreateLogger("Schuly.Vault")));
        }
    }

    public static class VaultServiceCollectionExtensions
    {
        public const string HostNamespace = "host";

        public static IServiceCollection AddSchulyVault(this IServiceCollection services, IConfiguration configuration, bool isDevelopment)
        {
            // Resolved eagerly so a misconfigured production deployment fails fast at
            // startup, before the app runs, rather than silently losing every plugin
            // credential on the next restart.
            var keyring = new VaultKeyring(ResolveMasterKey(configuration, isDevelopment, out var warning), ResolvePreviousMasterKey(configuration));

            services.AddSingleton(sp =>
            {
                if (warning is not null)
                    sp.GetRequiredService<ILoggerFactory>().CreateLogger("Schuly.Vault").LogWarning("{Warning}", warning);
                return keyring;
            });

            services.TryAddSingleton<IVaultStore, DbVaultStore>();
            services.AddSingleton<IPluginVaultFactory, PluginVaultFactory>();
            services.AddSingleton<IPluginVault>(sp =>
                sp.GetRequiredService<IPluginVaultFactory>().GetVault(HostNamespace));
            return services;
        }

        private static byte[]? ResolvePreviousMasterKey(IConfiguration configuration)
        {
            var configured = configuration["Vault:PreviousMasterKey"];
            if (string.IsNullOrWhiteSpace(configured))
                return null;

            try
            {
                var decoded = Convert.FromBase64String(configured);
                if (decoded.Length == VaultKeyring.MasterKeySize)
                    return decoded;
            }
            catch (FormatException)
            {
            }

            throw new InvalidOperationException("Vault:PreviousMasterKey is not a valid base64-encoded 32-byte key.");
        }

        /// <summary>Moves vault entries from the previous master key to the current one. Runs before anything reads the vault; does nothing without Vault:PreviousMasterKey.</summary>
        public static void RotateVaultKey(this IServiceProvider services)
        {
            var result = VaultKeyRotator.Rotate(services.GetRequiredService<VaultKeyring>(), services.GetRequiredService<IVaultStore>());
            if (result.Rotated > 0 || result.Unreadable > 0)
                services.GetRequiredService<ILoggerFactory>().CreateLogger("Schuly.Vault").LogInformation("Vault key rotation: {Rotated} entries moved to the current key, {Unreadable} readable with neither key", result.Rotated, result.Unreadable);
        }

        private static byte[] ResolveMasterKey(IConfiguration configuration, bool isDevelopment, out string? warning)
        {
            warning = null;
            var configured = configuration["Vault:MasterKey"];

            if (string.IsNullOrWhiteSpace(configured))
            {
                if (!isDevelopment)
                    throw new InvalidOperationException("Vault:MasterKey is not configured. Generate a 32-byte base64 key (openssl rand -base64 32) and set Vault__MasterKey; without it every stored plugin credential is lost on restart.");

                warning = "Vault:MasterKey is not configured; using an ephemeral development key. Stored plugin credentials will not survive a restart.";
                return RandomKey();
            }

            byte[]? decoded;
            try
            {
                decoded = Convert.FromBase64String(configured);
            }
            catch (FormatException)
            {
                decoded = null;
            }

            if (decoded is not { Length: VaultKeyring.MasterKeySize })
            {
                if (!isDevelopment)
                    throw new InvalidOperationException("Vault:MasterKey is not a valid base64-encoded 32-byte key. Generate one with: openssl rand -base64 32");

                warning = "Vault:MasterKey is not a valid base64-encoded 32-byte key; using an ephemeral development key. Stored plugin credentials will not survive a restart.";
                return RandomKey();
            }

            return decoded;
        }

        private static byte[] RandomKey() => RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize);
    }
}
