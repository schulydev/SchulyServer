using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Schuly.Sandbox;

namespace Schuly.Tests.Sandbox
{
    /// <summary>Msb with the CLI scripted: <c>respond</c> answers each command, and every call is recorded. No VM ever starts.</summary>
    public sealed class ScriptedMsb(Func<string[], ExecResult> respond, int maxSandboxes = 2) : Msb(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Sandbox:MaxSandboxes"] = maxSandboxes.ToString(), ["Sandbox:Image"] = "python:3.13.18-slim" }).Build(), NullLogger<Msb>.Instance)
    {
        private readonly List<string[]> _calls = [];

        public IReadOnlyList<string[]> Calls
        {
            get
            {
                lock (_calls)
                    return _calls.ToList();
            }
        }

        protected override Task<ExecResult> RunAsync(string[] args, TimeSpan timeout, CancellationToken cancellationToken, bool check)
        {
            lock (_calls)
                _calls.Add(args);
            var result = respond(args);
            if (check && result.ExitCode != 0)
                throw new InvalidOperationException($"msb {args[0]} failed");
            return Task.FromResult(result);
        }

        public static ExecResult Ok(string stdout = "") => new(0, stdout, "", false, false);

        public static ExecResult Fail(string stderr = "boom") => new(1, "", stderr, false, false);

        public static string List(params (string Name, string Status)[] sandboxes) => "[" + string.Join(",", sandboxes.Select(s => $"{{\"name\":\"{s.Name}\",\"status\":\"{s.Status}\"}}")) + "]";
    }

    public class SandboxSidecarTests
    {
        private const string Key = "0123456789abcdef0123456789abcdef-test";

        [Test]
        [Arguments("chat1", true)]
        [Arguments("0f8fad5b-d9cb-469f-a165-70867728950e", true)]
        [Arguments("--no-net", false)]
        [Arguments("-rf", false)]
        [Arguments("Chat1", false)]
        [Arguments("a b", false)]
        [Arguments("a/b", false)]
        [Arguments("abc\n", false)]
        [Arguments("", false)]
        [Arguments(null, false)]
        public async Task Ids_are_lowercase_slugs_only(string? id, bool expected)
        {
            await Assert.That(Msb.IsValidId(id)).IsEqualTo(expected);
        }

        [Test]
        public async Task Ids_are_at_most_63_characters()
        {
            await Assert.That(Msb.IsValidId(new string('a', 63))).IsTrue();
            await Assert.That(Msb.IsValidId(new string('a', 64))).IsFalse();
        }

        [Test]
        [Arguments("data/t.csv", "/workspace/data/t.csv")]
        [Arguments("report.pdf", "/workspace/report.pdf")]
        [Arguments("a//b", "/workspace/a/b")]
        [Arguments("a/./b", null)]
        [Arguments("../etc/passwd", null)]
        [Arguments("data/../../etc", null)]
        [Arguments("/etc/passwd", null)]
        [Arguments("--help", null)]
        [Arguments("dir/-rf", null)]
        [Arguments("a\\b", null)]
        [Arguments("a\nb", null)]
        [Arguments("a\0b", null)]
        [Arguments("", null)]
        [Arguments("   ", null)]
        public async Task Paths_stay_inside_the_workspace(string relative, string? expected)
        {
            await Assert.That(Msb.WorkspacePath(relative)).IsEqualTo(expected);
        }

        [Test]
        public async Task Overlong_paths_are_refused()
        {
            await Assert.That(Msb.WorkspacePath(new string('a', 513))).IsNull();
        }

        [Test]
        public async Task Key_comparison_is_exact()
        {
            await Assert.That(SandboxApi.KeyMatches(Key, Key)).IsTrue();
            await Assert.That(SandboxApi.KeyMatches(Key + "x", Key)).IsFalse();
            await Assert.That(SandboxApi.KeyMatches(Key[..^1], Key)).IsFalse();
            await Assert.That(SandboxApi.KeyMatches("", Key)).IsFalse();
            await Assert.That(SandboxApi.KeyMatches(null, Key)).IsFalse();
        }

        [Test]
        public async Task A_short_or_missing_key_stops_the_sidecar()
        {
            var shortKey = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Sandbox:ApiKey"] = new string('k', 31) }).Build();
            await Assert.That(() => SandboxApi.RequireKey(shortKey)).Throws<InvalidOperationException>();
            await Assert.That(() => SandboxApi.RequireKey(new ConfigurationBuilder().Build())).Throws<InvalidOperationException>();
        }

        [Test]
        public async Task Every_vm_gets_the_locked_down_flags_and_small_limits()
        {
            var msb = new ScriptedMsb(args => args[0] == "list" ? ScriptedMsb.Ok("[]") : ScriptedMsb.Ok());
            await Assert.That(await msb.EnsureAsync("chat1", CancellationToken.None)).IsTrue();

            var create = msb.Calls.Single(c => c[0] == "create");
            var flags = string.Join(' ', create);
            await Assert.That(create).Contains("--no-net");
            await Assert.That(flags).Contains("--memory 256M");
            await Assert.That(flags).Contains("--cpus 1");
            await Assert.That(flags).Contains("--root-disk 1G");
            await Assert.That(flags).Contains("--mount-owned /workspace:kind=disk,size=256M");
            await Assert.That(flags).Contains("--idle-timeout 10m");
            await Assert.That(flags).Contains("--max-duration 30m");
            await Assert.That(create[2..4]).IsEquivalentTo(new[] { "--name", "ssb-chat1" });
            // Hardened before anything else runs in it.
            await Assert.That(msb.Calls.Last()[^1]).IsEqualTo(Msb.HardenScript);
        }

        [Test]
        public async Task At_most_two_vms_run_and_a_stopped_one_counts_when_it_restarts()
        {
            var msb = new ScriptedMsb(args => args[0] == "list" ? ScriptedMsb.Ok(ScriptedMsb.List(("ssb-a", "Running"), ("ssb-b", "Running"), ("ssb-old", "Stopped"))) : ScriptedMsb.Ok());

            await Assert.That(await msb.EnsureAsync("old", CancellationToken.None)).IsFalse();
            await Assert.That(await msb.EnsureAsync("new", CancellationToken.None)).IsFalse();
            await Assert.That(msb.Calls.Any(c => c[0] is "start" or "create")).IsFalse();
        }

        [Test]
        public async Task A_vm_whose_hardening_fails_is_removed()
        {
            var msb = new ScriptedMsb(args => args switch
            {
                ["list", ..] => ScriptedMsb.Ok("[]"),
                ["exec", ..] => ScriptedMsb.Fail(),
                _ => ScriptedMsb.Ok(),
            });

            await Assert.That(() => msb.EnsureAsync("chat1", CancellationToken.None)).Throws<InvalidOperationException>();
            await Assert.That(msb.Calls.Any(c => c is ["remove", "--force", "--quiet", "ssb-chat1"])).IsTrue();
        }

        [Test]
        public async Task The_hardening_result_is_checked_not_assumed()
        {
            await Assert.That(Msb.HardenScript).Contains("-exec chmod ug-s {} + ;");
            await Assert.That(Msb.HardenScript).EndsWith("[ -z \"$(find / -xdev -type f -perm /6000 -print -quit)\" ] && [ ! -e /dev/kvm ]");
        }

        [Test]
        public async Task A_command_runs_as_the_guest_without_new_privileges_and_is_never_split()
        {
            var command = "echo $HOME; rm -rf / --no-preserve-root \"--name\" x";
            var args = Msb.ExecArguments("chat1", command, 30);

            await Assert.That(args[^1]).IsEqualTo(command);
            await Assert.That(args.Count(a => a == command)).IsEqualTo(1);
            await Assert.That(string.Join(' ', args)).Contains("--user 1000:1000");
            await Assert.That(string.Join(' ', args)).Contains("/usr/bin/setpriv --no-new-privs -- /bin/bash -c");
            await Assert.That(args[..2]).IsEquivalentTo(new[] { "exec", "ssb-chat1" });
        }

        [Test]
        public async Task A_file_is_written_by_root_to_a_random_name_and_moved_into_place_by_the_guest()
        {
            var msb = new ScriptedMsb(_ => ScriptedMsb.Ok());
            using var body = new MemoryStream("hello"u8.ToArray());

            var error = await msb.WriteFileAsync("chat1", "/workspace/a/b.txt", body, CancellationToken.None);

            await Assert.That(error).IsNull();
            var copy = msb.Calls.Single(c => c[0] == "copy");
            await Assert.That(copy[^1]).StartsWith("ssb-chat1:/workspace/.upload-");
            var chown = msb.Calls.Single(c => c.Contains("chown"));
            await Assert.That(chown).Contains("-h");
            var move = msb.Calls.Single(c => c.Contains("mkdir -p -- \"$1\" && mv -f -- \"$2\" \"$3\""));
            await Assert.That(move).Contains("--user");
            // The paths are positional arguments, never spliced into the script.
            await Assert.That(move[^3..]).IsEquivalentTo(new[] { "/workspace/a", copy[^1]["ssb-chat1:".Length..], "/workspace/a/b.txt" });
        }

        [Test]
        public async Task A_failed_move_cleans_up_the_staging_file()
        {
            var msb = new ScriptedMsb(args => args.Contains("mkdir -p -- \"$1\" && mv -f -- \"$2\" \"$3\"") ? ScriptedMsb.Fail("mv: not a directory") : ScriptedMsb.Ok());
            using var body = new MemoryStream("x"u8.ToArray());

            var error = await msb.WriteFileAsync("chat1", "/workspace/f/x.txt", body, CancellationToken.None);

            await Assert.That(error).IsEqualTo("mv: not a directory");
            await Assert.That(msb.Calls.Any(c => c.Contains("rm") && c[^1].StartsWith("/workspace/.upload-"))).IsTrue();
        }

        [Test]
        public async Task A_file_over_the_limit_or_not_regular_is_never_copied_out()
        {
            var tooBig = new ScriptedMsb(args => args[0] == "exec" ? ScriptedMsb.Ok($"{Msb.MaxFileBytes + 1}\n") : ScriptedMsb.Ok());
            await Assert.That(await tooBig.ReadFileAsync("chat1", "/workspace/big.bin", CancellationToken.None)).IsNull();
            await Assert.That(tooBig.Calls.Any(c => c[0] == "copy")).IsFalse();

            // The guest-side check ([ -f ] && [ ! -L ]) fails for a symlink or directory.
            var link = new ScriptedMsb(args => args[0] == "exec" ? ScriptedMsb.Fail() : ScriptedMsb.Ok());
            await Assert.That(await link.ReadFileAsync("chat1", "/workspace/link", CancellationToken.None)).IsNull();
            await Assert.That(link.Calls.Any(c => c[0] == "copy")).IsFalse();
            await Assert.That(link.Calls[0]).Contains("[ -f \"$1\" ] && [ ! -L \"$1\" ] && stat -c %s -- \"$1\"");
        }

        [Test]
        public async Task Only_a_single_regular_file_is_read_back_after_a_copy()
        {
            var directory = Directory.CreateTempSubdirectory("sandbox-test-");
            try
            {
                await Assert.That(Msb.SafeReadCopied(directory, 100)).IsNull();

                File.WriteAllText(Path.Combine(directory.FullName, "file"), "ok");
                await Assert.That(Msb.SafeReadCopied(directory, 100)).IsEquivalentTo("ok"u8.ToArray());
                await Assert.That(Msb.SafeReadCopied(directory, 1)).IsNull();

                File.WriteAllText(Path.Combine(directory.FullName, "second"), "x");
                await Assert.That(Msb.SafeReadCopied(directory, 100)).IsNull();
                File.Delete(Path.Combine(directory.FullName, "second"));
                File.Delete(Path.Combine(directory.FullName, "file"));

                Directory.CreateDirectory(Path.Combine(directory.FullName, "file"));
                await Assert.That(Msb.SafeReadCopied(directory, 100)).IsNull();
                Directory.Delete(Path.Combine(directory.FullName, "file"));

                var target = Path.Combine(Path.GetTempPath(), $"sandbox-secret-{Guid.NewGuid():N}");
                File.WriteAllText(target, "secret");
                try
                {
                    File.CreateSymbolicLink(Path.Combine(directory.FullName, "file"), target);
                }
                catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
                {
                    // Windows without developer mode cannot create symlinks; CI on Linux covers this case.
                    return;
                }
                finally
                {
                    if (!File.Exists(Path.Combine(directory.FullName, "file")))
                        File.Delete(target);
                }
                await Assert.That(Msb.SafeReadCopied(directory, 100)).IsNull();
                File.Delete(target);
            }
            finally
            {
                directory.Delete(recursive: true);
            }
        }

        [Test]
        public async Task Output_is_read_to_the_end_but_capped()
        {
            var (text, truncated) = await Msb.ReadCappedAsync(new StringReader(new string('x', Msb.MaxOutputChars + 10_000)));
            await Assert.That(text.Length).IsEqualTo(Msb.MaxOutputChars);
            await Assert.That(truncated).IsTrue();
        }

        [Test]
        public async Task Sweeping_removes_only_stopped_schuly_sandboxes()
        {
            var msb = new ScriptedMsb(args => args[0] == "list" ? ScriptedMsb.Ok(ScriptedMsb.List(("ssb-a", "Running"), ("ssb-b", "Stopped"), ("other-c", "Stopped"))) : ScriptedMsb.Ok());
            await msb.RemoveStoppedAsync(CancellationToken.None);
            var removed = msb.Calls.Where(c => c[0] == "remove").Select(c => c[^1]).ToList();
            await Assert.That(removed).IsEquivalentTo(new[] { "ssb-b" });
            await Assert.That(msb.Calls.First(c => c[0] == "list")).Contains(Msb.Label);
        }

        private static async Task<(WebApplication App, HttpClient Http, ScriptedMsb Msb)> StartAsync(Func<string[], ExecResult> respond)
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            var msb = new ScriptedMsb(respond);
            builder.Services.AddSingleton<Msb>(msb);
            var app = builder.Build();
            SandboxApi.Map(app, Key);
            await app.StartAsync();
            return (app, app.GetTestClient(), msb);
        }

        private static HttpRequestMessage Request(HttpMethod method, string path, string? key, HttpContent? content = null)
        {
            var request = new HttpRequestMessage(method, path) { Content = content };
            if (key is not null)
                request.Headers.Add(SandboxApi.KeyHeader, key);
            return request;
        }

        [Test]
        public async Task The_api_needs_the_key_on_every_route()
        {
            var (app, http, msb) = await StartAsync(_ => ScriptedMsb.Ok("[]"));
            await using var _ = app;

            foreach (var key in new string?[] { null, "", "wrong", Key[..^1], Key.ToUpperInvariant() })
            {
                using var exec = await http.SendAsync(Request(HttpMethod.Post, "/sandboxes/chat1/exec", key, JsonContent.Create(new { command = "id" })));
                await Assert.That(exec.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
                using var delete = await http.SendAsync(Request(HttpMethod.Delete, "/sandboxes/chat1/", key));
                await Assert.That(delete.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
            }
            await Assert.That(msb.Calls).IsEmpty();
        }

        [Test]
        public async Task The_api_refuses_bad_ids_paths_and_commands_before_msb_runs()
        {
            var (app, http, msb) = await StartAsync(_ => ScriptedMsb.Ok("[]"));
            await using var _ = app;

            using var badId = await http.SendAsync(Request(HttpMethod.Post, "/sandboxes/Bad_Id/exec", Key, JsonContent.Create(new { command = "id" })));
            await Assert.That(badId.StatusCode).IsEqualTo(HttpStatusCode.BadRequest);
            using var flagId = await http.SendAsync(Request(HttpMethod.Post, "/sandboxes/--no-net/exec", Key, JsonContent.Create(new { command = "id" })));
            await Assert.That(flagId.StatusCode).IsEqualTo(HttpStatusCode.BadRequest);
            using var badPath = await http.SendAsync(Request(HttpMethod.Get, "/sandboxes/chat1/files?path=../../etc/passwd", Key));
            await Assert.That(badPath.StatusCode).IsEqualTo(HttpStatusCode.BadRequest);
            using var noCommand = await http.SendAsync(Request(HttpMethod.Post, "/sandboxes/chat1/exec", Key, JsonContent.Create(new { command = " " })));
            await Assert.That(noCommand.StatusCode).IsEqualTo(HttpStatusCode.BadRequest);
            using var longCommand = await http.SendAsync(Request(HttpMethod.Post, "/sandboxes/chat1/exec", Key, JsonContent.Create(new { command = new string('x', Msb.MaxCommandChars + 1) })));
            await Assert.That(longCommand.StatusCode).IsEqualTo(HttpStatusCode.BadRequest);
            await Assert.That(msb.Calls).IsEmpty();
        }

        [Test]
        public async Task A_command_runs_with_the_key_and_the_timeout_is_clamped()
        {
            var (app, http, msb) = await StartAsync(args => args[0] switch
            {
                "list" => ScriptedMsb.Ok("[]"),
                "exec" when args.Contains("/bin/bash") => ScriptedMsb.Ok("42\n"),
                _ => ScriptedMsb.Ok(),
            });
            await using var _ = app;

            using var response = await http.SendAsync(Request(HttpMethod.Post, "/sandboxes/chat1/exec", Key, JsonContent.Create(new { command = "echo 42", timeoutSeconds = 9999 })));
            await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.OK);
            var result = await response.Content.ReadFromJsonAsync<ExecResult>();
            await Assert.That(result!.Stdout).IsEqualTo("42\n");
            var run = msb.Calls.Single(c => c.Contains("/bin/bash"));
            await Assert.That(run).Contains($"{Msb.MaxExecSeconds}s");
        }

        [Test]
        public async Task A_full_sidecar_answers_429()
        {
            var (app, http, _) = await StartAsync(args => args[0] == "list" ? ScriptedMsb.Ok(ScriptedMsb.List(("ssb-a", "Running"), ("ssb-b", "Running"))) : ScriptedMsb.Ok());
            await using var _1 = app;

            using var response = await http.SendAsync(Request(HttpMethod.Post, "/sandboxes/chat1/exec", Key, JsonContent.Create(new { command = "id" })));
            await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.TooManyRequests);
        }
    }
}
