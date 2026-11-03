namespace Schuly.Domain.Mcp
{
    /// <summary>The areas of data an MCP connection can be given access to.</summary>
    public enum McpArea
    {
        Grades,
        Exams,
        Calendar,
        Absences,
        Documents,
        SchoolAccounts,
        Mail,
        Teams,
        Drive,
        OneNote,
    }

    public enum McpAccessLevel
    {
        Off = 0,
        Read = 1,
        ReadWrite = 2,
    }

    /// <summary>What one connected app, API key or internal client may do. Stored on the connection itself, not in its tokens, so an edit applies to the very next request.</summary>
    public class McpPermissionSet
    {
        public Dictionary<McpArea, McpAccessLevel> Areas { get; set; } = [];

        /// <summary>Deleting (a mail, a reported absence) needs this on top of write access to the area.</summary>
        public bool AllowDestructive { get; set; }

        /// <summary>The linked Microsoft accounts the connection may use. Null means all of them, including ones linked later.</summary>
        public List<Guid>? MicrosoftAccountIds { get; set; }

        public McpAccessLevel Level(McpArea area) => Areas.TryGetValue(area, out var level) ? level : McpAccessLevel.Off;

        public bool Allows(McpArea area, McpAccessLevel needed) => Level(area) >= needed;

        public bool AllowsMicrosoftAccount(Guid accountId) => MicrosoftAccountIds is null || MicrosoftAccountIds.Contains(accountId);

        /// <summary>The default for Helply and every new connection: read school data, change nothing, and no Microsoft account, its calendars included.</summary>
        public static McpPermissionSet SchoolDataOnly() => new()
        {
            Areas = new()
            {
                [McpArea.Grades] = McpAccessLevel.Read,
                [McpArea.Exams] = McpAccessLevel.Read,
                [McpArea.Calendar] = McpAccessLevel.Read,
                [McpArea.Absences] = McpAccessLevel.Read,
                [McpArea.Documents] = McpAccessLevel.Read,
                [McpArea.SchoolAccounts] = McpAccessLevel.Read,
            },
            MicrosoftAccountIds = [],
        };

        /// <summary>Read everything, change nothing. Only ever chosen by the user.</summary>
        public static McpPermissionSet ReadOnly() => new() { Areas = Enum.GetValues<McpArea>().ToDictionary(a => a, _ => McpAccessLevel.Read) };

        public static McpPermissionSet None() => new();

        public McpPermissionSet Clone() => new() { Areas = new(Areas), AllowDestructive = AllowDestructive, MicrosoftAccountIds = MicrosoftAccountIds?.ToList() };
    }
}
