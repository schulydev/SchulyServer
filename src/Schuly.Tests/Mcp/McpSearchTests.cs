using System.Text.Json;
using System.Web;
using TUnit.Assertions.Enums;
using Schuly.API.Helply;
using Schuly.Domain.Mcp;
using static Schuly.Tests.Mcp.McpTestSupport;

namespace Schuly.Tests.Mcp
{
    /// <summary>The upgraded cross-source search: terms, date range, sources, OneNote titles, merging, ranking and partial results.</summary>
    public partial class McpFileToolsTests
    {
        private static string Hits(params string[] hits) => "{\"hits\":[" + string.Join(",", hits) + "]}";

        private static string FileHit(string id, string title, string date)
        {
            var when = date.Length == 0 ? "null" : "\"" + date + "\"";
            return "{\"type\":\"file\",\"id\":\"" + id + "\",\"driveId\":\"b!d\",\"title\":\"" + title + "\",\"snippet\":\"s-" + id + "\",\"date\":" + when + ",\"from\":{\"displayName\":\"Anna\",\"email\":\"a@x\"},\"location\":{\"kind\":\"team\",\"teamId\":\"t1\",\"label\":\"Team BM23d > General\"},\"webUrl\":\"https://x/" + id + "\"}";
        }

        private static string MailHit(string id, string title, string date) =>
            "{\"type\":\"mail\",\"id\":\"" + id + "\",\"title\":\"" + title + "\",\"snippet\":\"m\",\"date\":\"" + date + "\",\"from\":{\"displayName\":\"Bob\",\"email\":\"b@x\"},\"location\":{\"kind\":\"mailbox\",\"label\":\"Mailbox\"}}";

        private static string QueryOf(Seen seen) => seen.Method == "POST" ? JsonDocument.Parse(seen.Body).RootElement.GetProperty("q").GetString()! : HttpUtility.ParseQueryString(seen.Query)["q"]!;

        private static List<string> Ids(JsonElement result) => result.GetProperty("hits").EnumerateArray().Select(h => (h.TryGetProperty("itemId", out var i) ? i : h.TryGetProperty("messageId", out var m) ? m : h.GetProperty("pageId")).GetString()!).ToList();

        [Test]
        public async Task Search_fans_out_over_all_terms_in_one_call_and_merges_duplicates_by_item()
        {
            var (host, client, seen) = await StartAsync(nameof(Search_fans_out_over_all_terms_in_one_call_and_merges_duplicates_by_item), Only((McpArea.Drive, McpAccessLevel.Read), (McpArea.Mail, McpAccessLevel.Read)), request => QueryOf(request) switch
            {
                "Pruefung" => Hits(FileHit("A", "Pruefung Plan.xlsx", "2026-10-01T08:00:00Z"), FileHit("B", "Notizen.docx", "2026-09-01T08:00:00Z")),
                "Test" => Hits(FileHit("B", "Notizen.docx", "2026-09-01T08:00:00Z"), MailHit("C", "Test 3 Termin", "2026-10-20T08:00:00Z")),
                "Lernkontrolle" => Hits(FileHit("B", "Notizen.docx", "2026-09-01T08:00:00Z")),
                _ => Hits(),
            });
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "search", new() { ["query"] = "Pruefung", ["terms"] = new[] { "Test", "test", "Lernkontrolle", " " } });

            var requests = seen.ToList();
            await Assert.That(requests.Count).IsEqualTo(3);
            await Assert.That(requests.Select(QueryOf)).IsEquivalentTo(new[] { "Pruefung", "Test", "Lernkontrolle" });
            await Assert.That(result.GetProperty("terms").EnumerateArray().Select(t => t.GetString()!)).IsEquivalentTo(new[] { "Pruefung", "Test", "Lernkontrolle" });

            // Title matches come first (A, then C by its rank); B was found by all three terms but has no title match, so it follows. It appears once.
            var hits = result.GetProperty("hits").EnumerateArray().ToList();
            await Assert.That(hits.Count).IsEqualTo(3);
            await Assert.That(hits[0].GetProperty("itemId").GetString()).IsEqualTo("A");
            await Assert.That(hits[1].GetProperty("messageId").GetString()).IsEqualTo("C");
            await Assert.That(hits[1].GetProperty("source").GetString()).IsEqualTo("mail");
            await Assert.That(hits[1].GetProperty("readWith").GetString()).IsEqualTo("read_mail");
            await Assert.That(hits[2].GetProperty("itemId").GetString()).IsEqualTo("B");
            await Assert.That(hits[2].GetProperty("matchedTerms").EnumerateArray().Select(t => t.GetString()!)).IsEquivalentTo(new[] { "Pruefung", "Test", "Lernkontrolle" });
            await Assert.That(hits[0].GetProperty("author").GetString()).IsEqualTo("Anna <a@x>");
            await Assert.That(hits[0].GetProperty("modified").GetString()).IsEqualTo("2026-10-01T08:00:00Z");
            await Assert.That(hits[0].GetProperty("location").GetProperty("label").GetString()).IsEqualTo("Team BM23d > General");
            await Assert.That(result.GetProperty("total").GetInt32()).IsEqualTo(3);
        }

