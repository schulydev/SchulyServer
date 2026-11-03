using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schuly.Domain;
using Schuly.Plugin.Abstractions;

namespace Schuly.Infrastructure.Vault
{
    /// <summary>
    /// Postgres-backed <see cref="IVaultStore"/>. Uses synchronous EF Core APIs
    /// throughout — <see cref="IPluginVault"/> is a synchronous interface, so this must
    /// not sync-over-async on the underlying EF calls. Each operation resolves its own
    /// scoped <see cref="SchulyDbContext"/> from a fresh service scope.
    /// </summary>
    public sealed class DbVaultStore(IServiceScopeFactory scopeFactory) : IVaultStore
    {
        public IReadOnlyCollection<string> Namespaces()
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            return db.VaultEntries.AsNoTracking().Select(e => e.PluginName).Distinct().ToList();
        }

        public IReadOnlyDictionary<string, VaultRecord> Load(string @namespace)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();

            return db.VaultEntries.AsNoTracking()
                .Where(e => e.PluginName == @namespace)
                .ToList()
                .ToDictionary(e => e.Key, e => new VaultRecord(e.Nonce, e.Tag, e.Ciphertext, e.KeyVersion), StringComparer.Ordinal);
        }

        public void Save(string @namespace, string key, VaultRecord record)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();

            var existing = db.VaultEntries.FirstOrDefault(e => e.PluginName == @namespace && e.Key == key);
            if (existing is not null)
            {
                existing.Nonce = record.Nonce;
                existing.Tag = record.Tag;
                existing.Ciphertext = record.Ciphertext;
                existing.KeyVersion = record.KeyVersion;
            }
            else
            {
                db.VaultEntries.Add(new VaultEntry
                {
                    PluginName = @namespace,
                    Key = key,
                    Nonce = record.Nonce,
                    Tag = record.Tag,
                    Ciphertext = record.Ciphertext,
                    KeyVersion = record.KeyVersion,
                });
            }

            db.SaveChanges();
        }

        public bool Delete(string @namespace, string key)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();

            var existing = db.VaultEntries.FirstOrDefault(e => e.PluginName == @namespace && e.Key == key);
            if (existing is null)
                return false;

            db.VaultEntries.Remove(existing);
            db.SaveChanges();
            return true;
        }

        public void DeleteAll(string @namespace)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();

            var rows = db.VaultEntries.Where(e => e.PluginName == @namespace).ToList();
            if (rows.Count == 0)
                return;

            db.VaultEntries.RemoveRange(rows);
            db.SaveChanges();
        }
    }
}
