using System.Text;
using Microsoft.EntityFrameworkCore;
using Schuly.Domain.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Mcp;

namespace Schuly.Infrastructure.Helply
{
    /// <summary>
    /// The only door to Helply's tables. Every lookup is scoped to the owning user and hides expired conversations, and every read or write of an encrypted column goes
    /// through the cipher, so callers never see a byte[] they could mistake for plaintext.
    /// </summary>
    public sealed class HelplyConversationStore(SchulyDbContext db, HelplyCipher cipher, TimeProvider time)
    {
        public static readonly TimeSpan Retention = TimeSpan.FromDays(30);
        public const int MaxTitleLength = 120;
        public const string DefaultTitle = "New chat";

        private DateTime Now => time.GetUtcNow().UtcDateTime;

        /// <summary>The attachments of these conversations, on the same database context so a delete removes both in one save.</summary>
        public HelplyAttachmentStore Attachments { get; } = new(db, cipher, time);

        public Task<HelplyConversation?> FindAsync(Guid applicationUserId, Guid id, CancellationToken ct = default)
        {
            var now = Now;
            return db.HelplyConversations.FirstOrDefaultAsync(c => c.Id == id && c.ApplicationUserId == applicationUserId && c.ExpiresAt > now, ct);
        }

        public Task<List<HelplyConversation>> ListAsync(Guid applicationUserId, CancellationToken ct = default)
        {
            var now = Now;
            return db.HelplyConversations.AsNoTracking().Where(c => c.ApplicationUserId == applicationUserId && c.ExpiresAt > now).OrderByDescending(c => c.LastActivityAt).ToListAsync(ct);
        }

        public async Task<HelplyConversation> CreateAsync(Guid applicationUserId, string? title, CancellationToken ct = default)
        {
            var now = Now;
            var conversation = new HelplyConversation { Id = Guid.NewGuid(), ApplicationUserId = applicationUserId, CreatedAt = now, UpdatedAt = now, LastActivityAt = now, ExpiresAt = now + Retention };
            WriteTitle(conversation, string.IsNullOrWhiteSpace(title) ? DefaultTitle : Clamp(title));
            WriteTranscript(conversation, new HelplyTranscript());
            db.HelplyConversations.Add(conversation);
            await db.SaveChangesAsync(ct);
            return conversation;
        }

        public static string Clamp(string title)
        {
            var trimmed = title.Trim();
            return trimmed.Length <= MaxTitleLength ? trimmed : trimmed[..MaxTitleLength];
        }

        public string ReadTitle(HelplyConversation c) => cipher.DecryptString(c.Title, c.Id, c.ApplicationUserId, HelplyCipher.TitleField);

        public void WriteTitle(HelplyConversation c, string title) => c.Title = cipher.Encrypt(title, c.Id, c.ApplicationUserId, HelplyCipher.TitleField);

        public HelplyTranscript ReadTranscript(HelplyConversation c) => HelplyTranscript.FromJson(cipher.Decrypt(c.Transcript, c.Id, c.ApplicationUserId, HelplyCipher.TranscriptField));

        public void WriteTranscript(HelplyConversation c, HelplyTranscript transcript) => c.Transcript = cipher.Encrypt(transcript.ToJson(), c.Id, c.ApplicationUserId, HelplyCipher.TranscriptField);

        public string? ReadSession(HelplyConversation c) => c.Session is null ? null : cipher.DecryptString(c.Session, c.Id, c.ApplicationUserId, HelplyCipher.SessionField);

        public void WriteSession(HelplyConversation c, string? sessionJson) => c.Session = sessionJson is null ? null : cipher.Encrypt(Encoding.UTF8.GetBytes(sessionJson), c.Id, c.ApplicationUserId, HelplyCipher.SessionField);