        [Test]
        public async Task Search_ranks_more_matched_terms_before_recency_and_pages_the_merged_list()
        {
            var (host, client, _) = await StartAsync(nameof(Search_ranks_more_matched_terms_before_recency_and_pages_the_merged_list), Only((McpArea.Drive, McpAccessLevel.Read)), request => QueryOf(request) switch
            {
                "alpha" => Hits(FileHit("OLD", "x1", "2025-01-01T00:00:00Z"), FileHit("BOTH", "x2", "2025-02-01T00:00:00Z")),
                "beta" => Hits(FileHit("NEW", "x3", "2026-05-01T00:00:00Z"), FileHit("BOTH", "x2", "2025-02-01T00:00:00Z")),
                _ => Hits(),
            });
            await using var _h = host;
            await using var _c = client;

            // BOTH matched two terms. OLD and NEW tie on terms and rank, so the newer one comes first.
            var all = await CallAsync(client, "search", new() { ["terms"] = new[] { "alpha", "beta" } });
            await Assert.That(Ids(all)).IsEquivalentTo(new[] { "BOTH", "NEW", "OLD" }, CollectionOrdering.Matching);

            var second = await CallAsync(client, "search", new() { ["terms"] = new[] { "alpha", "beta" }, ["limit"] = 1, ["offset"] = 1 });
            await Assert.That(Ids(second)).IsEquivalentTo(new[] { "NEW" });
            await Assert.That(second.GetProperty("nextOffset").GetInt32()).IsEqualTo(2);
            await Assert.That(second.GetProperty("total").GetInt32()).IsEqualTo(3);
        }

        [Test]
        public async Task Search_filters_by_the_modified_date_range_and_keeps_undated_hits()
        {
            var (host, client, _) = await StartAsync(nameof(Search_filters_by_the_modified_date_range_and_keeps_undated_hits), Only((McpArea.Drive, McpAccessLevel.Read)), _ => Hits(FileHit("OLD", "a", "2026-08-31T23:00:00Z"), FileHit("IN1", "b", "2026-09-01T00:00:00Z"), FileHit("IN2", "c", "2026-10-31T22:00:00Z"), FileHit("LATE", "d", "2026-11-01T01:00:00Z"), FileHit("NODATE", "e", "")));
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "search", new() { ["query"] = "plan", ["from"] = "2026-09-01", ["to"] = "2026-10-31" });
            await Assert.That(Ids(result)).IsEquivalentTo(new[] { "IN1", "IN2", "NODATE" });

