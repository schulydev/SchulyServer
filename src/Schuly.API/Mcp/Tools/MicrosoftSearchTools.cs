using System.Collections.Concurrent;
using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using Schuly.Domain.Mcp;
using static Schuly.API.Mcp.Tools.McpToolSupport;

namespace Schuly.API.Mcp.Tools
{
    /// <summary>
    /// The cross-source search. One call fans out over several terms and several sources, merges what comes back into one deduplicated, ranked list and says which sources it searched or skipped.
    /// Files, mail, chats and channel posts come from the plugin's search endpoint (one request per term and page), OneNote page titles from the plugin's OneNote search.
    /// </summary>
    public sealed partial class MicrosoftTools
    {
        public const int MaxSearchTerms = 8;
        public const int MaxMergedHits = 200;
        private const int SearchConcurrency = 4;
        private const int SearchPageSize = 50;
        private const int MaxPagesPerTerm = 4;
        private static readonly TimeSpan SearchTimeout = TimeSpan.FromSeconds(25);

        private static readonly string[] SearchSourceNames = ["files", "channels", "mail", "chats", "pages"];

        [McpServerTool(Name = "search", Title = "Search everything", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Searches across files (OneDrive, Teams, SharePoint), OneNote page titles and, when this connection also has the permission, mail (needs Mail read) and Teams chats and channel posts (needs Teams read), and returns ONE merged, ranked list. Put every synonym in a single call: query is the main text and terms are alternatives that are OR'd (for a test: terms=['Prüfung','Test','Lernkontrolle','Masterplan','LK']), and use from/to (yyyy-MM-dd, modified or received date) to cut old results, instead of calling search several times. Each hit says which source it came from, where it lives (location.label), who wrote it, when it changed, its link and which terms matched, plus the ids for the read tool named in readWith (file: driveId + itemId for read_file; page: pageId for read_page; mail: messageId for read_mail; channel: teamId, channelId and messageId from location for list_channel_messages). The answer lists the sources searched and skipped and sets partial when something could not be searched completely. OneNote matches page titles only.")]
        [McpAccess(McpArea.Drive, McpAccessLevel.Read)]
        public async Task<string> Search([Description("Main search text, 1-200 characters. Optional when terms is given.")] string? query = null, [Description("Alternative search terms (synonyms, other languages), at most 8, each 1-200 characters. A hit matches if any term matches; the hit lists matchedTerms.")] string[]? terms = null, [Description("Only results modified or received on or after this date, yyyy-MM-dd.")] DateOnly? from = null, [Description("Only results modified or received on or before this date, yyyy-MM-dd.")] DateOnly? to = null, [Description("Limit the sources: any of files, channels (channel posts), mail, chats, pages (OneNote page titles). Default: every source this connection may read.")] string[]? sources = null, [Description("Limit files and channel posts to this team (teamId from list_teams). OneNote is not searched then.")] string? teamId = null, Guid? accountId = null, [Description("Merged hits to skip, for paging.")] int offset = 0, [Description("Merged hits per call, 1-50.")] int limit = 25, CancellationToken ct = default)
        {
            var searchTerms = SearchTerms(query, terms);
            if (from is { } f && to is { } t && f > t)
                throw new McpException("from must not be after to.");
            var wanted = ParseSearchSources(sources);
            var account = await AccountAsync(accountId, ct);
            var permissions = Caller(accessor).Permissions;
            offset = Math.Max(0, offset);
            limit = Math.Clamp(limit, 1, 50);

            var skipped = new List<object>();
            var types = new List<string>();
            var searchPages = false;
            foreach (var source in SearchSourceNames)
            {
                var reason = !wanted.Contains(source) ? "not requested"
                    : source == "mail" && !permissions.Allows(McpArea.Mail, McpAccessLevel.Read) ? "needs Mail read"
                    : source is "chats" or "channels" && !permissions.Allows(McpArea.Teams, McpAccessLevel.Read) ? "needs Teams read"
                    : source == "pages" && !permissions.Allows(McpArea.OneNote, McpAccessLevel.Read) ? "needs OneNote read"
                    : source == "pages" && !string.IsNullOrWhiteSpace(teamId) ? "teamId limits the search to Teams files and channel posts"
                    : null;
                if (reason is not null)
                    skipped.Add(new { source, reason });
                else if (source == "pages")
                    searchPages = true;
                else
                    types.Add(source);
            }
            var searched = searchPages ? [.. types, "pages"] : types.ToList();
            if (searched.Count == 0)
                throw new McpException("None of the requested sources can be searched with this connection's permissions: " + string.Join("; ", skipped.Select(s => JsonSerializer.Serialize(s, Json))));

            var pagesPerTerm = Math.Clamp((int)Math.Ceiling((offset + limit) / (double)SearchPageSize) + (from is not null || to is not null ? 1 : 0), 1, MaxPagesPerTerm);
            var run = new SearchRun();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(SearchTimeout);
            using var gate = new SemaphoreSlim(SearchConcurrency);

            async Task GuardedAsync(string label, Func<CancellationToken, Task> work)
            {
                await gate.WaitAsync(timeout.Token);
                try
                {
                    await work(timeout.Token);
                    Interlocked.Increment(ref run.Succeeded);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    run.Errors.Add($"{label}: timed out");
                }
                catch (McpException ex)
                {
                    run.Errors.Add($"{label}: {ex.Message}");
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    run.Errors.Add($"{label}: failed");
                }
                finally
                {
                    gate.Release();
                }
            }

            var tasks = new List<Task>();
            foreach (var term in searchTerms)
            {
                if (types.Count > 0)
                    tasks.Add(GuardedAsync(string.Join("/", types), c => SearchPluginAsync(account, term, types, teamId, pagesPerTerm, run, c)));
                if (searchPages)
                    tasks.Add(GuardedAsync("pages", c => SearchPageTitlesAsync(account, term, run, c)));
            }
            try
            {
                await Task.WhenAll(tasks);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                run.Errors.Add("search: timed out");
            }
            ct.ThrowIfCancellationRequested();
            if (run.Succeeded == 0 && run.Errors.Count > 0)
                throw new McpException(run.Errors.First());

            var merged = MergeSearchHits(run.Hits.ToList(), searchTerms, from, to);
            var truncated = merged.Count > MaxMergedHits;
            if (truncated)
                merged = merged.Take(MaxMergedHits).ToList();
            var page = merged.Skip(offset).Take(limit).ToList();
            var next = offset + page.Count < merged.Count ? offset + page.Count : (int?)null;
            var notes = new List<string>();
            if (run.MoreAtBackend)
                notes.Add($"Some sources have more results than were fetched ({pagesPerTerm * SearchPageSize} per term and source). Narrow the search with from/to, sources or more specific terms.");
            if (truncated)
                notes.Add($"Only the best {MaxMergedHits} merged hits are kept.");

            return Serialize(new
            {
                accountId = account,
                terms = searchTerms,
                from,
                to,
                searched,
                skipped,
                partial = run.Errors.Count > 0 || run.MoreAtBackend || truncated,
                total = merged.Count,
                offset,
                nextOffset = next,
                hits = page.Select(SearchHitOutput).ToList(),
                notes = notes.Count == 0 ? null : notes,
                errors = run.Errors.Count == 0 ? null : run.Errors.Take(10).ToList(),
            });
        }

        private async Task SearchPluginAsync(Guid account, string term, List<string> types, string? teamId, int pages, SearchRun run, CancellationToken ct)
        {
            for (var p = 0; p < pages; p++)
            {
                var data = await WriteAsync(HttpMethods.Post, $"{Base}/accounts/{account}/search", new { q = term, types, from = p * SearchPageSize, size = SearchPageSize, teamId = string.IsNullOrWhiteSpace(teamId) ? null : teamId }, ct) ?? default;
                var hits = Items(Prop(data, "hits")).ToList();
                var rank = p * SearchPageSize;
                foreach (var h in hits)
                    if (PluginHit(h, term, rank++) is { } hit)
                        run.Hits.Add(hit);
                if (Prop(data, "errors") is { ValueKind: JsonValueKind.Array } errors)
                    foreach (var e in errors.EnumerateArray().Select(x => x.GetString()).OfType<string>().Take(5))
                        run.Errors.Add(e);
                var more = Bool(data, "moreAvailable") == true;
                if (!more || hits.Count == 0)
                    return;
                if (p == pages - 1)
                    run.MoreAtBackend = true;
            }
        }

        private async Task SearchPageTitlesAsync(Guid account, string term, SearchRun run, CancellationToken ct)
        {
            var data = await SearchPagesRawAsync(account, term.Length > 100 ? term[..100] : term, null, SearchPageSize, ct) ?? default;
            var rank = 0;
            foreach (var h in Items(Prop(data, "items")))
            {
                var id = Str(h, "id");
                if (id is null)
                    continue;
                var notebook = Prop(h, "notebook") is { } n ? Str(n, "displayName") : null;
                var section = Prop(h, "section") is { } s ? Str(s, "displayName") : null;
                run.Hits.Add(new RawSearchHit("pages", id, null, Str(h, "title"), null, null, Str(h, "lastModifiedDateTime"), string.Join(" > ", new[] { notebook, section }.Where(x => !string.IsNullOrEmpty(x))), new SearchLocation("onenote", null, null, null, null), Str(h, "webUrl"), null, null, null, term, rank++));
            }
            if (Bool(data, "partial") == true)
                run.MoreAtBackend = true;
        }

        private static RawSearchHit? PluginHit(JsonElement h, string term, int rank)
        {
            var source = Str(h, "type") switch { "file" => "files", "mail" => "mail", "chat" => "chats", "channel" => "channels", _ => null };
            var id = Str(h, "id");
            if (source is null || id is null)
                return null;
            var location = Prop(h, "location");
            var loc = location is { } l ? new SearchLocation(Str(l, "kind"), Str(l, "teamId"), Str(l, "channelId"), Str(l, "chatId"), Str(l, "path")) : new SearchLocation(null, null, null, null, null);
            return new RawSearchHit(source, id, Str(h, "driveId"), Str(h, "title"), Str(h, "snippet"), Person(Prop(h, "from")), Str(h, "date"), location is { } l2 ? Str(l2, "label") : null, loc, Str(h, "webUrl"), Long(h, "size"), Str(h, "mimeType"), Bool(h, "isFolder") == true ? true : null, term, rank);
        }

        /// <summary>The distinct, trimmed search texts: query first, then terms, at most <see cref="MaxSearchTerms"/>.</summary>
        public static List<string> SearchTerms(string? query, string[]? terms)
        {
            var result = new List<string>();
            foreach (var raw in new[] { query }.Concat(terms ?? []))
            {
                var text = raw?.Trim();
                if (string.IsNullOrEmpty(text))
                    continue;
                if (text.Length > 200 || text.Any(char.IsControl))
                    throw new McpException("Every search text must be 1 to 200 characters without control characters.");
                if (!result.Contains(text, StringComparer.OrdinalIgnoreCase))
                    result.Add(text);
            }
            if (result.Count == 0)
                throw new McpException("Give query, terms or both.");
            if (result.Count > MaxSearchTerms)
                throw new McpException($"At most {MaxSearchTerms} search texts (query plus terms) per call. Keep the most distinctive synonyms.");
            return result;
        }

        private static HashSet<string> ParseSearchSources(string[]? sources)
        {
            if (sources is not { Length: > 0 })
                return [.. SearchSourceNames];
            var result = new HashSet<string>();
            foreach (var raw in sources)
            {
                var name = raw?.Trim().ToLowerInvariant() switch
                {
                    "file" or "files" or "drive" => "files",
                    "channel" or "channels" or "posts" or "channel posts" => "channels",
                    "mail" or "email" or "emails" => "mail",
                    "chat" or "chats" => "chats",
                    "page" or "pages" or "onenote" => "pages",
                    _ => throw new McpException($"Unknown source '{raw}'. Use files, channels, mail, chats or pages."),
                };
                result.Add(name);
            }
            return result;
        }

        /// <summary>
        /// Merges per-term results: one entry per item (source + drive + id) with the terms that found it, filtered to the date range, ordered by
        /// a title match first, then the number of terms matched, then the best rank the source gave it, then the newest date.
        /// </summary>
        public static List<MergedSearchHit> MergeSearchHits(IEnumerable<RawSearchHit> raw, IReadOnlyList<string> terms, DateOnly? from, DateOnly? to)
        {
            var merged = new Dictionary<string, MergedSearchHit>();
            foreach (var hit in raw)
            {
                var key = $"{hit.Source}|{hit.DriveId}|{hit.Id}";
                if (!merged.TryGetValue(key, out var entry))
                    merged[key] = entry = new MergedSearchHit(hit);
                if (!entry.MatchedTerms.Contains(hit.Term))
                    entry.MatchedTerms.Add(hit.Term);
                entry.BestRank = Math.Min(entry.BestRank, hit.Rank);
                if (string.IsNullOrEmpty(entry.Hit.Snippet) && !string.IsNullOrEmpty(hit.Snippet))
                    entry.Hit = entry.Hit with { Snippet = hit.Snippet };
            }
            var folded = terms.ToDictionary(t => t, Fold);
            foreach (var entry in merged.Values)
            {
                var title = Fold(entry.Hit.Title ?? string.Empty);
                entry.TitleMatch = entry.MatchedTerms.Any(t => folded.TryGetValue(t, out var f) && f.Length > 0 && title.Contains(f, StringComparison.Ordinal));
                entry.Date = DateTimeOffset.TryParse(entry.Hit.Date, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : null;
            }
            return merged.Values
                .Where(e => e.Date is not { } d || ((from is null || DateOnly.FromDateTime(d.UtcDateTime) >= from) && (to is null || DateOnly.FromDateTime(d.UtcDateTime) <= to)))
                .OrderByDescending(e => e.TitleMatch)
                .ThenByDescending(e => e.MatchedTerms.Count)
                .ThenBy(e => e.BestRank)
                .ThenByDescending(e => e.Date ?? DateTimeOffset.MinValue)
                .ToList();
        }

        private static string Fold(string text)
        {
            var decomposed = text.Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder(decomposed.Length);
            foreach (var c in decomposed)
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                    sb.Append(char.ToLowerInvariant(c));
            return sb.ToString().Trim();
        }

        private static object SearchHitOutput(MergedSearchHit e)
        {
            var h = e.Hit;
            var loc = h.Location;
            return new
            {
                source = h.Source,
                itemId = h.Source == "files" ? h.Id : null,
                driveId = h.DriveId,
                messageId = h.Source is "mail" or "chats" or "channels" ? h.Id : null,
                pageId = h.Source == "pages" ? h.Id : null,
                readWith = h.Source switch { "files" => h.IsFolder == true ? "list_folder" : "read_file", "mail" => "read_mail", "channels" => "list_channel_messages", "chats" => "read_chat_messages", _ => "read_page" },
                title = h.Title is { } title ? Cap(title, 200) : null,
                snippet = h.Snippet is { } snippet ? Cap(snippet, 300) : null,
                author = h.Author,
                modified = h.Date,
                location = new { label = h.Label, kind = loc.Kind, teamId = loc.TeamId, channelId = loc.ChannelId, chatId = loc.ChatId, path = loc.Path },
                webUrl = h.WebUrl,
                size = h.Size,
                mimeType = h.MimeType,
                isFolder = h.IsFolder,
                matchedTerms = e.MatchedTerms.ToList(),
            };
        }

        private sealed class SearchRun
        {
            public ConcurrentBag<RawSearchHit> Hits { get; } = [];
            public ConcurrentBag<string> Errors { get; } = [];
            public volatile bool MoreAtBackend;
            public int Succeeded;
        }
    }

    public sealed record SearchLocation(string? Kind, string? TeamId, string? ChannelId, string? ChatId, string? Path);

    /// <summary>One hit as a source returned it for one search text. <paramref name="Rank"/> is its position in that source's own list (0 is best).</summary>
    public sealed record RawSearchHit(string Source, string Id, string? DriveId, string? Title, string? Snippet, string? Author, string? Date, string? Label, SearchLocation Location, string? WebUrl, long? Size, string? MimeType, bool? IsFolder, string Term, int Rank);

    public sealed class MergedSearchHit(RawSearchHit hit)
    {
        public RawSearchHit Hit { get; set; } = hit;
        public List<string> MatchedTerms { get; } = [];
        public int BestRank { get; set; } = int.MaxValue;
        public bool TitleMatch { get; set; }
        public DateTimeOffset? Date { get; set; }
    }
}