        /// <summary>Counts as activity: the conversation lives another 30 days from now.</summary>
        public void Touch(HelplyConversation c)
        {
            var now = Now;
            c.LastActivityAt = now;
            c.UpdatedAt = now;
            c.ExpiresAt = now + Retention;
        }

        public Task SaveAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);

        public async Task<bool> DeleteAsync(Guid applicationUserId, Guid id, CancellationToken ct = default)
        {
            var conversation = await db.HelplyConversations.FirstOrDefaultAsync(c => c.Id == id && c.ApplicationUserId == applicationUserId, ct);
            if (conversation is null)
                return false;
            await Attachments.RemoveForConversationsAsync([conversation.Id], ct);
            db.HelplyConversations.Remove(conversation);
            await db.SaveChangesAsync(ct);
            return true;
        }

        public async Task<int> DeleteAllAsync(Guid applicationUserId, CancellationToken ct = default)
        {
            var all = await db.HelplyConversations.Where(c => c.ApplicationUserId == applicationUserId).ToListAsync(ct);
            await Attachments.RemoveForConversationsAsync(all.Select(c => c.Id).ToList(), ct);
            db.HelplyConversations.RemoveRange(all);
            await db.SaveChangesAsync(ct);
            return all.Count;
        }

        /// <summary>Removes conversations past their expiry, for every user. Returns how many.</summary>
        public async Task<int> SweepAsync(CancellationToken ct = default)
        {
            var now = Now;
            var expired = await db.HelplyConversations.Where(c => c.ExpiresAt <= now).ToListAsync(ct);
            await Attachments.RemoveForConversationsAsync(expired.Select(c => c.Id).ToList(), ct);
            db.HelplyConversations.RemoveRange(expired);
            await db.SaveChangesAsync(ct);
            return expired.Count;
        }

        public async Task<McpPermissionSet> GetPermissionsAsync(Guid applicationUserId, CancellationToken ct = default) =>
            (await db.HelplySettings.AsNoTracking().FirstOrDefaultAsync(s => s.ApplicationUserId == applicationUserId, ct))?.Permissions ?? McpPermissionSet.SchoolDataOnly();

        public async Task<bool> GetWorkspaceEnabledAsync(Guid applicationUserId, CancellationToken ct = default) =>
            (await db.HelplySettings.AsNoTracking().FirstOrDefaultAsync(s => s.ApplicationUserId == applicationUserId, ct))?.WorkspaceEnabled ?? false;

        public async Task<bool> SetWorkspaceEnabledAsync(Guid applicationUserId, bool enabled, CancellationToken ct = default)
        {
            var settings = await db.HelplySettings.FirstOrDefaultAsync(s => s.ApplicationUserId == applicationUserId, ct);
            var now = Now;
            if (settings is null)
                db.HelplySettings.Add(new HelplySettings { Id = Guid.NewGuid(), ApplicationUserId = applicationUserId, Permissions = McpPermissionSet.SchoolDataOnly(), WorkspaceEnabled = enabled, CreatedAt = now, UpdatedAt = now });
            else
            {
                settings.WorkspaceEnabled = enabled;
                settings.UpdatedAt = now;
            }
            await db.SaveChangesAsync(ct);
            return enabled;
        }

        public async Task<McpPermissionSet> SetPermissionsAsync(Guid applicationUserId, McpPermissionSet? permissions, CancellationToken ct = default)
        {
            var normalized = McpScopes.Normalize(permissions);
            var settings = await db.HelplySettings.FirstOrDefaultAsync(s => s.ApplicationUserId == applicationUserId, ct);
            var now = Now;
            if (settings is null)
                db.HelplySettings.Add(new HelplySettings { Id = Guid.NewGuid(), ApplicationUserId = applicationUserId, Permissions = normalized, CreatedAt = now, UpdatedAt = now });
            else
            {
                settings.Permissions = normalized;
                settings.UpdatedAt = now;
            }
            await db.SaveChangesAsync(ct);
            return normalized;
        }
    }
}
