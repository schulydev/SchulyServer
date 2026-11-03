namespace Schuly.Domain
{
    /// <summary>One security event: what happened to which sign-in account, and when. Never a password, token, email or IP address.</summary>
    public class SecurityAuditEntry
    {
        public Guid Id { get; set; }

        public required string Kind { get; set; }

        /// <summary>The sign-in account's id (the token's <c>sub</c>). Null when a sign-in names no known account.</summary>
        public Guid? UserId { get; set; }

        public DateTime OccurredAt { get; set; }

        /// <summary>The outcome's short code, such as the reason a sign-in failed.</summary>
        public string? Detail { get; set; }
    }
}
