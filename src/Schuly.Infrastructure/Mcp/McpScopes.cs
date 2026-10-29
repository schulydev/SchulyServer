using Schuly.Domain.Mcp;

namespace Schuly.Infrastructure.Mcp
{
    /// <summary>
    /// The OAuth scopes that mirror <see cref="McpPermissionSet"/>: <c>schuly.grades.read</c>, <c>ms.mail.write</c> and so on, plus <c>schuly.destructive</c>.
    /// A client may ask for scopes, which preselect the consent checklist, but what the user ticks there is what the connection gets.
    /// </summary>
    public static class McpScopes
    {
        /// <summary>Claim carrying each currently granted scope on an MCP principal.</summary>
        public const string ClaimType = "scope";

        public const string Destructive = "schuly.destructive";

        /// <summary>Areas that have write tools. The others only ever read, so offering them write access would mean nothing.</summary>
        public static readonly IReadOnlySet<McpArea> WritableAreas = new HashSet<McpArea> { McpArea.Absences, McpArea.Mail, McpArea.Teams, McpArea.OneNote };

        public static string Prefix(McpArea area) => area switch
        {
            McpArea.Grades => "schuly.grades",
            McpArea.Exams => "schuly.exams",
            McpArea.Calendar => "schuly.calendar",
            McpArea.Absences => "schuly.absences",
            McpArea.Documents => "schuly.documents",
            McpArea.SchoolAccounts => "schuly.accounts",
            McpArea.Mail => "ms.mail",
            McpArea.Teams => "ms.teams",
            McpArea.Drive => "ms.drive",
            McpArea.OneNote => "ms.onenote",
            _ => throw new ArgumentOutOfRangeException(nameof(area)),
        };

        public static string For(McpArea area, McpAccessLevel level) => level switch
        {
            McpAccessLevel.Read => Prefix(area) + ".read",
            McpAccessLevel.ReadWrite => Prefix(area) + ".write",
            _ => throw new ArgumentOutOfRangeException(nameof(level)),
        };

        public static IReadOnlyList<string> Supported { get; } = Enum.GetValues<McpArea>()
            .SelectMany(a => WritableAreas.Contains(a) ? new[] { For(a, McpAccessLevel.Read), For(a, McpAccessLevel.ReadWrite) } : [For(a, McpAccessLevel.Read)])
            .Append(Destructive)
            .ToList();

        /// <summary>Every scope a permission set amounts to. Write implies read, so a write grant carries both.</summary>
        public static IReadOnlyList<string> Granted(McpPermissionSet permissions)
        {
            var scopes = new List<string>();
            foreach (var area in Enum.GetValues<McpArea>())
            {
                var level = permissions.Level(area);
                if (level >= McpAccessLevel.Read)
                    scopes.Add(For(area, McpAccessLevel.Read));
                if (level >= McpAccessLevel.ReadWrite && WritableAreas.Contains(area))
                    scopes.Add(For(area, McpAccessLevel.ReadWrite));
            }
            if (permissions.AllowDestructive)
                scopes.Add(Destructive);
            return scopes;
        }

        public static string Format(McpPermissionSet permissions) => string.Join(' ', Granted(permissions));

        /// <summary>
        /// The checklist the consent screen starts from. Without a recognised scope that is read-only for everything; with scopes, the areas they name, read-only.
        /// Scopes this server does not know (openid, offline_access) are ignored rather than refused.
        /// </summary>
        public static McpPermissionSet Requested(string? scope)
        {
            var parts = (scope ?? string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
            if (!parts.Overlaps(Supported))
                return McpPermissionSet.ReadOnly();

            // Asking for an area preselects it, but only ever for reading: write and delete start off, and only the user switches them on.
            var set = McpPermissionSet.None();
            foreach (var area in Enum.GetValues<McpArea>())
            {
                if (parts.Contains(For(area, McpAccessLevel.Read)) || (WritableAreas.Contains(area) && parts.Contains(For(area, McpAccessLevel.ReadWrite))))
                    set.Areas[area] = McpAccessLevel.Read;
            }
            return set;
        }

        /// <summary>Drops what cannot mean anything (write on a read-only area, an unknown area level) so a stored set is always one the tools understand.</summary>
        public static McpPermissionSet Normalize(McpPermissionSet? input)
        {
            var set = McpPermissionSet.None();
            if (input is null)
                return set;
            foreach (var (area, level) in input.Areas)
            {
                if (!Enum.IsDefined(area) || level <= McpAccessLevel.Off)
                    continue;
                set.Areas[area] = level >= McpAccessLevel.ReadWrite && WritableAreas.Contains(area) ? McpAccessLevel.ReadWrite : McpAccessLevel.Read;
            }
            set.AllowDestructive = input.AllowDestructive;
            set.MicrosoftAccountIds = input.MicrosoftAccountIds?.Distinct().Take(50).ToList();
            return set;
        }
    }
}
