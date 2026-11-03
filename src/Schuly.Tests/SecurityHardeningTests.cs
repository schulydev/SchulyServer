using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Schuly.API.Extensions;
using Schuly.API.Plugins;
using Schuly.API.Security;
using Schuly.Domain;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Security;
using Schuly.Infrastructure.Vault;
using Toamaisutaa.Abstractions;

namespace Schuly.Tests
{
    public class SecurityHardeningTests
    {
        private static ServiceProvider NewDb()
        {
            var dbName = Guid.NewGuid().ToString();
            var services = new ServiceCollection();
            services.AddDbContext<SchulyDbContext>(o => o.UseInMemoryDatabase(dbName));
            return services.BuildServiceProvider();
        }

        private static HttpContext Request(string method, string path, string ip)
        {
            var context = new DefaultHttpContext();
            context.Request.Method = method;
            context.Request.Path = path;
            context.Connection.RemoteIpAddress = IPAddress.Parse(ip);
            return context;
        }

        [Test]
        public async Task Anonymous_login_is_capped_per_ip_and_other_clients_are_unaffected()
        {
            using var limiter = RateLimitingExtensions.AnonymousLoginIpLimiter(perMinute: 2);
            const string login = "/api/plugins/schulware/stateless/login";

            await Assert.That(limiter.AttemptAcquire(Request("POST", login, "203.0.113.1")).IsAcquired).IsTrue();
            await Assert.That(limiter.AttemptAcquire(Request("POST", login, "203.0.113.1")).IsAcquired).IsTrue();
            await Assert.That(limiter.AttemptAcquire(Request("POST", login, "203.0.113.1")).IsAcquired).IsFalse();
            await Assert.That(limiter.AttemptAcquire(Request("POST", "/API/Plugins/OdaOrg/Stateless/Data", "203.0.113.1")).IsAcquired).IsFalse();
            await Assert.That(limiter.AttemptAcquire(Request("POST", login, "203.0.113.2")).IsAcquired).IsTrue();
            await Assert.That(limiter.AttemptAcquire(Request("POST", "/api/plugins/schulware/stateless/refresh", "203.0.113.1")).IsAcquired).IsTrue();
            await Assert.That(limiter.AttemptAcquire(Request("GET", login, "203.0.113.1")).IsAcquired).IsTrue();
        }

        [Test]
        public async Task Anonymous_login_counts_an_ipv6_client_as_its_64()
        {
            using var limiter = RateLimitingExtensions.AnonymousLoginIpLimiter(perMinute: 1);
            const string login = "/api/plugins/schulware/stateless/login";

            await Assert.That(limiter.AttemptAcquire(Request("POST", login, "2001:db8:1:2::1")).IsAcquired).IsTrue();
            await Assert.That(limiter.AttemptAcquire(Request("POST", login, "2001:db8:1:2::2")).IsAcquired).IsFalse();
            await Assert.That(limiter.AttemptAcquire(Request("POST", login, "2001:db8:1:3::1")).IsAcquired).IsTrue();
        }

        private sealed class OneCredential(ToamaisutaaPasswordCredential? credential) : IPasswordCredentialStore
        {
            public Task<ToamaisutaaPasswordCredential?> FindByUserIdAsync(Guid userId, CancellationToken cancellationToken = default) => Task.FromResult(credential);
            public Task<ToamaisutaaPasswordCredential?> FindByIdentifierAsync(string normalizedIdentifier, CancellationToken cancellationToken = default) => throw new NotSupportedException();
            public Task<ToamaisutaaPasswordCredential?> FindByNormalizedEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default) => throw new NotSupportedException();
            public Task CreateAsync(ToamaisutaaPasswordCredential credential, CancellationToken cancellationToken = default) => throw new NotSupportedException();
            public Task UpdateAsync(ToamaisutaaPasswordCredential credential, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        }

        private sealed class PlainHasher : IPasswordHasher
        {
            public string Hash(string password) => password;
            public PasswordVerificationResult Verify(string password, string hash) => password == hash ? PasswordVerificationResult.Succeeded : PasswordVerificationResult.Failed;
        }

        private static AccountPasswordCheck Check(ServiceProvider provider, ToamaisutaaPasswordCredential? credential) => new(new OneCredential(credential), new PlainHasher(), Options.Create(new ToamaisutaaLocalLoginOptions()), new SecurityAuditLog(provider.GetRequiredService<IServiceScopeFactory>()));

        private static ClaimsPrincipal Subject(Guid id) => new(new ClaimsIdentity([new Claim("sub", id.ToString())], "test"));

        private static ToamaisutaaPasswordCredential Credential(Guid userId, DateTimeOffset? lockedUntil = null) => new() { UserId = userId, PasswordHash = "right", LockedOutUntil = lockedUntil };

