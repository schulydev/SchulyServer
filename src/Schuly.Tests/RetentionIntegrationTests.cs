using System.Net.Http.Json;
using System.Text.Json;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using Schuly.API.Email;
using Schuly.API.Plugins;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;
using Schuly.Tests.TestHelpers;
using Toamaisutaa.Abstractions;
using Toamaisutaa.Email.Smtp;
using Toamaisutaa.EntityFrameworkCore;

namespace Schuly.Tests
{
    /// <summary>The parts an in-memory database can't check. Each is skipped unless its throwaway service is given by environment variable.</summary>
    [NotInParallel("RetentionIntegration")]
    public class RetentionIntegrationTests
    {
        private static string Require(string variable)
        {
            var value = Environment.GetEnvironmentVariable(variable);
            if (string.IsNullOrEmpty(value))
                Skip.Test($"{variable} is not set.");
            return value!;
        }

        private static async Task<ServiceProvider> FreshDatabaseAsync(string connectionString)
        {
            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync();
                await using var reset = new NpgsqlCommand("DROP SCHEMA public CASCADE; CREATE SCHEMA public;", connection);
                await reset.ExecuteNonQueryAsync();
            }

            var services = new ServiceCollection();
            services.AddLogging();
            services.AddDbContext<SchulyDbContext>(o => o.UseNpgsql(connectionString));
            services.AddToamaisutaaEntityFrameworkStores<SchulyDbContext>();
            return services.BuildServiceProvider();
        }