            var bad = await client.CallToolAsync("search", new Dictionary<string, object?> { ["query"] = "plan", ["from"] = "2026-10-31", ["to"] = "2026-09-01" });
            await Assert.That(bad.IsError ?? false).IsTrue();
        }

        [Test]
        public async Task Search_adds_OneNote_page_titles_only_with_OneNote_read_and_honours_the_sources_filter()
        {
            const string pages = """{"items":[{"id":"P1","title":"Pruefungstermine","notebook":{"displayName":"BM23d"},"section":{"displayName":"Deutsch"},"lastModifiedDateTime":"2026-10-02T08:00:00Z","webUrl":"https://x/p1"}],"partial":false}""";
            var (host, client, seen) = await StartAsync(nameof(Search_adds_OneNote_page_titles_only_with_OneNote_read_and_honours_the_sources_filter), Only((McpArea.Drive, McpAccessLevel.Read), (McpArea.OneNote, McpAccessLevel.Read)), request => request.Path == "onenote/search" ? pages : Hits(FileHit("F1", "Plan", "2026-10-01T00:00:00Z")));
            await using var _h = host;
            await using var _c = client;

            var both = await CallAsync(client, "search", new() { ["query"] = "Pruefung" });
            await Assert.That(both.GetProperty("searched").EnumerateArray().Select(t => t.GetString() ?? "")).IsEquivalentTo(new[] { "files", "pages" });
            var page = both.GetProperty("hits").EnumerateArray().Single(h => h.GetProperty("source").GetString() == "pages");
            await Assert.That(page.GetProperty("pageId").GetString()).IsEqualTo("P1");
            await Assert.That(page.GetProperty("readWith").GetString()).IsEqualTo("read_page");
            await Assert.That(page.GetProperty("location").GetProperty("label").GetString()).IsEqualTo("BM23d > Deutsch");
            await Assert.That(page.GetProperty("title").GetString()).IsEqualTo("Pruefungstermine");

            seen.Clear();
            var onlyPages = await CallAsync(client, "search", new() { ["query"] = "Pruefung", ["sources"] = new[] { "OneNote" } });
            await Assert.That(seen.Select(s => s.Path)).IsEquivalentTo(new[] { "onenote/search" });
            await Assert.That(onlyPages.GetProperty("searched").EnumerateArray().Select(t => t.GetString() ?? "")).IsEquivalentTo(new[] { "pages" });
            await Assert.That(onlyPages.GetProperty("skipped").EnumerateArray().All(s => s.GetProperty("reason").GetString() == "not requested")).IsTrue();

            seen.Clear();
            var scoped = await CallAsync(client, "search", new() { ["query"] = "Pruefung", ["teamId"] = "t1" });
            await Assert.That(seen.Select(s => s.Path)).IsEquivalentTo(new[] { "search" });
            await Assert.That(scoped.GetProperty("skipped").EnumerateArray().Any(s => s.GetProperty("source").GetString() == "pages")).IsTrue();
        }

        [Test]
        public async Task Search_without_OneNote_read_never_calls_the_OneNote_endpoint_and_a_requested_source_that_is_not_allowed_is_an_error()
        {
            var (host, client, seen) = await StartAsync(nameof(Search_without_OneNote_read_never_calls_the_OneNote_endpoint_and_a_requested_source_that_is_not_allowed_is_an_error), Only((McpArea.Drive, McpAccessLevel.Read)), _ => Hits());
            await using var _h = host;
            await using var _c = client;

            await CallAsync(client, "search", new() { ["query"] = "x" });
            await Assert.That(seen.Any(s => s.Path.StartsWith("onenote"))).IsFalse();

            var denied = await client.CallToolAsync("search", new Dictionary<string, object?> { ["query"] = "x", ["sources"] = new[] { "mail", "pages" } });
            await Assert.That(denied.IsError ?? false).IsTrue();
            await Assert.That(seen.Count).IsEqualTo(1);
        }

        [Test]
        public async Task Search_reports_a_failing_source_as_partial_and_still_returns_the_others()
        {
            var (host, client, _) = await StartAsync(nameof(Search_reports_a_failing_source_as_partial_and_still_returns_the_others), Only((McpArea.Drive, McpAccessLevel.Read), (McpArea.OneNote, McpAccessLevel.Read)), request => request.Path == "onenote/search" ? null : Hits(FileHit("F1", "Plan", "2026-10-01T00:00:00Z")));
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "search", new() { ["query"] = "Plan" });
            await Assert.That(Ids(result)).IsEquivalentTo(new[] { "F1" });
            await Assert.That(result.GetProperty("partial").GetBoolean()).IsTrue();
            await Assert.That(result.GetProperty("errors").EnumerateArray().Any(e => e.GetString()!.StartsWith("pages:"))).IsTrue();

            var (host2, client2, _) = await StartAsync(nameof(Search_reports_a_failing_source_as_partial_and_still_returns_the_others) + "B", Only((McpArea.Drive, McpAccessLevel.Read)), _ => null);
            await using var _h2 = host2;
            await using var _c2 = client2;
            var failed = await client2.CallToolAsync("search", new Dictionary<string, object?> { ["query"] = "Plan" });
            await Assert.That(failed.IsError ?? false).IsTrue();
        }

        [Test]
        public async Task Search_needs_a_text_and_caps_the_number_of_terms()
        {
            var (host, client, seen) = await StartAsync(nameof(Search_needs_a_text_and_caps_the_number_of_terms), Only((McpArea.Drive, McpAccessLevel.Read)), _ => Hits());
            await using var _h = host;
            await using var _c = client;

            var none = await client.CallToolAsync("search", new Dictionary<string, object?> { ["terms"] = new[] { " " } });
            await Assert.That(none.IsError ?? false).IsTrue();
            var many = await client.CallToolAsync("search", new Dictionary<string, object?> { ["query"] = "a", ["terms"] = Enumerable.Range(0, 8).Select(i => "t" + i).ToArray() });
            await Assert.That(many.IsError ?? false).IsTrue();
            await Assert.That(seen.IsEmpty).IsTrue();
        }

        [Test]
        public async Task The_prompt_teaches_one_search_call_with_terms_and_a_date_range()
        {
            var prompt = HelplyPrompt.System(DateTimeOffset.UtcNow);

            await Assert.That(prompt).Contains("as terms");
            await Assert.That(prompt).Contains("from/to date range");
            await Assert.That(prompt).Contains("fall back to search_files");
        }
    }
}