        [Test]
        public async Task Deletion_needs_the_right_password_and_records_only_the_refusal()
        {
            using var provider = NewDb();
            var id = Guid.NewGuid();
            var check = Check(provider, Credential(id));

            await Assert.That(await check.RefusalAsync(Subject(id), null)).IsNotNull();
            await Assert.That(await check.RefusalAsync(Subject(id), "")).IsNotNull();
            await Assert.That(await check.RefusalAsync(Subject(id), "wrong")).IsNotNull();
            await Assert.That(await check.RefusalAsync(Subject(id), new string('x', 500))).IsNotNull();
            await Assert.That(await check.RefusalAsync(Subject(id), "right")).IsNull();

            using var scope = provider.CreateScope();
            var rows = await scope.ServiceProvider.GetRequiredService<SchulyDbContext>().SecurityAuditEntries.ToListAsync();
            await Assert.That(rows.Count).IsEqualTo(2);
            await Assert.That(rows.All(r => r.Kind == AccountPasswordCheck.RefusedKind && r.UserId == id && r.Detail is null)).IsTrue();
        }

        [Test]
        public async Task Locked_account_is_refused_even_with_the_right_password()
        {
            using var provider = NewDb();
            var id = Guid.NewGuid();

            await Assert.That(await Check(provider, Credential(id, DateTimeOffset.UtcNow.AddMinutes(5))).RefusalAsync(Subject(id), "right")).IsNotNull();
        }

        [Test]
        public async Task Single_sign_on_account_has_no_password_to_ask_for()
        {
            using var provider = NewDb();

            await Assert.That(await Check(provider, null).RefusalAsync(Subject(Guid.NewGuid()), null)).IsNull();
        }

        [Test]
        public async Task Sink_keeps_minimal_sign_in_fields_and_ignores_other_events()
        {
            using var provider = NewDb();
            var sink = new SecurityAuditSink(new SecurityAuditLog(provider.GetRequiredService<IServiceScopeFactory>()));
            var id = Guid.NewGuid();
            var at = new DateTimeOffset(2026, 11, 3, 10, 0, 0, TimeSpan.Zero);

            await sink.HandleAsync(new SignInFailed { OccurredAt = at, UserId = id, Reason = SignInOutcome.InvalidPassword });
            await sink.HandleAsync(new SignInFailed { OccurredAt = at, UserId = null, Reason = SignInOutcome.UnknownUser });
            await sink.HandleAsync(new EmailChanged { OccurredAt = at, UserId = id, Email = "new@example.com", PreviousEmail = "old@example.com" });

            using var scope = provider.CreateScope();
            var rows = await scope.ServiceProvider.GetRequiredService<SchulyDbContext>().SecurityAuditEntries.OrderBy(r => r.Detail).ToListAsync();
            await Assert.That(rows.Count).IsEqualTo(2);
            await Assert.That(rows[0].Kind).IsEqualTo("sign-in-failed");
            await Assert.That(rows[0].Detail).IsEqualTo(nameof(SignInOutcome.InvalidPassword));
            await Assert.That(rows[0].UserId).IsEqualTo(id);
            await Assert.That(rows[0].OccurredAt).IsEqualTo(at.UtcDateTime);
            await Assert.That(rows[1].UserId).IsNull();
        }

        [Test]
        public async Task Retention_removes_only_entries_past_the_limit()
        {
            using var provider = NewDb();
            using var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            var now = DateTime.UtcNow;
            db.SecurityAuditEntries.AddRange(new SecurityAuditEntry { Id = Guid.NewGuid(), Kind = "old", OccurredAt = now.AddDays(-400) }, new SecurityAuditEntry { Id = Guid.NewGuid(), Kind = "new", OccurredAt = now.AddDays(-10) });
            await db.SaveChangesAsync();

            var removed = await SecurityAuditLog.DeleteOlderThanAsync(db, now.AddDays(-SecurityAuditLog.DefaultRetentionDays));

            await Assert.That(removed).IsEqualTo(1);
            await Assert.That(db.SecurityAuditEntries.Single().Kind).IsEqualTo("new");
        }

