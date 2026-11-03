using Schuly.Domain.Mcp;

namespace Schuly.Domain.Helply
{
    /// <summary>What Helply may do for one user. It becomes the permission set of the short-lived MCP token Helply uses on every turn, so edits apply to the next message.</summary>
    public class HelplySettings : Base
    {
        public Guid ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        public McpPermissionSet Permissions { get; set; } = McpPermissionSet.SchoolDataOnly();

        /// <summary>Whether Helply may run code in its sandboxed workspace. Off until the user turns it on.</summary>
        public bool WorkspaceEnabled { get; set; }
    }
}
