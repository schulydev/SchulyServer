using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace Schuly.API.Plugins
{
    public sealed record PluginManifest
    {
        public string Name { get; init; } = "";
        public string Version { get; init; } = "";
        public string Dll { get; init; } = "";
        public IReadOnlyList<string> Files { get; init; } = [];
    }

    /// <summary>
    /// Owns the plugins directory: lists installed plugins, downloads + extracts
    /// registry artifacts, and removes them. Installs are tracked by a per-plugin
    /// <c>&lt;name&gt;.plugin.json</c> manifest so removal deletes exactly what was added —
    /// and shared dependency DLLs are reference-counted so removing one plugin can't
    /// pull a dependency still used by another.
    /// </summary>
    public sealed class PluginStore
    {
        private const string ManifestSuffix = ".plugin.json";
        private static readonly JsonSerializerOptions JsonOptions =
            new(JsonSerializerDefaults.Web) { WriteIndented = true };

        public string Directory { get; }

        public PluginStore(string pluginDirectory)
        {
            Directory = pluginDirectory;
            System.IO.Directory.CreateDirectory(Directory);
        }

        public IReadOnlyList<PluginManifest> List()
        {
            var manifests = new List<PluginManifest>();
            foreach (var path in System.IO.Directory.GetFiles(Directory, "*" + ManifestSuffix))
            {
                try
                {
                    var manifest = JsonSerializer.Deserialize<PluginManifest>(File.ReadAllText(path), JsonOptions);
                    if (manifest is not null && !string.IsNullOrWhiteSpace(manifest.Name))
                        manifests.Add(manifest);
                }
                catch { }
            }
            return manifests;
        }

        public PluginManifest? Find(string name) =>
            List().FirstOrDefault(m => m.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

        public string MainDllPath(PluginManifest manifest) => Path.Combine(Directory, manifest.Dll);

        public async Task<PluginManifest> InstallAsync(RegistryPlugin entry, PluginRegistryClient registry, CancellationToken ct = default)
        {
            // Downloaded and checked before anything is removed, so a bad download leaves the installed version in place.
            var dll = SafeArtifactName(entry.Dll);
            var dllBytes = await registry.DownloadArtifactAsync(dll, ct);
            VerifyHash(dll, dllBytes, entry.Sha256);

            byte[]? zipBytes = null;
            if (!string.IsNullOrWhiteSpace(entry.Deps))
            {
                var deps = SafeArtifactName(entry.Deps);
                zipBytes = await registry.DownloadArtifactAsync(deps, ct);
                VerifyHash(deps, zipBytes, entry.DepsSha256);
            }

            // Clean any previous version's files first so a downgrade/upgrade leaves no
            // stale -v<old>.dll behind that would be discovered alongside the new one.
            Remove(entry.Name);

            var files = new List<string>();

            await File.WriteAllBytesAsync(Path.Combine(Directory, dll), dllBytes, ct);
            files.Add(dll);

            if (zipBytes is not null)
            {
                using var zip = new ZipArchive(new MemoryStream(zipBytes), ZipArchiveMode.Read);
                foreach (var zipEntry in zip.Entries)
                {
                    if (string.IsNullOrEmpty(zipEntry.Name)) // directory entry
                        continue;
                    var name = SafeArtifactName(zipEntry.Name);
                    var dest = Path.Combine(Directory, name);
                    zipEntry.ExtractToFile(dest, overwrite: true);
                    files.Add(name);
                }
            }

            var manifest = new PluginManifest
            {
                Name = entry.Name,
                Version = entry.Version,
                Dll = entry.Dll,
                Files = files,
            };
            File.WriteAllText(ManifestPath(entry.Name), JsonSerializer.Serialize(manifest, JsonOptions));
            return manifest;
        }

        public void Remove(string name)
        {
            var manifest = Find(name);
            if (manifest is null)
                return;

            var keep = List()
                .Where(m => !m.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                .SelectMany(m => m.Files)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var file in manifest.Files)
            {
                if (keep.Contains(file))
                    continue; // shared with another plugin — leave it
                TryDelete(Path.Combine(Directory, file));
            }

            TryDelete(ManifestPath(name));
        }

        /// <summary>Entries without a hash (older index, pinned version) are installed unchecked; the index doesn't list hashes for those.</summary>
        private static void VerifyHash(string file, byte[] bytes, string? expected)
        {
            if (string.IsNullOrWhiteSpace(expected))
                return;
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Plugin artifact '{file}' does not match the SHA-256 hash in the registry index");
        }

        private string ManifestPath(string name) => Path.Combine(Directory, name + ManifestSuffix);

        private static string SafeArtifactName(string file)
        {
            if (string.IsNullOrWhiteSpace(file) || Path.GetFileName(file) != file || file is "." or "..")
                throw new InvalidOperationException($"Invalid plugin artifact name '{file}'");
            return file;
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch { /* best effort — a DLL may still be mapped until its load context unloads */ }
        }
    }
}
