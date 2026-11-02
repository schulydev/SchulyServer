using Microsoft.EntityFrameworkCore;
using Schuly.Domain.Helply;

namespace Schuly.Infrastructure.Helply
{
    /// <summary>An attachment's metadata with its name decrypted. Never carries bytes.</summary>
    public sealed record HelplyAttachmentInfo(Guid Id, Guid ConversationId, string FileName, string MediaType, long SizeBytes, int? PageCount, bool HasText, int TextLength, Guid? MessageId, bool FromAssistant, DateTime CreatedAt)
    {
        public HelplyFileKind Kind => HelplyFileTypes.KindOf(MediaType);

        public HelplyStoredAttachment ToStored() => new() { Id = Id, FileName = FileName, MediaType = MediaType, SizeBytes = SizeBytes };
    }

    /// <summary>A file to download: its name, the type it is served as, and its bytes.</summary>
    public sealed record HelplyAttachmentFile(string FileName, string MediaType, byte[] Data);

    /// <summary>Why an upload was refused: 404 when the conversation is not the caller's, 400 otherwise.</summary>
    public sealed record HelplyUploadResult(HelplyAttachmentInfo? Attachment, int Status, string? Error);

    /// <summary>
    /// The only door to Helply's attachment tables. Every lookup is scoped to the owning user and conversation; the name, bytes and extracted text are encrypted with the Helply
    /// cipher, each bound to the user, the conversation and the attachment's own id (<c>attachment:{id}:{part}</c>), so a blob moved to another row, user or conversation does not decrypt.
    /// </summary>
    public sealed class HelplyAttachmentStore(SchulyDbContext db, HelplyCipher cipher, TimeProvider time)
    {
        public const int MaxPerMessage = 5;
        public const int MaxPendingPerConversation = 10;
        public const int MaxPerConversation = 40;
        public const int MaxSharedPerReply = 10;
        public static readonly TimeSpan OrphanAge = TimeSpan.FromHours(24);

        private DateTime Now => time.GetUtcNow().UtcDateTime;

        public static string Field(Guid attachmentId, string part) => $"attachment:{attachmentId:D}:{part}";

        /// <summary>Validates, extracts and stores an upload. The conversation must be the caller's and still alive.</summary>
        public async Task<HelplyUploadResult> UploadAsync(Guid applicationUserId, Guid conversationId, string? fileName, string? contentType, byte[] data, CancellationToken ct = default)
        {
            var now = Now;
            if (!await db.HelplyConversations.AnyAsync(c => c.Id == conversationId && c.ApplicationUserId == applicationUserId && c.ExpiresAt > now, ct))
                return new HelplyUploadResult(null, 404, "Conversation not found");

            var (type, error) = HelplyFileTypes.Detect(fileName, contentType, data);
            if (type is null)
                return new HelplyUploadResult(null, 400, error);

            var counts = await db.HelplyAttachments.Where(a => a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId).GroupBy(a => a.MessageId == null).Select(g => new { Pending = g.Key, Count = g.Count() }).ToListAsync(ct);
            if (counts.Where(c => c.Pending).Sum(c => c.Count) >= MaxPendingPerConversation)
                return new HelplyUploadResult(null, 400, $"Send or remove your attached files first; at most {MaxPendingPerConversation} can wait.");
            if (counts.Sum(c => c.Count) >= MaxPerConversation)
                return new HelplyUploadResult(null, 400, $"This conversation has reached {MaxPerConversation} files. Start a new chat to attach more.");

            var extracted = type.Kind == HelplyFileKind.Image ? null : HelplyTextExtractor.Extract(type.Kind, data);
            var hasText = !string.IsNullOrWhiteSpace(extracted?.Text);
            var name = HelplyFileTypes.DisplayName(fileName);
            var attachment = await AddAsync(applicationUserId, conversationId, null, false, name, type.MediaType, data, hasText ? extracted!.Text : null, extracted?.PageCount, ct);
            return new HelplyUploadResult(attachment, 200, null);
        }

