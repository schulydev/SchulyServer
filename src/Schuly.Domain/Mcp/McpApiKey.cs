namespace Schuly.Domain.Mcp
{
    /// <summary>A named, user-created key for MCP clients that cannot do OAuth. Shown once; only its SHA-256 hash is stored.</summary>
    public class McpApiKey : Base
    {
        public Guid ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        public required string Name { get; set; }

        /// <summary>The first characters of the key, so the user can tell keys apart without the key itself.</summary>
        public required string Prefix { get; set; }
        public required string KeyHash { get; set; }
        public McpPermissionSet Permissions { get; set; } = McpPermissionSet.SchoolDataOnly();
        public DateTime? ExpiresAt { get; set; }
        public DateTime? LastUsedAt { get; set; }
        public DateTime? RevokedAt { get; set; }
    }
}
