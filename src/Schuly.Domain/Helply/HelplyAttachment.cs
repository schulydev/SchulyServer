namespace Schuly.Domain.Helply
{
    /// <summary>
    /// A file in a Helply conversation: one the user uploaded, or one Helply created in its workspace and shared with its reply. The file name is stored encrypted and the bytes
    /// and extracted text live in <see cref="HelplyAttachmentContent"/>, so listing and binding attachments never loads a blob. An upload is bound to a message when it is sent;
    /// one that is never sent is removed after a day, and every attachment goes with its conversation.
    /// </summary>
    public class HelplyAttachment : Base
    {
        public Guid ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        public Guid ConversationId { get; set; }
        public HelplyConversation? Conversation { get; set; }

        /// <summary>The transcript message the file belongs to. Null while an upload waits to be sent.</summary>
        public Guid? MessageId { get; set; }

        /// <summary>True for a file Helply created and shared, false for an upload.</summary>
        public bool FromAssistant { get; set; }

        /// <summary>Encrypted UTF-8 file name.</summary>
        public byte[] FileName { get; set; } = [];

        /// <summary>The type the server detected from the bytes, never what the client claimed.</summary>
        public string MediaType { get; set; } = "application/octet-stream";

        public long SizeBytes { get; set; }

        /// <summary>Pages of a PDF, slides of a presentation; null for everything else.</summary>
        public int? PageCount { get; set; }

        /// <summary>Whether text could be extracted (and is stored with the content).</summary>
        public bool HasText { get; set; }

        /// <summary>Length of the extracted text in characters, so the content strategy can decide without decrypting it.</summary>
        public int TextLength { get; set; }

        public HelplyAttachmentContent? Content { get; set; }
    }

    /// <summary>The encrypted bytes of an attachment and its encrypted extracted text, kept apart from the metadata.</summary>
    public class HelplyAttachmentContent
    {
        public Guid AttachmentId { get; set; }

        public byte[] Data { get; set; } = [];

        public byte[]? Text { get; set; }
    }
}
