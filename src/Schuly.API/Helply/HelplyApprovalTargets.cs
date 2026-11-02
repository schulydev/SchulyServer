using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Looks up what the ids of an approval-required call point to, so the card says "Delete the email 'Exam dates' from Anna" instead of "Delete an email". The lookups go through the
    /// run's own MCP session, so they carry the user's permissions, and only tools MCP itself marks read-only can be used for them. A lookup that fails never blocks the approval; the
    /// card says it could not look the target up.
    /// </summary>
    public static partial class HelplyApprovalTargets
    {
        private const int MaxPart = 120;
        private const int MaxIdShown = 48;

        private static readonly HashSet<string> MailTools = new(StringComparer.Ordinal) { "reply_mail", "forward_mail", "move_mail", "flag_mail", "mark_mail_read", "delete_mail" };

        public static async Task<HelplyTarget?> ResolveAsync(HelplyToolSet tools, string toolName, IDictionary<string, object?>? args, CancellationToken ct)
        {
            if (MailTools.Contains(toolName))
                return await MailAsync(tools, args, ct);
            return toolName switch
            {
                "send_chat_message" => await ChatAsync(tools, args, ct),
                "withdraw_absence_report" => await AbsencesAsync(tools, args, ct),
                _ => null,
            };
        }

        private static async Task<HelplyTarget> MailAsync(HelplyToolSet tools, IDictionary<string, object?>? args, CancellationToken ct)
        {
            var id = HelplyToolLabels.Text(args, "messageId") ?? string.Empty;
            if (id.Length > 0 && Lookup(args, out var call))
            {
                call["messageId"] = id;
                call["maxChars"] = 200;
                if (await tools.CallReadOnlyAsync("read_mail", call, ct) is { } text && Parse(text) is { } root)
                {
                    using (root)
                    {
                        var subject = Part(root.RootElement, "subject");
                        var from = Part(root.RootElement, "from");
                        var received = Part(root.RootElement, "received");
                        var date = DateTimeOffset.TryParse(received, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed) ? parsed.ToString("d MMM yyyy", CultureInfo.InvariantCulture) : received;
                        if (subject is not null || from is not null)
                        {
                            var description = "the email" + (subject is null ? "" : $" \"{subject.Replace('"', '\'')}\"") + (from is null ? "" : $" from {from}") + (date is null ? "" : $" ({date})");
                            var rows = new List<HelplyStoredDetail>();
                            AddRow(rows, "Email subject", subject);
                            AddRow(rows, "From", from);
                            AddRow(rows, "Date", date);
                            return new HelplyTarget(description, rows);
                        }
                    }
                }
            }
            return new HelplyTarget($"an email (couldn't look up this email, id {Short(id)})", [new HelplyStoredDetail { Label = "Email", Value = $"Couldn't look up this email (id {Short(id)})" }]);
        }

        private static async Task<HelplyTarget> ChatAsync(HelplyToolSet tools, IDictionary<string, object?>? args, CancellationToken ct)
        {
            var id = HelplyToolLabels.Text(args, "chatId") ?? string.Empty;
            if (id.Length > 0 && Lookup(args, out var call))
            {
                call["limit"] = 50;
                if (await tools.CallReadOnlyAsync("list_chats", call, ct) is { } text && Parse(text) is { } root)
                {
                    using (root)
                    {
                        if (root.RootElement.TryGetProperty("chats", out var chats) && chats.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var chat in chats.EnumerateArray())
                            {
                                if (!string.Equals(Part(chat, "chatId"), id, StringComparison.Ordinal))
                                    continue;
                                var topic = Part(chat, "topic");
                                var members = chat.TryGetProperty("members", out var list) && list.ValueKind == JsonValueKind.Array ? list.EnumerateArray().Select(m => Clean(m.GetString())).OfType<string>().ToList() : [];
                                var rows = new List<HelplyStoredDetail>();
                                AddRow(rows, "Chat", topic);
                                AddRow(rows, "Members", members.Count == 0 ? null : string.Join(", ", members));
                                if (topic is null && members.Count == 0)
                                    break;
                                var description = topic is not null ? $"the Teams chat \"{topic.Replace('"', '\'')}\"" : $"the Teams chat with {string.Join(", ", members)}";
                                return new HelplyTarget(description, rows);
                            }
                        }
                    }
                }
            }
            return new HelplyTarget($"a Teams chat (couldn't look up this chat, id {Short(id)})", [new HelplyStoredDetail { Label = "Chat", Value = $"Couldn't look up this chat (id {Short(id)})" }]);
        }

        private static async Task<HelplyTarget> AbsencesAsync(HelplyToolSet tools, IDictionary<string, object?>? args, CancellationToken ct)
        {
            var ids = HelplyToolLabels.Strings(args, "ids");
            if (ids.Count == 0)
                return new HelplyTarget("a reported absence (couldn't look up which one)", [new HelplyStoredDetail { Label = "Report", Value = "Couldn't look up which report (no id given)" }]);

            JsonDocument? root = null;
            if (Lookup(args, out var call) && await tools.CallReadOnlyAsync("list_reported_absences", call, ct) is { } text)
                root = Parse(text);
            using (root)
            {
                var reports = root is not null && root.RootElement.TryGetProperty("reported", out var list) && list.ValueKind == JsonValueKind.Array ? list.EnumerateArray().ToList() : [];
                var rows = new List<HelplyStoredDetail>();
                var described = new List<string>();
                foreach (var id in ids)
                {
                    var match = reports.Where(r => r.ValueKind == JsonValueKind.Object && r.TryGetProperty("id", out var value) && string.Equals(Scalar(value), id, StringComparison.OrdinalIgnoreCase)).Select(r => (JsonElement?)r).FirstOrDefault();
                    var line = match is { } found ? Describe(found) : null;
                    if (line is null)
                    {
                        rows.Add(new HelplyStoredDetail { Label = "Report", Value = $"Couldn't look up this report (id {Short(id)})" });
                        described.Add($"a report that couldn't be looked up (id {Short(id)})");
                    }
                    else
                    {
                        rows.Add(new HelplyStoredDetail { Label = "Report", Value = line });
                        described.Add(line);
                    }
                }
                return new HelplyTarget(described.Count == 1 ? "the reported absence " + described[0] : $"{described.Count} reported absences: " + string.Join("; ", described), rows);
            }
        }

        /// <summary>A reported absence as one line: its dates, times and reason, from whichever of the usual fields the school system sent; otherwise its first few plain fields.</summary>
        private static string? Describe(JsonElement report)
        {
            string? First(params string[] names) => names.Select(n => report.TryGetProperty(n, out var v) ? Clean(Scalar(v)) : null).FirstOrDefault(v => v is not null);
            var from = First("dateFrom", "from", "date", "start");
            var to = First("dateTo", "to", "end");
            var dates = from is not null && to is not null && from != to ? $"{from} to {to}" : from ?? to;
            var hourFrom = First("hourFrom");
            var hourTo = First("hourTo");
            var hours = hourFrom is null ? null : $"{hourFrom} - {hourTo}";
            var reason = First("reason", "reasonText", "absenceReason");
            var comment = First("comment");
            var parts = new[] { dates, hours, reason is null ? null : $"reason: {reason}", comment is null ? null : $"note: {comment}" }.OfType<string>().ToList();
            if (parts.Count > 0)
                return string.Join(", ", parts);
            var fallback = report.EnumerateObject().Where(p => p.Name != "id").Select(p => (p.Name, Value: Clean(Scalar(p.Value)))).Where(p => p.Value is not null).Take(5).Select(p => $"{p.Name}: {p.Value}").ToList();
            return fallback.Count == 0 ? null : string.Join(", ", fallback);
        }

        /// <summary>The account to look in, when the call names one. A name that is not a Guid cannot be looked up (the real tool would refuse it too).</summary>
        private static bool Lookup(IDictionary<string, object?>? args, out Dictionary<string, object?> call)
        {
            call = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (HelplyToolLabels.Text(args, "accountId") is { Length: > 0 } account)
            {
                if (!Guid.TryParse(account, out var id))
                    return false;
                call["accountId"] = id.ToString();
            }
            return true;
        }

        private static JsonDocument? Parse(string text)
        {
            try
            {
                return JsonDocument.Parse(text);
            }
            catch (JsonException)
            {
                return null;
            }
        }

        private static string? Scalar(JsonElement value) => value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => value.GetRawText(),
            _ => null,
        };

        private static string? Part(JsonElement element, string name) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? Clean(Scalar(value)) : null;

        /// <summary>One line, trimmed and capped: the text comes from a mailbox or a chat and must not be able to shape the card.</summary>
        private static string? Clean(string? text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return null;
            var line = Whitespace().Replace(text, " ").Trim();
            return line.Length <= MaxPart ? line : line[..MaxPart].TrimEnd() + "...";
        }

        private static string Short(string id) => id.Length <= MaxIdShown ? id : id[..MaxIdShown] + "...";

        private static void AddRow(List<HelplyStoredDetail> rows, string label, string? value)
        {
            if (value is not null)
                rows.Add(new HelplyStoredDetail { Label = label, Value = value });
        }

        [GeneratedRegex(@"\s+")]
        private static partial Regex Whitespace();
    }

    /// <summary>Marks the calls whose effect is hard to take back or reaches beyond the user: sending to outside addresses, deleting, and telling the school.</summary>
    public static class HelplyApprovalRisk
    {
        public const string Normal = "normal";
        public const string High = "high";

        /// <param name="ownDomains">The mail domains of the user's linked Microsoft accounts. With none known, every recipient counts as outside.</param>
        public static (string Risk, List<string> Reasons) Assess(string toolName, IDictionary<string, object?>? args, IReadOnlyCollection<string> ownDomains)
        {
            var reasons = new List<string>();
            if (toolName is "send_mail" or "forward_mail")
            {
                var recipients = new[] { "to", "cc", "bcc" }.SelectMany(n => HelplyToolLabels.Strings(args, n)).SelectMany(s => s.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                var outside = recipients.Where(r => !ownDomains.Contains(DomainOf(r), StringComparer.OrdinalIgnoreCase)).ToList();
                if (outside.Count > 0)
                    reasons.Add("Goes to an address outside your school: " + string.Join(", ", outside));
            }
            if (toolName == "delete_mail")
                reasons.Add("Deletes the email");
            if (toolName == "withdraw_absence_report")
                reasons.Add("Withdraws the report and can't be undone");
            if (toolName == "report_absence")
                reasons.Add("The school sees this immediately");
            return (reasons.Count > 0 ? High : Normal, reasons);
        }

        public static string DomainOf(string address)
        {
            var text = address.Trim();
            var open = text.LastIndexOf('<');
            var close = text.LastIndexOf('>');
            if (open >= 0 && close > open)
                text = text[(open + 1)..close];
            var at = text.LastIndexOf('@');
            return at < 0 ? string.Empty : text[(at + 1)..].Trim().ToLowerInvariant();
        }
    }
}
