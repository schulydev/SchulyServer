namespace Schuly.Domain
{
    /// <summary>The warning mail sent to an inactive account. Keyed by sign-in id, because a sign-in row can exist without an application user.</summary>
    public class InactivityWarning
    {
        public Guid LoginId { get; set; }
        public DateTime SentAt { get; set; }

        /// <summary>The date the mail promised. Nothing is deleted before it.</summary>
        public DateTime DeleteAfter { get; set; }
    }
}
