namespace Schuly.Domain.Mcp
{
    /// <summary>One user's approval of one OAuth client: what the "Connected apps" list shows and what revoking ends.</summary>
    public class McpGrant : Base
    {
        public Guid ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        public Guid McpOAuthClientId { get; set; }
        public McpOAuthClient? McpOAuthClient { get; set; }

        public McpPermissionSet Permissions { get; set; } = McpPermissionSet.SchoolDataOnly();

        /// <summary>The account's Toamaisutaa security stamp when the user approved. A password change or a new second factor moves it and ends the grant.</summary>
        public string? SecurityStamp { get; set; }

        public DateTime? LastUsedAt { get; set; }
        public DateTime? RevokedAt { get; set; }
    }
}