        [Test]
        public async Task The_migration_clears_handled_outbox_rows_and_absence_reasons()
        {
            await using var provider = await FreshDatabaseAsync(Require("SCHULY_TEST_POSTGRES"));
            using var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            var migrator = db.GetInfrastructure().GetRequiredService<IMigrator>();
            var migrations = db.Database.GetMigrations().ToList();
            await migrator.MigrateAsync(migrations[migrations.IndexOf(migrations.Single(m => m.EndsWith("_AddRetentionTracking", StringComparison.Ordinal))) - 1]);

            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO "NotificationOutbox" ("Id", "ApplicationUserId", "Type", "EntityId", "SubjectName", "Score", "Summary", "Status", "RetryCount", "NextAttemptAt", "CreatedAt", "UpdatedAt") VALUES
                ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 2, gen_random_uuid(), NULL, NULL, 'Krank', 1, 0, now(), now(), now()),
                ('00000000-0000-0000-0000-000000000002', gen_random_uuid(), 0, gen_random_uuid(), 'Math', 5.5, NULL, 2, 5, now(), now(), now()),
                ('00000000-0000-0000-0000-000000000003', gen_random_uuid(), 2, gen_random_uuid(), NULL, NULL, 'Krank', 0, 0, now(), now(), now()),
                ('00000000-0000-0000-0000-000000000004', gen_random_uuid(), 3, gen_random_uuid(), NULL, NULL, 'Ausflug', 0, 0, now(), now(), now());
                """);

            await migrator.MigrateAsync();

            var rows = await db.NotificationOutbox.AsNoTracking().OrderBy(o => o.Id).ToListAsync();
            await Assert.That(rows.Select(r => r.Summary).ToList()).IsEquivalentTo(new string?[] { null, "Ausflug" });
        }

        [Test]
        public async Task The_sweep_runs_on_postgres_and_a_deleted_sign_in_takes_its_credentials_with_it()
        {
            await using var provider = await FreshDatabaseAsync(Require("SCHULY_TEST_POSTGRES"));
            using var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            await db.Database.MigrateAsync();
            var store = scope.ServiceProvider.GetRequiredService<IUserStore>();

            var old = DateTimeOffset.UtcNow.AddMonths(-13);
            var (warned, deleted) = (Guid.CreateVersion7(), Guid.CreateVersion7());
            db.Set<ToamaisutaaUser>().AddRange(new ToamaisutaaUser { Id = warned, SecurityStamp = "s", CreatedAt = old, UpdatedAt = old }, new ToamaisutaaUser { Id = deleted, SecurityStamp = "s", CreatedAt = old, UpdatedAt = old });
            db.Set<ToamaisutaaPasswordCredential>().Add(new ToamaisutaaPasswordCredential { UserId = warned, UserName = "warned", NormalizedUserName = "WARNED", Email = "warned@example.com", EmailConfirmedAt = old, PasswordHash = "x", CreatedAt = old, UpdatedAt = old });
            db.Set<ToamaisutaaPasswordCredential>().Add(new ToamaisutaaPasswordCredential { UserId = deleted, UserName = "deleted", NormalizedUserName = "DELETED", Email = "deleted@example.com", PasswordHash = "x", CreatedAt = old, UpdatedAt = old });
            var warnedUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = warned.ToString(), Email = "warned@example.com" };
            var deletedUser = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = deleted.ToString(), Email = "deleted@example.com" };
            var school = new School { Id = Guid.NewGuid(), Name = "School" };
            var leaver = TestDb.NewSchoolUser(school.Id);
            leaver.ApplicationUserId = warnedUser.Id;
            leaver.LeaveDate = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-7);
            leaver.Source = "Schuly.Plugin.Schulware";
            leaver.ProfilePictureUrl = "leaver-avatar";
            db.AddRange(warnedUser, deletedUser, school, leaver);
            var cls = new Class { Name = "C", SchoolId = school.Id, Students = { leaver } };
            db.Add(cls);
            await db.SaveChangesAsync();
            warnedUser.LastSeenAt = old.UtcDateTime;
            deletedUser.LastSeenAt = old.UtcDateTime;
            await db.SaveChangesAsync();

            var plugins = new FakePluginPurger();
            plugins.Owners.AddRange([warnedUser.Id, Guid.NewGuid()]);
            var storage = new FakeDocumentStorage();
            var warnings = new FakeWarningSender();
            var sweeper = new RetentionSweeper(db, new AccountPurger(db, storage, TestVault.Factory(), plugins, NullLogger<AccountPurger>.Instance), plugins, store, storage, warnings, Options.Create(new RetentionOptions()), NullLogger<RetentionSweeper>.Instance);

            var result = await sweeper.SweepAsync(CancellationToken.None);

            await Assert.That(result.FailedSteps).IsEqualTo(0);
            await Assert.That(result.SchoolUsersPurged).IsEqualTo(1);
            await Assert.That(result.AccountsPurged).IsEqualTo(1);
            await Assert.That(result.OrphanedOwnersPurged).IsEqualTo(1);
            await Assert.That(warnings.Sent.Single().Email).IsEqualTo("warned@example.com");
            await Assert.That(storage.Deleted).Contains("leaver-avatar");
            await Assert.That(await store.ReadSecurityStampAsync(deleted)).IsNull();
            await Assert.That(await store.ReadSecurityStampAsync(warned)).IsNotNull();
            db.ChangeTracker.Clear();
            await Assert.That(await db.Set<ToamaisutaaPasswordCredential>().AnyAsync(c => c.UserId == deleted)).IsFalse();
            await Assert.That(await db.ApplicationUsers.AnyAsync(u => u.Id == deletedUser.Id)).IsFalse();
            await Assert.That(await db.ApplicationUsers.AnyAsync(u => u.Id == warnedUser.Id)).IsTrue();
        }

        [Test]
        public async Task Owners_are_read_from_every_uuid_application_user_column()
        {
            var connectionString = Require("SCHULY_TEST_POSTGRES");
            await (await FreshDatabaseAsync(connectionString)).DisposeAsync();

            var (first, second) = (Guid.NewGuid(), Guid.NewGuid());
            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync();
                await using var setup = new NpgsqlCommand($"""
                    CREATE TABLE "Accounts" ("ApplicationUserId" uuid NOT NULL);
                    CREATE TABLE "Messages" ("ApplicationUserId" uuid NULL);
                    CREATE TABLE "Other" ("ApplicationUserId" text NOT NULL);
                    INSERT INTO "Accounts" VALUES ('{first}'), ('{first}'), ('00000000-0000-0000-0000-000000000000');
                    INSERT INTO "Messages" VALUES ('{second}'), (NULL);
                    INSERT INTO "Other" VALUES ('not-a-guid');
                    """, connection);
                await setup.ExecuteNonQueryAsync();
            }

            var owners = await PluginDataOwners.ReadAsync(connectionString, CancellationToken.None);

            await Assert.That(owners).IsEquivalentTo(new[] { first, second });
        }

        [Test]
        public async Task S3_lists_what_was_uploaded_and_no_longer_lists_what_was_deleted()
        {
            var endpoint = Require("SCHULY_TEST_S3");
            using var client = new AmazonS3Client(new BasicAWSCredentials("any", "any"), new AmazonS3Config { ServiceURL = endpoint, ForcePathStyle = true });
            var bucket = $"list-test-{Guid.NewGuid():N}"[..30];
            await client.PutBucketAsync(bucket);
            var storage = new S3DocumentStorage(client, Options.Create(new S3Options { Bucket = bucket }));

            var kept = await storage.UploadAsync(new MemoryStream([1, 2, 3]), "kept.png", "image/png", default);
            var gone = await storage.UploadAsync(new MemoryStream([4, 5]), "gone.png", "image/png", default);
            await storage.DeleteAsync(gone.Key, default);

            var listed = await storage.ListAsync(default).ToListAsync();

            await Assert.That(listed.Select(b => b.Key).ToList()).IsEquivalentTo(new[] { kept.Key });
            await Assert.That(BlobKeys.HasUploadShape(listed.Single().Key)).IsTrue();
            await Assert.That(listed.Single().LastModifiedUtc > DateTime.UtcNow.AddHours(-1)).IsTrue();
        }

        [Test]
        public async Task The_warning_mail_reaches_a_real_smtp_server()
        {
            var mailpit = Require("SCHULY_TEST_MAILPIT");
            var uri = new Uri(mailpit);
            var settings = new ToamaisutaaSmtpEmailOptions { Host = uri.Host, Port = int.Parse(Require("SCHULY_TEST_SMTP_PORT")), Security = SmtpSecurityMode.None, From = "noreply@example.com", FromDisplayName = "Schuly" };

            await new SmtpInactivityWarningSender(Options.Create(settings)).SendAsync("owner@example.com", new DateTime(2027, 3, 2, 0, 0, 0, DateTimeKind.Utc), default);

            using var http = new HttpClient { BaseAddress = uri };
            var messages = await http.GetFromJsonAsync<JsonElement>("/api/v1/messages");
            var message = messages.GetProperty("messages")[0];
            await Assert.That(message.GetProperty("Subject").GetString()).IsEqualTo("Your Schuly account will be deleted");
            await Assert.That(message.GetProperty("To")[0].GetProperty("Address").GetString()).IsEqualTo("owner@example.com");
            await Assert.That(message.GetProperty("Snippet").GetString()!).Contains("2 March 2027");
        }

        [Test]
        public async Task The_warning_mail_states_the_date_and_how_to_keep_the_account()
        {
            var settings = new ToamaisutaaSmtpEmailOptions { From = "noreply@example.com", SignInUrl = "https://app.example.com/sign-in" };

            var message = SmtpInactivityWarningSender.Build(settings, "owner@example.com", new DateTime(2027, 3, 2, 0, 0, 0, DateTimeKind.Utc));

            await Assert.That(message.TextBody).Contains("After 2 March 2027");
            await Assert.That(message.TextBody).Contains("https://app.example.com/sign-in");
            await Assert.That(message.HtmlBody).Contains("https://app.example.com/email-logo.png");
        }
    }
}
