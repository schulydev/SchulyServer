namespace Schuly.Domain.Helply
{
    /// <summary>
    /// One chat with Helply. The title, the display transcript and the agent session are all stored encrypted (see the Helply cipher in Infrastructure), so nothing
    /// a user said is readable in the database. Conversations expire 30 days after their last activity.
    /// </summary>
    public class HelplyConversation : Base
    {
        public Guid ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        /// <summary>Encrypted UTF-8 title.</summary>
        public byte[] Title { get; set; } = [];

        /// <summary>Encrypted JSON of the messages as the user sees them, plus any approvals still pending.</summary>
        public byte[] Transcript { get; set; } = [];

        /// <summary>Encrypted JSON of the agent framework's serialized session (the model-side history). Null until the first turn.</summary>
        public byte[]? Session { get; set; }

        public DateTime LastActivityAt { get; set; } = DateTime.UtcNow;
        public DateTime ExpiresAt { get; set; }
    }
}
