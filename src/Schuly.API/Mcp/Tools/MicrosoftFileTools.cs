using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using Schuly.Domain.Mcp;
using static Schuly.API.Mcp.Tools.McpToolSupport;

namespace Schuly.API.Mcp.Tools
{
    /// <summary>Teams and SharePoint files, cross-source search, readable file contents and channel messages. All ids are opaque strings: they are passed back to the plugin exactly as returned.</summary>
    public sealed partial class MicrosoftTools
    {
        private static readonly string[] ReadableExtensions = [".docx", ".doc", ".xlsx", ".xlsm", ".xls", ".pptx", ".ppt", ".pdf", ".odt", ".ods", ".odp", ".rtf"];

        [McpServerTool(Name = "list_teams", Title = "List Teams and channels", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Lists the Microsoft Teams the user belongs to (classes, groups) with their channels in one call. Class teams hold the class documents; open one with list_team_files using teamId and optionally channelId.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> ListTeams(Guid? accountId = null, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var teams = Items(await ReadAsync($"{Base}/accounts/{account}/teams", ct)).ToList();
            using var gate = new SemaphoreSlim(4);
            var result = await Task.WhenAll(teams.Select(async t =>
            {
                var teamId = Str(t, "id");
                if (teamId is null)
                    return null;
                await gate.WaitAsync(ct);
                try
                {
                    var response = await plugins.GetAsync($"{Base}/accounts/{account}/teams/{Uri.EscapeDataString(teamId)}/channels", ct);
                    var channels = response.IsSuccess ? Items(response.Json()).Select(c => new { channelId = Str(c, "id"), name = Str(c, "displayName"), type = Str(c, "membershipType") }).ToList() : null;
                    return (object?)new { teamId, name = Str(t, "displayName"), description = Str(t, "description") is { Length: > 0 } d ? Cap(d, 200) : null, channels, channelsError = response.IsSuccess ? null : "Channels could not be loaded for this team." };
                }
                finally
                {
                    gate.Release();
                }
            }));
            return Serialize(new { accountId = account, teams = result.Where(r => r is not null) });
        }

        [McpServerTool(Name = "list_team_files", Title = "List Teams files", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Lists the files and folders of a team's Files library (SharePoint). Class documents such as exam plans, Masterplan, Pruefungsplaene, timetables and handouts usually live here: one folder per channel, General for class-wide documents. Without channelId it lists the library root. path is a sub-folder below the channel folder, e.g. Pruefungen/2026. Returns driveId and itemId for read_file and list_folder.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> ListTeamFiles([Description("teamId from list_teams.")] string teamId, [Description("channelId from list_teams. Omit for the library root.")] string? channelId = null, [Description("Sub-folder names below the channel folder, slash separated.")] string? path = null, Guid? accountId = null, [Description("Entries to skip, for paging.")] int offset = 0, [Description("Entries per call, 1-200.")] int limit = 100, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var url = $"{Base}/accounts/{account}/teams/{Uri.EscapeDataString(teamId)}/files?top=500"
                + (string.IsNullOrWhiteSpace(channelId) ? "" : $"&channelId={Uri.EscapeDataString(channelId)}")
                + (string.IsNullOrWhiteSpace(path) ? "" : $"&path={Uri.EscapeDataString(path.Trim('/'))}");
            var data = await ReadAsync(url, ct) ?? default;
            var folder = Prop(data, "folder");
            return Serialize(new
            {
                accountId = account,
                driveId = Str(data, "driveId"),
                folder = folder is { } f ? new { itemId = Str(f, "id"), name = Str(f, "name"), path = Str(f, "path") } : null,
                items = Page(Items(Prop(data, "items")).Select(DriveEntry), offset, limit, "entries"),
                hint = "Open a sub-folder with list_folder (driveId + itemId) or read a file with read_file (driveId + itemId).",
            });
        }

        [McpServerTool(Name = "list_folder", Title = "List a drive folder", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Lists the entries of any OneDrive or SharePoint folder by driveId and itemId, for example a folder found with search_files, list_shared_with_me, list_recent_files or list_team_files.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> ListFolder([Description("driveId of the folder, as returned by the other file tools.")] string driveId, [Description("itemId of the folder.")] string itemId, Guid? accountId = null, [Description("Entries to skip, for paging.")] int offset = 0, [Description("Entries per call, 1-200.")] int limit = 100, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var data = await ReadAsync($"{Base}/accounts/{account}/drives/{Uri.EscapeDataString(driveId)}/items/{Uri.EscapeDataString(itemId)}/children?top=500", ct);
            return Serialize(new { accountId = account, driveId, folderId = itemId, items = Page(Items(data).Select(DriveEntry), offset, limit, "entries") });
        }

        [McpServerTool(Name = "list_shared_with_me", Title = "Files shared with me", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Lists files and folders other people shared with the user (files others sent you), newest first, with who shared them. Read one with read_file, open a folder with list_folder.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> ListSharedWithMe(Guid? accountId = null, [Description("Entries to return, 1-100.")] int limit = 50, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var items = Items(await ReadAsync($"{Base}/accounts/{account}/files/shared?top={Math.Clamp(limit, 1, 100)}", ct)).Select(DriveEntry);
            return Serialize(new { accountId = account, items });
        }

        [McpServerTool(Name = "list_recent_files", Title = "Recent files", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Lists the files the user opened or changed recently, in OneDrive and SharePoint, with driveId and itemId for read_file.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> ListRecentFiles(Guid? accountId = null, [Description("Entries to return, 1-100.")] int limit = 30, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var items = Items(await ReadAsync($"{Base}/accounts/{account}/files/recent?top={Math.Clamp(limit, 1, 100)}", ct)).Select(DriveEntry);
            return Serialize(new { accountId = account, items });
        }

        [McpServerTool(Name = "search_files", Title = "Search files", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Searches file names and contents in the user's OneDrive, Teams and SharePoint. Start here for class documents such as exam plans, Masterplan, Pruefungsplaene, timetables and handouts; hits show where they live (location.label). Then read_file with driveId + itemId. teamId limits the search to one team's Files.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> SearchFiles([Description("Search text, 1-200 characters.")] string query, [Description("Only search this team's Files (teamId from list_teams).")] string? teamId = null, Guid? accountId = null, [Description("Hits to skip, for paging.")] int offset = 0, [Description("Hits per call, 1-50.")] int limit = 25, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var (from, size) = (Math.Max(0, offset), Math.Clamp(limit, 1, 50));
            var data = await WriteAsync(HttpMethods.Post, $"{Base}/accounts/{account}/files/search", new { q = query.Trim(), from, size, teamId = string.IsNullOrWhiteSpace(teamId) ? null : teamId }, ct) ?? default;
            return Serialize(SearchOutput(account, query, data));
        }

        [McpServerTool(Name = "search", Title = "Search everything", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Searches across files (OneDrive, Teams, SharePoint), and, when this connection also has the permission, mail (needs Mail read) and Teams chats and channel posts (needs Teams read). The result lists which sources were searched. Use it for 'find the Masterplan of class X'; then read_file for files or read_mail / list_channel_messages for the rest.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> Search([Description("Search text, 1-200 characters.")] string query, [Description("Limit files and channel posts to this team (teamId from list_teams).")] string? teamId = null, Guid? accountId = null, [Description("Hits to skip, for paging.")] int offset = 0, [Description("Hits per call, 1-50.")] int limit = 25, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var permissions = Caller(accessor).Permissions;
            var types = new List<string> { "files" };
            if (permissions.Allows(McpArea.Mail, McpAccessLevel.Read))
                types.Add("mail");
            if (permissions.Allows(McpArea.Teams, McpAccessLevel.Read))
                types.AddRange(["chats", "channels"]);
            var (from, size) = (Math.Max(0, offset), Math.Clamp(limit, 1, 50));
            var data = await WriteAsync(HttpMethods.Post, $"{Base}/accounts/{account}/search", new { q = query.Trim(), types, from, size, teamId = string.IsNullOrWhiteSpace(teamId) ? null : teamId }, ct) ?? default;
            return Serialize(SearchOutput(account, query, data, types));
        }

        [McpServerTool(Name = "read_file", Title = "Read file contents", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Reads a file as text: Word, Excel (one sheet at a time, paged by rows), PowerPoint, PDF and plain text files. Give itemId and, for Teams / SharePoint / shared files, the driveId from the listing or search; without driveId the file is in the user's own OneDrive. The answer says how to get the next page or other sheets.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> ReadFile([Description("itemId from a file listing or search.")] string itemId, [Description("driveId from the listing or search. Omit for the user's own OneDrive.")] string? driveId = null, Guid? accountId = null, [Description("Character offset (nextOffset of the previous page).")] int offset = 0, [Description("Characters per page, 200-100000.")] int maxChars = 20000, [Description("Excel sheet name. Default: the first sheet.")] string? sheet = null, [Description("Excel: first row to return (nextRowOffset of the previous page).")] int rowOffset = 0, [Description("Excel: rows per page, 1-2000.")] int maxRows = 500, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            return Serialize(await ReadFileTextAsync(account, driveId, itemId, offset, maxChars, sheet, rowOffset, maxRows, ct));
        }

        [McpServerTool(Name = "list_channel_messages", Title = "List channel messages", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Reads the latest posts of a Teams channel as plain text, newest first. With messageId it reads the replies of that post instead. Ids come from list_teams and search_channel_messages.")]
        [McpAccess(McpArea.Teams, McpAccessLevel.Read)]
        public async Task<string> ListChannelMessages([Description("teamId from list_teams.")] string teamId, [Description("channelId from list_teams.")] string channelId, Guid? accountId = null, [Description("Posts to return, 1-50.")] int limit = 20, [Description("Post id to read the replies of.")] string? messageId = null, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var root = $"{Base}/accounts/{account}/teams/{Uri.EscapeDataString(teamId)}/channels/{Uri.EscapeDataString(channelId)}/messages";
            var url = string.IsNullOrWhiteSpace(messageId) ? $"{root}?top={Math.Clamp(limit, 1, 50)}" : $"{root}/{Uri.EscapeDataString(messageId)}/replies?top={Math.Clamp(limit, 1, 50)}";
            var messages = Items(await ReadAsync(url, ct)).Select(m => new
            {
                messageId = Str(m, "id"),
                replyToId = Str(m, "replyToId"),
                from = Prop(m, "from") is { } f ? Str(f, "displayName") : null,
                at = Str(m, "createdDateTime"),
                subject = Str(m, "subject"),
                text = Cap(Str(m, "text") ?? string.Empty),
                attachments = Prop(m, "attachments") is { ValueKind: JsonValueKind.Array } a ? a.EnumerateArray().Select(x => new { name = Str(x, "name"), webUrl = Str(x, "webUrl") }).Take(20).ToList() : null,
                replyCount = Long(m, "replyCount"),
                webUrl = Str(m, "webUrl"),
            });
            return Serialize(new { accountId = account, teamId, channelId, thread = messageId, messages });
        }

        [McpServerTool(Name = "search_channel_messages", Title = "Search channel posts", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Searches posts in Teams channels (announcements, class channels). teamId limits the search to one team. Read a whole thread with list_channel_messages and its messageId.")]
        [McpAccess(McpArea.Teams, McpAccessLevel.Read)]
        public async Task<string> SearchChannelMessages([Description("Search text, 1-200 characters.")] string query, [Description("Only search this team (teamId from list_teams).")] string? teamId = null, Guid? accountId = null, [Description("Hits to skip, for paging.")] int offset = 0, [Description("Hits per call, 1-50.")] int limit = 25, CancellationToken ct = default)
        {
            var account = await AccountAsync(accountId, ct);
            var (from, size) = (Math.Max(0, offset), Math.Clamp(limit, 1, 50));
            var data = await WriteAsync(HttpMethods.Post, $"{Base}/accounts/{account}/search", new { q = query.Trim(), types = new[] { "channels" }, from, size, teamId = string.IsNullOrWhiteSpace(teamId) ? null : teamId }, ct) ?? default;
            return Serialize(SearchOutput(account, query, data, ["channels"]));
        }

        private async Task<object> ReadFileTextAsync(Guid account, string? driveId, string itemId, int offset, int maxChars, string? sheet, int rowOffset, int maxRows, CancellationToken ct)
        {
            var root = string.IsNullOrWhiteSpace(driveId) ? $"{Base}/accounts/{account}/files/{Uri.EscapeDataString(itemId)}" : $"{Base}/accounts/{account}/drives/{Uri.EscapeDataString(driveId)}/items/{Uri.EscapeDataString(itemId)}";
            var url = $"{root}/text?offset={Math.Max(0, offset)}&maxChars={Math.Clamp(maxChars, 200, 100000)}&rowOffset={Math.Max(0, rowOffset)}&maxRows={Math.Clamp(maxRows, 1, 2000)}" + (string.IsNullOrWhiteSpace(sheet) ? "" : $"&sheet={Uri.EscapeDataString(sheet)}");
            var d = await ReadAsync(url, ct) ?? default;

            var name = Str(d, "name");
            var nextOffset = Long(d, "nextOffset");
            var nextRow = Long(d, "nextRowOffset");
            var currentSheet = Str(d, "sheet");
            var sheets = Prop(d, "sheets") is { ValueKind: JsonValueKind.Array } s ? s.EnumerateArray().Select(x => new { name = Str(x, "name"), rows = Long(x, "rows"), columns = Long(x, "columns") }).ToList() : null;
            var hints = new List<string>();
            var ids = string.IsNullOrWhiteSpace(driveId) ? $"itemId='{itemId}'" : $"driveId='{driveId}', itemId='{itemId}'";
            if (nextRow is { } nr)
                hints.Add($"More rows of sheet '{currentSheet}': call read_file again with {ids}, sheet='{currentSheet}', rowOffset={nr}.");
            if (nextOffset is { } no)
                hints.Add($"More text: call read_file again with {ids}{(currentSheet is null ? "" : $", sheet='{currentSheet}', rowOffset={Long(d, "rowOffset") ?? 0}")}, offset={no}.");
            if (sheets is { Count: > 1 })
                hints.Add($"Other sheets: {string.Join(", ", sheets.Where(x => x.name != currentSheet).Select(x => $"'{x.name}'"))}. Pass sheet=<name> to read one.");

            return new
            {
                name,
                kind = Str(d, "kind"),
                text = Str(d, "text") ?? string.Empty,
                offset = Long(d, "offset"),
                nextOffset,
                totalChars = Long(d, "totalChars"),
                truncated = Bool(d, "truncated"),
                pages = Long(d, "pages"),
                sheet = currentSheet,
                sheets,
                rowOffset = Long(d, "rowOffset"),
                rowCount = Long(d, "rowCount"),
                nextRowOffset = nextRow,
                notes = Prop(d, "notes") is { ValueKind: JsonValueKind.Array } n ? n.EnumerateArray().Select(x => x.GetString()).OfType<string>().Take(10).ToList() : null,
                next = hints.Count == 0 ? null : hints,
            };
        }

        private static object DriveEntry(JsonElement i)
        {
            var folder = Prop(i, "folder");
            var shared = Prop(i, "shared");
            return new
            {
                itemId = Str(i, "id"),
                driveId = Prop(i, "parentReference") is { } p ? Str(p, "driveId") : null,
                name = Str(i, "name"),
                isFolder = folder is not null,
                childCount = folder is { } f ? Long(f, "childCount") : null,
                size = Long(i, "size"),
                modified = Str(i, "lastModifiedDateTime"),
                mimeType = Prop(i, "file") is { } file ? Str(file, "mimeType") : null,
                sharedBy = shared is { } sh && Prop(sh, "sharedBy") is { } by ? Person(by) : null,
                sharedAt = shared is { } sh2 ? Str(sh2, "sharedDateTime") : null,
                webUrl = Str(i, "webUrl"),
            };
        }

        private static string? Person(JsonElement? p)
        {
            if (p is not { } e)
                return null;
            var name = Str(e, "displayName");
            var email = Str(e, "email");
            return name is { Length: > 0 } && email is { Length: > 0 } ? $"{name} <{email}>" : name ?? email;
        }

        private static object SearchOutput(Guid account, string query, JsonElement data, List<string>? searched = null) => new
        {
            accountId = account,
            query,
            searched,
            hits = Items(Prop(data, "hits")).Select(SearchHit).ToList(),
            nextOffset = Long(data, "nextFrom"),
            moreAvailable = Bool(data, "moreAvailable"),
            totals = Prop(data, "totals") is { } t ? Clean(t) : null,
            fallback = Bool(data, "fallback") == true ? true : (bool?)null,
            errors = Prop(data, "errors") is { ValueKind: JsonValueKind.Array } e ? e.EnumerateArray().Select(x => x.GetString()).OfType<string>().Take(10).ToList() : null,
        };

        private static object SearchHit(JsonElement h)
        {
            var type = Str(h, "type");
            var id = Str(h, "id");
            var isFile = type == "file";
            var location = Prop(h, "location");
            return new
            {
                type,
                itemId = isFile ? id : null,
                messageId = isFile ? null : id,
                driveId = Str(h, "driveId"),
                title = Str(h, "title") is { } title ? Cap(title, 200) : null,
                snippet = Str(h, "snippet") is { } snippet ? Cap(snippet, 300) : null,
                date = Str(h, "date"),
                from = Person(Prop(h, "from")),
                size = Long(h, "size"),
                isFolder = Bool(h, "isFolder") == true ? true : (bool?)null,
                mimeType = Str(h, "mimeType"),
                location = location is { } l ? new { label = Str(l, "label"), kind = Str(l, "kind"), teamId = Str(l, "teamId"), channelId = Str(l, "channelId"), chatId = Str(l, "chatId"), path = Str(l, "path") } : null,
                webUrl = Str(h, "webUrl"),
            };
        }
    }
}