        [Test]
        public async Task Rotation_moves_entries_to_the_new_key_and_leaves_the_rest()
        {
            using var provider = NewDb();
            var store = new DbVaultStore(provider.GetRequiredService<IServiceScopeFactory>());
            var oldKey = RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize);
            var newKey = RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize);
            new PluginVaultFactory(new VaultKeyring(oldKey), store).GetVault("plugin:a").Set("token", "old-secret");
            new PluginVaultFactory(new VaultKeyring(oldKey), store).GetVault("plugin:b").Set("token", "other-secret");
            new PluginVaultFactory(new VaultKeyring(RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize)), store).GetVault("plugin:c").Set("token", "foreign");
            new PluginVaultFactory(new VaultKeyring(newKey), store).GetVault("plugin:d").Set("token", "already-new");
            var keyring = new VaultKeyring(newKey, oldKey);

            var first = VaultKeyRotator.Rotate(keyring, store);
            var second = VaultKeyRotator.Rotate(keyring, store);

            await Assert.That(first.Rotated).IsEqualTo(2);
            await Assert.That(first.Unreadable).IsEqualTo(1);
            await Assert.That(second.Rotated).IsEqualTo(0);
            var afterwards = new PluginVaultFactory(new VaultKeyring(newKey), store);
            await Assert.That(afterwards.GetVault("plugin:a").Get("token")).IsEqualTo("old-secret");
            await Assert.That(afterwards.GetVault("plugin:b").Get("token")).IsEqualTo("other-secret");
            await Assert.That(afterwards.GetVault("plugin:d").Get("token")).IsEqualTo("already-new");
            await Assert.That(new PluginVaultFactory(new VaultKeyring(oldKey), store).GetVault("plugin:a").Get("token")).IsNull();
        }

        [Test]
        public async Task Rotation_does_nothing_without_a_previous_key()
        {
            using var provider = NewDb();
            var store = new DbVaultStore(provider.GetRequiredService<IServiceScopeFactory>());
            var key = RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize);
            new PluginVaultFactory(new VaultKeyring(RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize)), store).GetVault("plugin:a").Set("token", "x");

            await Assert.That(VaultKeyRotator.Rotate(new VaultKeyring(key), store)).IsEqualTo(default(VaultRotationResult));
        }

        [Test]
        public async Task Helply_reads_old_blobs_with_the_previous_key_and_writes_with_the_new_one()
        {
            var oldKey = RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize);
            var newKey = RandomNumberGenerator.GetBytes(VaultKeyring.MasterKeySize);
            Guid conversation = Guid.NewGuid(), user = Guid.NewGuid();
            var blob = new HelplyCipher(new VaultKeyring(oldKey)).Encrypt("title", conversation, user, HelplyCipher.TitleField);
            var rotated = new HelplyCipher(new VaultKeyring(newKey, oldKey));

            await Assert.That(rotated.DecryptString(blob, conversation, user, HelplyCipher.TitleField)).IsEqualTo("title");
            var rewritten = rotated.Encrypt("title", conversation, user, HelplyCipher.TitleField);
            await Assert.That(new HelplyCipher(new VaultKeyring(newKey)).DecryptString(rewritten, conversation, user, HelplyCipher.TitleField)).IsEqualTo("title");
            await Assert.That(() => new HelplyCipher(new VaultKeyring(newKey)).DecryptString(blob, conversation, user, HelplyCipher.TitleField)).Throws<CryptographicException>();
            await Assert.That(() => rotated.DecryptString(blob, conversation, Guid.NewGuid(), HelplyCipher.TitleField)).Throws<CryptographicException>();
        }

        private sealed class FixedResponse(IReadOnlyDictionary<string, byte[]> files) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(files[request.RequestUri!.Segments[^1]]) });
        }

        private static string Hex(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        [Test]
        public async Task Plugin_install_checks_the_index_hash_and_keeps_the_installed_version_on_a_mismatch()
        {
            var directory = Directory.CreateTempSubdirectory();
            try
            {
                var v1 = Encoding.UTF8.GetBytes("version one");
                var v2 = Encoding.UTF8.GetBytes("version two");
                var registry = new PluginRegistryClient(new HttpClient(new FixedResponse(new Dictionary<string, byte[]> { ["P-v1.dll"] = v1, ["P-v2.dll"] = v2 })), "https://registry.invalid/");
                var store = new PluginStore(directory.FullName);

                await store.InstallAsync(new RegistryPlugin { Name = "P", Dll = "P-v1.dll", Version = "1", Sha256 = Hex(v1) }, registry);
                await Assert.That(async () => { await store.InstallAsync(new RegistryPlugin { Name = "P", Dll = "P-v2.dll", Version = "2", Sha256 = Hex(v1) }, registry); }).Throws<InvalidOperationException>();

                await Assert.That(store.Find("P")!.Version).IsEqualTo("1");
                await Assert.That(File.Exists(Path.Combine(directory.FullName, "P-v1.dll"))).IsTrue();
                await Assert.That(File.Exists(Path.Combine(directory.FullName, "P-v2.dll"))).IsFalse();

                await store.InstallAsync(new RegistryPlugin { Name = "P", Dll = "P-v2.dll", Version = "2" }, registry);
                await Assert.That(store.Find("P")!.Version).IsEqualTo("2");
            }
            finally
            {
                directory.Delete(true);
            }
        }

        [Test]
        public async Task Pinned_version_drops_the_hashes_of_the_latest_build()
        {
            var entry = new RegistryPlugin { Name = "P", Dll = "P-v2.dll", Version = "2.0.0", Sha256 = "aa", DepsSha256 = "bb" }.WithPinnedVersion("1.0.0");

            await Assert.That(entry.Sha256).IsNull();
            await Assert.That(entry.DepsSha256).IsNull();
        }
    }
}
