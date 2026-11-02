using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Schuly.Sandbox
{
    public record ExecResult(int ExitCode, string Stdout, string Stderr, bool Truncated, bool TimedOut);

    /// <summary>
    /// Drives the microsandbox CLI (<c>msb</c>), ported from Tessaly.Sandbox with Schuly's smaller limits. Every sandbox gets the same fixed, locked-down flags; callers only
    /// choose which sandbox (by id) and what runs inside it. Arguments go through ArgumentList, never a shell, so an id, path or command cannot inject further msb options or
    /// sidecar-side commands.
    /// </summary>
    public partial class Msb(IConfiguration configuration, ILogger<Msb> logger)
    {
        public const string Workspace = "/workspace";
        public const int MaxOutputChars = 64_000;
        public const int MaxFileBytes = 25 * 1024 * 1024;
        public const int MaxExecSeconds = 120;
        public const int MaxCommandChars = 16_000;
        public const string Label = "schuly=sandbox";
        public const string GuestUser = "1000:1000";

        /// <summary>
        /// The isolation boundary. Changing any of these changes what a model-controlled command can do, and how much of a shared VPS it can take.
        /// Two VMs at 256 MB each stay well inside the container's 1 GB, which also holds the sidecar itself and msb.
        /// </summary>
        public static readonly string[] CreateFlags =
        [
            "--no-net",                                            // the default is "public internet allowed" - never omit
            "--memory", "256M",
            "--cpus", "1",
            "--root-disk", "1G",                                   // the default overlay could grow to fill the sidecar disk
            "--mount-owned", $"{Workspace}:kind=disk,size=256M",   // quota'd, removed with the sandbox
            "--idle-timeout", "10m",
            "--max-duration", "30m",
            "--label", Label,
            "--quiet",
        ];

        // The image built into the sidecar (Python with pandas and co., see the Dockerfile), loaded into msb once.
        private const string BuiltInImageArchive = "/opt/sandbox-image.tar";
        private const string BuiltInImage = "schuly-sandbox";
        private Task? _builtInImageLoaded;

        private string Image => configuration["Sandbox:Image"] ?? (File.Exists(BuiltInImageArchive) ? BuiltInImage : "python:3.13.18-slim");

        private int MaxSandboxes => Math.Clamp(configuration.GetValue("Sandbox:MaxSandboxes", 2), 1, 8);

        // One lock for every create, start and sweep: boots take about a second and are rare at two VMs.
        private readonly SemaphoreSlim _ensureLock = new(1, 1);

        public static bool IsValidId(string? id) => id is not null && IdRegex().IsMatch(id);

        /// <summary>A path inside the workspace, or null. Rejects absolute paths, '.', '..', segments starting with '-', backslashes, control characters and overlong paths.</summary>
        public static string? WorkspacePath(string? relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || relative.Length > 512 || relative.StartsWith('/') || relative.Contains('\\') || relative.Any(char.IsControl))
                return null;
            var segments = relative.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0 || segments.Any(segment => segment is "." or ".." || segment.StartsWith('-')))
                return null;
            return $"{Workspace}/{string.Join('/', segments)}";
        }

        public static string Name(string id) => $"ssb-{id}";

        /// <summary>Creates the sandbox, or starts it after an idle stop. False when the sandbox limit is reached.</summary>
        public async Task<bool> EnsureAsync(string id, CancellationToken cancellationToken)
        {
            await _ensureLock.WaitAsync(cancellationToken);
            try
            {
                var sandboxes = await ListAsync(cancellationToken);
                var status = sandboxes.GetValueOrDefault(Name(id));
                if (status == "Running")
                    return true;

                // Restarting a stopped sandbox counts against the limit just like creating one.
                if (sandboxes.Values.Count(value => value == "Running") >= MaxSandboxes)
                    return false;

                if (status is not null)
                {
                    await RunAsync(["start", Name(id)], TimeSpan.FromSeconds(60), cancellationToken, check: true);
                    await HardenOrRemoveAsync(id, cancellationToken);
                    return true;
                }

                if (_builtInImageLoaded is { IsFaulted: true })
                    _builtInImageLoaded = null;
                if (Image == BuiltInImage)
                    await (_builtInImageLoaded ??= RunAsync(["load", "--input", BuiltInImageArchive, "--tag", BuiltInImage, "--quiet"], TimeSpan.FromMinutes(5), CancellationToken.None, check: true));
                await RunAsync(["create", Image, "--name", Name(id), .. CreateFlags], TimeSpan.FromSeconds(120), cancellationToken, check: true);
                await HardenOrRemoveAsync(id, cancellationToken);
                logger.LogInformation("Created sandbox {Name}", Name(id));
                return true;
            }
            finally
            {
                _ensureLock.Release();
            }
        }

        /// <summary>
        /// Runs as guest root once per boot, before any command of the model. The model's commands run as uid 1000, but should one ever reach root, it finds no setuid binaries
        /// left to abuse and no /dev/kvm (guest root could otherwise start nested VMs and reach the host KVM's nested-virtualisation code). /dev is rebuilt at every boot, hence on
        /// start as well as create. A disk-backed volume cannot be created with an owner, so the workspace is handed to the user here too.
        /// </summary>
        /// <remarks>The strip itself may report a harmless error (a file it cannot read), so success is judged by the outcome: the command fails unless no setuid or setgid file and no /dev/kvm is left.</remarks>
        public static readonly string HardenScript =
            "find / -xdev -type f -perm /6000 -exec chmod ug-s {} + ; "
            + "rm -f /dev/kvm && chown " + GuestUser + " " + Workspace
            + " && [ -z \"$(find / -xdev -type f -perm /6000 -print -quit)\" ] && [ ! -e /dev/kvm ]";

        private Task HardenAsync(string id, CancellationToken cancellationToken) =>
            RunAsync(["exec", Name(id), "--", "/bin/sh", "-c", HardenScript], TimeSpan.FromSeconds(60), cancellationToken, check: true);

        /// <summary>Hardens the sandbox, or removes it when that fails: a running sandbox counts as ready, so one left behind unhardened would be handed to the next request as it is.</summary>
        private async Task HardenOrRemoveAsync(string id, CancellationToken cancellationToken)
        {
            try
            {
                await HardenAsync(id, cancellationToken);
            }
            catch
            {
                logger.LogWarning("Hardening sandbox {Name} failed; removing it", Name(id));
                await RunAsync(["remove", "--force", "--quiet", Name(id)], TimeSpan.FromSeconds(60), CancellationToken.None, check: false);
                throw;
            }
        }

        /// <summary>The msb arguments of one command: as the guest user, in the workspace, under no-new-privs, so nothing it starts can gain privileges even through a setuid binary.</summary>
        public static string[] ExecArguments(string id, string command, int timeoutSeconds) =>
            ["exec", Name(id), "--timeout", $"{timeoutSeconds}s", "--user", GuestUser, "--workdir", Workspace, "--env", $"HOME={Workspace}", "--env", "MPLBACKEND=Agg", "--",
                "/usr/bin/setpriv", "--no-new-privs", "--", "/bin/bash", "-c", command];

        public async Task<ExecResult> ExecAsync(string id, string command, int timeoutSeconds, CancellationToken cancellationToken)
        {
            var result = await RunAsync(ExecArguments(id, command, timeoutSeconds), TimeSpan.FromSeconds(timeoutSeconds + 15), cancellationToken, check: false);
            var timedOut = result.TimedOut || result.Stderr.Contains("exec timed out", StringComparison.Ordinal);
            return result with { TimedOut = timedOut };
        }

        /// <summary>Writes a file into the workspace. Returns null on success, or why the file could not be placed.</summary>
        public async Task<string?> WriteFileAsync(string id, string path, Stream content, CancellationToken cancellationToken)
        {
            var temp = Directory.CreateTempSubdirectory("upload-");
            try
            {
                var local = Path.Combine(temp.FullName, "file");
                await using (var file = File.Create(local))
                    await CopyCappedAsync(content, file, cancellationToken);

                // msb copies as guest root, and the guest controls the workspace: a planted symlink (workspace/evil -> /etc) would steer a root write anywhere. So root only writes a
                // fresh random name directly in the workspace, and the guest user moves it into place with its own rights.
                var staging = $"{Workspace}/.upload-{Guid.NewGuid():N}";
                var directory = path[..path.LastIndexOf('/')];
                await RunAsync(["copy", "--quiet", local, $"{Name(id)}:{staging}"], TimeSpan.FromSeconds(60), cancellationToken, check: true);
                await RunAsync(["exec", Name(id), "--", "chown", "-h", GuestUser, "--", staging], TimeSpan.FromSeconds(30), cancellationToken, check: true);
                var move = await RunAsync(["exec", Name(id), "--user", GuestUser, "--", "/bin/sh", "-c", "mkdir -p -- \"$1\" && mv -f -- \"$2\" \"$3\"", "sh", directory, staging, path], TimeSpan.FromSeconds(30), cancellationToken, check: false);
                if (move.ExitCode != 0)
                {
                    await RunAsync(["exec", Name(id), "--", "rm", "-f", "--", staging], TimeSpan.FromSeconds(30), cancellationToken, check: false);
                    return Trim(move.Stderr.Trim(), 300);
                }
                return null;
            }
            finally
            {
                temp.Delete(recursive: true);
            }
        }

        /// <summary>
        /// Copies a file out of the sandbox. The guest controls what sits at that path, so the copy lands in a fresh private directory and anything but a plain regular file (a symlink
        /// to a sidecar file such as /proc/self/environ, a directory, a device) is refused before it is read.
        /// </summary>
        public async Task<byte[]?> ReadFileAsync(string id, string path, CancellationToken cancellationToken)
        {
            // Checked inside the guest first, so a file over the limit is never copied onto the sidecar's disk. The guest could still swap the file afterwards; the check after the copy stays for that.
            var size = await RunAsync(["exec", Name(id), "--user", GuestUser, "--", "/bin/sh", "-c", "[ -f \"$1\" ] && [ ! -L \"$1\" ] && stat -c %s -- \"$1\"", "sh", path], TimeSpan.FromSeconds(30), cancellationToken, check: false);
            if (size.ExitCode != 0 || !long.TryParse(size.Stdout.Trim(), out var bytes) || bytes > MaxFileBytes)
                return null;

            var temp = Directory.CreateTempSubdirectory("download-");
            try
            {
                var local = Path.Combine(temp.FullName, "file");
                var copy = await RunAsync(["copy", "--quiet", $"{Name(id)}:{path}", local], TimeSpan.FromSeconds(60), cancellationToken, check: false);
                if (copy.ExitCode != 0)
                    return null;
                return SafeReadCopied(temp, MaxFileBytes);
            }
            finally
            {
                temp.Delete(recursive: true);
            }
        }

        /// <summary>The bytes of the single regular file msb copied into <paramref name="directory"/>, or null when it holds anything else: a symlink, a directory, several entries, or too much.</summary>
        public static byte[]? SafeReadCopied(DirectoryInfo directory, long maxBytes)
        {
            var entries = directory.GetFileSystemInfos();
            if (entries.Length != 1 || entries[0] is not FileInfo info || info.LinkTarget is not null || info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length > maxBytes)
                return null;
            return File.ReadAllBytes(info.FullName);
        }

        public Task DeleteAsync(string id, CancellationToken cancellationToken) =>
            RunAsync(["remove", "--force", "--quiet", Name(id)], TimeSpan.FromSeconds(60), cancellationToken, check: false);

        /// <summary>
        /// Removes every sandbox that has stopped (after its idle timeout or max duration) together with its disks. A workspace therefore lives only while its conversation is
        /// active; the backend also removes it when a reply ends, so this is the backstop.
        /// </summary>
        public async Task RemoveStoppedAsync(CancellationToken cancellationToken)
        {
            await _ensureLock.WaitAsync(cancellationToken);
            try
            {
                foreach (var (name, status) in await ListAsync(cancellationToken))
                    if (status != "Running")
                        await RunAsync(["remove", "--force", "--quiet", name], TimeSpan.FromSeconds(60), cancellationToken, check: false);
            }
            finally
            {
                _ensureLock.Release();
            }
        }

        private async Task<Dictionary<string, string>> ListAsync(CancellationToken cancellationToken)
        {
            var result = await RunAsync(["list", "--label", Label, "--format", "json"], TimeSpan.FromSeconds(30), cancellationToken, check: true);
            using var json = JsonDocument.Parse(string.IsNullOrWhiteSpace(result.Stdout) ? "[]" : result.Stdout);
            return json.RootElement.EnumerateArray().Where(s => s.GetProperty("name").GetString()?.StartsWith("ssb-", StringComparison.Ordinal) == true).ToDictionary(
                sandbox => sandbox.GetProperty("name").GetString()!,
                sandbox => sandbox.GetProperty("status").GetString() ?? string.Empty);
        }

        /// <summary>Runs one msb command. Virtual so tests can stand in for the CLI.</summary>
        protected virtual Task<ExecResult> RunAsync(string[] args, TimeSpan timeout, CancellationToken cancellationToken, bool check) => RunMsbAsync(args, timeout, cancellationToken, check);

        private static async Task<ExecResult> RunMsbAsync(string[] args, TimeSpan timeout, CancellationToken cancellationToken, bool check)
        {
            var startInfo = new ProcessStartInfo("msb")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                UseShellExecute = false,
            };
            foreach (var arg in args)
                startInfo.ArgumentList.Add(arg);

            using var process = Process.Start(startInfo)!;
            process.StandardInput.Close();
            var stdout = ReadCappedAsync(process.StandardOutput);
            var stderr = ReadCappedAsync(process.StandardError);

            using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutSource.CancelAfter(timeout);
            var timedOut = false;
            try
            {
                await process.WaitForExitAsync(timeoutSource.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                timedOut = !cancellationToken.IsCancellationRequested;
                if (!timedOut)
                    throw;
            }

            var (outText, outTruncated) = await stdout;
            var (errText, errTruncated) = await stderr;
            var result = new ExecResult(timedOut ? -1 : process.ExitCode, outText, errText, outTruncated || errTruncated, timedOut);
            if (check && result.ExitCode != 0)
                throw new InvalidOperationException($"msb {args[0]} failed ({result.ExitCode})");
            return result;
        }

        /// <summary>Keeps reading to the end so the process never blocks on a full pipe, but only keeps <see cref="MaxOutputChars"/>.</summary>
        public static async Task<(string Text, bool Truncated)> ReadCappedAsync(TextReader reader)
        {
            var text = new StringBuilder();
            var truncated = false;
            var buffer = new char[8192];
            int read;
            while ((read = await reader.ReadAsync(buffer)) > 0)
            {
                var room = MaxOutputChars - text.Length;
                if (read > room)
                    truncated = true;
                text.Append(buffer, 0, Math.Max(0, Math.Min(read, room)));
            }
            return (text.ToString(), truncated);
        }

        /// <summary>Copies at most <see cref="MaxFileBytes"/>; a longer body is refused rather than written in part.</summary>
        private static async Task CopyCappedAsync(Stream source, Stream target, CancellationToken cancellationToken)
        {
            var buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
            {
                total += read;
                if (total > MaxFileBytes)
                    throw new BadHttpRequestException("File too large.", StatusCodes.Status413PayloadTooLarge);
                await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
        }

        private static string Trim(string text, int max) => text.Length <= max ? text : text[..max];

        // \z, not $: in .NET "$" also matches before a trailing newline, so "abc\n" would pass.
        [GeneratedRegex(@"^[a-z0-9][a-z0-9-]{0,62}\z")]
        private static partial Regex IdRegex();
    }
}