        /// <summary>Stores a file Helply shared with its reply, already bound to that message.</summary>
        public Task<HelplyAttachmentInfo> AddSharedAsync(Guid applicationUserId, Guid conversationId, Guid messageId, string fileName, string mediaType, byte[] data, CancellationToken ct = default) =>
            AddAsync(applicationUserId, conversationId, messageId, true, HelplyFileTypes.DisplayName(fileName), mediaType, data, null, null, ct, save: false);

        private async Task<HelplyAttachmentInfo> AddAsync(Guid userId, Guid conversationId, Guid? messageId, bool fromAssistant, string name, string mediaType, byte[] data, string? text, int? pages, CancellationToken ct, bool save = true)
        {
            var id = Guid.NewGuid();
            var now = Now;
            var attachment = new HelplyAttachment
            {
                Id = id,
                ApplicationUserId = userId,
                ConversationId = conversationId,
                MessageId = messageId,
                FromAssistant = fromAssistant,
                FileName = cipher.Encrypt(name, conversationId, userId, Field(id, "name")),
                MediaType = mediaType,
                SizeBytes = data.LongLength,
                PageCount = pages,
                HasText = text is not null,
                TextLength = text?.Length ?? 0,
                CreatedAt = now,
                UpdatedAt = now,
                Content = new HelplyAttachmentContent
                {
                    AttachmentId = id,
                    Data = cipher.Encrypt(data, conversationId, userId, Field(id, "data")),
                    Text = text is null ? null : cipher.Encrypt(text, conversationId, userId, Field(id, "text")),
                },
            };
            db.HelplyAttachments.Add(attachment);
            if (save)
                await db.SaveChangesAsync(ct);
            return Info(attachment);
        }

        private HelplyAttachmentInfo Info(HelplyAttachment a) => new(a.Id, a.ConversationId, cipher.DecryptString(a.FileName, a.ConversationId, a.ApplicationUserId, Field(a.Id, "name")), a.MediaType, a.SizeBytes, a.PageCount, a.HasText, a.TextLength, a.MessageId, a.FromAssistant, a.CreatedAt);

        /// <summary>Every attachment of one of the caller's conversations, oldest first. Metadata only.</summary>
        public async Task<List<HelplyAttachmentInfo>> ListAsync(Guid applicationUserId, Guid conversationId, CancellationToken ct = default)
        {
            var rows = await db.HelplyAttachments.AsNoTracking().Where(a => a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId).OrderBy(a => a.CreatedAt).ToListAsync(ct);
            return rows.Select(Info).ToList();
        }

        /// <summary>
        /// Binds unsent uploads to the message they are sent with. Returns null (and binds nothing) unless every id is distinct, the caller's, in this conversation and not yet sent.
        /// The change is tracked and saved with the turn.
        /// </summary>
        public async Task<List<HelplyAttachmentInfo>?> BindAsync(Guid applicationUserId, Guid conversationId, IReadOnlyCollection<Guid> ids, Guid messageId, CancellationToken ct = default)
        {
            if (ids.Count == 0)
                return [];
            if (ids.Count > MaxPerMessage || ids.Distinct().Count() != ids.Count)
                return null;
            var rows = await db.HelplyAttachments.Where(a => ids.Contains(a.Id) && a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId && a.MessageId == null).ToListAsync(ct);
            if (rows.Count != ids.Count)
                return null;
            foreach (var row in rows)
            {
                row.MessageId = messageId;
                row.UpdatedAt = Now;
            }
            return ids.Select(id => Info(rows.First(r => r.Id == id))).ToList();
        }

        /// <summary>True when every id is an unsent upload of the caller in this conversation. Checks only; nothing changes.</summary>
        public async Task<bool> ArePendingAsync(Guid applicationUserId, Guid conversationId, IReadOnlyCollection<Guid> ids, CancellationToken ct = default)
        {
            if (ids.Count == 0)
                return true;
            if (ids.Count > MaxPerMessage || ids.Distinct().Count() != ids.Count)
                return false;
            return await db.HelplyAttachments.CountAsync(a => ids.Contains(a.Id) && a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId && a.MessageId == null, ct) == ids.Count;
        }

