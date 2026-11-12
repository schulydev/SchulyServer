using Microsoft.EntityFrameworkCore;
using Npgsql;
using Schuly.Domain;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Vault;

namespace Schuly.Tests.Helply
{
    /// <summary>Deleting conversations that have files, on a real Postgres: the in-memory provider has no database cascade, so it cannot show the delete order. Skipped unless SCHULY_TEST_POSTGRES is set.</summary>
    [NotInParallel("RetentionIntegration")]
    public class HelplyDeleteTests
    {
        private static string ConnectionString()
        {
            var connectionString = Environment.GetEnvironmentVariable("SCHULY_TEST_POSTGRES");
            if (string.IsNullOrEmpty(connectionString))
                Skip.Test("SCHULY_TEST_POSTGRES is not set.");
            return connectionString!;
        }

        private static async Task<SchulyDbContext> FreshDatabaseAsync()
        {
            var connectionString = ConnectionString();
            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync();
                await using var reset = new NpgsqlCommand("DROP SCHEMA public CASCADE; CREATE SCHEMA public;", connection);
                await reset.ExecuteNonQueryAsync();
            }

            var db = NewContext();
            await db.Database.MigrateAsync();
            return db;
        }

        /// <summary>A context that has tracked nothing yet, like a request's: the delete must work from keys alone.</summary>
        private static SchulyDbContext NewContext() => new(new DbContextOptionsBuilder<SchulyDbContext>().UseNpgsql(ConnectionString()).Options);

        private static HelplyConversationStore NewStore(SchulyDbContext db, TimeProvider time) => new(db, new HelplyCipher(VaultKeyring.Ephemeral()), time);

        private static async Task<(Guid UserId, Guid[] Chats)> SeedAsync(SchulyDbContext db, TimeProvider time)
        {
            var user = new ApplicationUser { ExternalId = Guid.NewGuid().ToString(), Email = "u@example.com" };
            db.ApplicationUsers.Add(user);
            await db.SaveChangesAsync();

            var store = NewStore(db, time);
            var chats = new List<Guid>();
            for (var i = 0; i < 2; i++)
            {
                var chat = await store.CreateAsync(user.Id, $"Chat {i}");
                chats.Add(chat.Id);
                var upload = await store.Attachments.UploadAsync(user.Id, chat.Id, $"note{i}.txt", "text/plain", HelplyFiles.Text($"file {i}"));
                await Assert.That(upload.Status).IsEqualTo(200);
            }
            await store.CreateAsync(user.Id, "No files");
            return (user.Id, chats.ToArray());
        }

        private static async Task AssertNothingLeftAsync(SchulyDbContext db)
        {
            await Assert.That(await db.HelplyConversations.CountAsync()).IsEqualTo(0);
            await Assert.That(await db.HelplyAttachments.CountAsync()).IsEqualTo(0);
            await Assert.That(await db.HelplyAttachmentContents.CountAsync()).IsEqualTo(0);
        }

        [Test]
        public async Task Deleting_all_conversations_removes_their_files_too()
        {
            await using var db = await FreshDatabaseAsync();
            var (userId, _) = await SeedAsync(db, TimeProvider.System);
            await using var request = NewContext();
            var store = NewStore(request, TimeProvider.System);

            await Assert.That(await store.DeleteAllAsync(userId)).IsEqualTo(3);

            await AssertNothingLeftAsync(db);
        }

        [Test]
        public async Task Deleting_one_conversation_removes_its_files_too()
        {
            await using var db = await FreshDatabaseAsync();
            var (userId, chats) = await SeedAsync(db, TimeProvider.System);
            await using var request = NewContext();
            var store = NewStore(request, TimeProvider.System);

            await Assert.That(await store.DeleteAsync(userId, chats[0])).IsTrue();

            await Assert.That(await db.HelplyConversations.CountAsync()).IsEqualTo(2);
            await Assert.That(await db.HelplyAttachments.CountAsync()).IsEqualTo(1);
            await Assert.That(await db.HelplyAttachmentContents.CountAsync()).IsEqualTo(1);
        }

        [Test]
        public async Task Sweeping_expired_conversations_removes_their_files_too()
        {
            await using var db = await FreshDatabaseAsync();
            await SeedAsync(db, TimeProvider.System);
            await using var request = NewContext();
            var later = NewStore(request, new FixedTime(DateTimeOffset.UtcNow + HelplyConversationStore.Retention + TimeSpan.FromDays(1)));

            await Assert.That(await later.SweepAsync()).IsEqualTo(3);

            await AssertNothingLeftAsync(db);
        }

        private sealed class FixedTime(DateTimeOffset now) : TimeProvider
        {
            public override DateTimeOffset GetUtcNow() => now;
        }
    }
}