        public async Task<byte[]?> ReadDataAsync(Guid applicationUserId, Guid conversationId, Guid id, CancellationToken ct = default)
        {
            var blob = await db.HelplyAttachmentContents.AsNoTracking().Where(c => c.AttachmentId == id && db.HelplyAttachments.Any(a => a.Id == id && a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId)).Select(c => c.Data).FirstOrDefaultAsync(ct);
            return blob is null ? null : cipher.Decrypt(blob, conversationId, applicationUserId, Field(id, "data"));
        }

        public async Task<string?> ReadTextAsync(Guid applicationUserId, Guid conversationId, Guid id, CancellationToken ct = default)
        {
            var blob = await db.HelplyAttachmentContents.AsNoTracking().Where(c => c.AttachmentId == id && db.HelplyAttachments.Any(a => a.Id == id && a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId)).Select(c => c.Text).FirstOrDefaultAsync(ct);
            return blob is null ? null : cipher.DecryptString(blob, conversationId, applicationUserId, Field(id, "text"));
        }

        /// <summary>A file of one of the caller's live conversations, for download; null for anything else.</summary>
        public async Task<HelplyAttachmentFile?> GetFileAsync(Guid applicationUserId, Guid conversationId, Guid id, CancellationToken ct = default)
        {
            var now = Now;
            var row = await db.HelplyAttachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id && a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId && db.HelplyConversations.Any(c => c.Id == conversationId && c.ApplicationUserId == applicationUserId && c.ExpiresAt > now), ct);
            if (row is null || await ReadDataAsync(applicationUserId, conversationId, id, ct) is not { } data)
                return null;
            return new HelplyAttachmentFile(Info(row).FileName, row.MediaType, data);
        }

        /// <summary>Removes an upload that has not been sent. A sent file stays with its message.</summary>
        public async Task<bool> DeletePendingAsync(Guid applicationUserId, Guid conversationId, Guid id, CancellationToken ct = default)
        {
            var exists = await db.HelplyAttachments.AnyAsync(a => a.Id == id && a.ConversationId == conversationId && a.ApplicationUserId == applicationUserId && a.MessageId == null, ct);
            if (!exists)
                return false;
            RemoveByIds([id]);
            await db.SaveChangesAsync(ct);
            return true;
        }

        /// <summary>Queues the removal of every attachment of these conversations. The caller saves.</summary>
        public async Task RemoveForConversationsAsync(IReadOnlyCollection<Guid> conversationIds, CancellationToken ct = default)
        {
            if (conversationIds.Count == 0)
                return;
            RemoveByIds(await db.HelplyAttachments.Where(a => conversationIds.Contains(a.ConversationId)).Select(a => a.Id).ToListAsync(ct));
        }

        /// <summary>Removes uploads that were never sent and are older than a day. Returns how many.</summary>
        public async Task<int> SweepOrphansAsync(CancellationToken ct = default)
        {
            var cutoff = Now - OrphanAge;
            var ids = await db.HelplyAttachments.Where(a => a.MessageId == null && a.CreatedAt < cutoff).Select(a => a.Id).ToListAsync(ct);
            RemoveByIds(ids);
            await db.SaveChangesAsync(ct);
            return ids.Count;
        }

        /// <summary>Deletes by key without loading any blob: tracked rows are removed as they are, the rest as key-only stubs.</summary>
        private void RemoveByIds(IReadOnlyCollection<Guid> ids)
        {
            foreach (var id in ids)
            {
                var content = db.HelplyAttachmentContents.Local.FirstOrDefault(c => c.AttachmentId == id) ?? db.HelplyAttachmentContents.Attach(new HelplyAttachmentContent { AttachmentId = id }).Entity;
                db.HelplyAttachmentContents.Remove(content);
                var attachment = db.HelplyAttachments.Local.FirstOrDefault(a => a.Id == id) ?? db.HelplyAttachments.Attach(new HelplyAttachment { Id = id }).Entity;
                db.HelplyAttachments.Remove(attachment);
            }
        }
    }
}
