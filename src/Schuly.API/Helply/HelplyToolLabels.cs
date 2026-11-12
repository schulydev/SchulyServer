using System.Collections;
using System.Text.Json;
using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    /// <summary>What the ids of a call point to, looked up through the same MCP session: a phrase for the summary ("the email 'Exam dates' from Anna (28 Oct 2026)") and the rows shown on the card.</summary>
    public sealed record HelplyTarget(string Description, List<HelplyStoredDetail> Rows);

    /// <summary>What the user is told about a tool call: plain-language labels while it runs and when it is done, and, for tools that act, the approval summary built from the call's arguments.</summary>
    public static class HelplyToolLabels
    {
        public const int BodyPreviewLength = 300;

        private static readonly Dictionary<string, (string Running, string Done)> Labels = new(StringComparer.Ordinal)
        {
            ["bash"] = ("Running code", "Ran code"),
            ["read_file"] = ("Reading a workspace file", "Read a workspace file"),
            ["write_file"] = ("Writing a workspace file", "Wrote a workspace file"),
            ["share_file"] = ("Sharing a file", "Shared a file"),
            ["get_profile"] = ("Reading your profile", "Read your profile"),
            ["list_school_accounts"] = ("Checking your school accounts", "Checked your school accounts"),
            ["list_grades"] = ("Looking up your grades", "Looked up your grades"),
            ["list_semester_reports"] = ("Looking up your semester reports", "Looked up your semester reports"),
            ["list_exams"] = ("Checking your exams", "Checked your exams"),
            ["list_subjects"] = ("Looking up your subjects", "Looked up your subjects"),
            ["list_agenda"] = ("Checking your agenda", "Checked your agenda"),
            ["list_assessments"] = ("Looking up your tests and deadlines", "Looked up your tests and deadlines"),
            ["list_absences"] = ("Checking your absences", "Checked your absences"),
            ["list_documents"] = ("Looking through your documents", "Looked through your documents"),
            ["read_document"] = ("Reading a document", "Read a document"),
            ["list_mail_folders"] = ("Checking your mail folders", "Checked your mail folders"),
            ["list_mail"] = ("Reading your mail list", "Read your mail list"),
            ["read_mail"] = ("Reading an email", "Read an email"),
            ["send_mail"] = ("Sending an email", "Sent an email"),
            ["reply_mail"] = ("Replying to an email", "Replied to an email"),
            ["forward_mail"] = ("Forwarding an email", "Forwarded an email"),
            ["move_mail"] = ("Moving an email", "Moved an email"),
            ["flag_mail"] = ("Flagging an email", "Flagged an email"),
            ["mark_mail_read"] = ("Updating the read status of an email", "Updated the read status of an email"),
            ["delete_mail"] = ("Deleting an email", "Deleted an email"),
            ["list_chats"] = ("Checking your Teams chats", "Checked your Teams chats"),
            ["read_chat_messages"] = ("Reading a Teams chat", "Read a Teams chat"),
            ["send_chat_message"] = ("Sending a Teams message", "Sent a Teams message"),
            ["list_drive_items"] = ("Browsing your OneDrive", "Browsed your OneDrive"),
            ["read_drive_file"] = ("Reading a OneDrive file", "Read a OneDrive file"),
            ["list_teams"] = ("Looking up your Teams", "Looked up your Teams"),
            ["list_team_files"] = ("Browsing a team's files", "Browsed a team's files"),
            ["list_folder"] = ("Browsing a folder", "Browsed a folder"),
            ["list_shared_with_me"] = ("Checking files shared with you", "Checked files shared with you"),
            ["list_recent_files"] = ("Checking your recent files", "Checked your recent files"),
            ["search_files"] = ("Searching your files", "Searched your files"),
            ["search"] = ("Searching your files, notes, mail and chats", "Searched your files, notes, mail and chats"),
            ["read_file"] = ("Reading a file", "Read a file"),
            ["list_channel_messages"] = ("Reading a Teams channel", "Read a Teams channel"),
            ["search_channel_messages"] = ("Searching Teams channels", "Searched Teams channels"),
            ["list_notebooks"] = ("Checking your OneNote notebooks", "Checked your OneNote notebooks"),
            ["list_sections"] = ("Checking your OneNote sections", "Checked your OneNote sections"),
            ["list_pages"] = ("Checking your OneNote pages", "Checked your OneNote pages"),
            ["read_page"] = ("Reading a OneNote page", "Read a OneNote page"),
            ["search_pages"] = ("Searching your OneNote pages", "Searched your OneNote pages"),
            ["create_page"] = ("Creating a OneNote page", "Created a OneNote page"),
            ["update_page"] = ("Updating a OneNote page", "Updated a OneNote page"),
            ["list_calendar_events"] = ("Checking your calendar", "Checked your calendar"),
            ["list_reported_absences"] = ("Checking your reported absences", "Checked your reported absences"),
            ["list_absence_reasons"] = ("Checking the absence reasons", "Checked the absence reasons"),
            ["report_absence"] = ("Reporting an absence", "Reported an absence"),
            ["withdraw_absence_report"] = ("Withdrawing an absence report", "Withdrew an absence report"),
        };

        public static IReadOnlyCollection<string> KnownTools => Labels.Keys;

        private static readonly Dictionary<string, string> WellKnownFolders = new(StringComparer.OrdinalIgnoreCase)
        {
            ["sentitems"] = "sent mail",
            ["drafts"] = "drafts",
            ["deleteditems"] = "deleted mail",
            ["archive"] = "archive",
            ["junkemail"] = "junk mail",
        };

        /// <summary>One harmless fact about a call. <see cref="Key"/> and <see cref="Value"/> are what the web app translates; <see cref="English"/> is the same note as plain English for clients that do not.</summary>
        public sealed record StepNote(string Key, string Value, string English);

        private static readonly string[] SearchSources = ["files", "channels", "mail", "chats", "pages"];

        /// <summary>The key the web app translates a step by: the tool's name when it has a label of its own, otherwise "generic".</summary>
        public static string Key(string toolName) => Labels.ContainsKey(toolName) ? toolName : GenericKey;

        public const string GenericKey = "generic";

        /// <summary>The structured arguments of a step label: the notes of <see cref="Notes"/> by key, plus the tool's title ("name") for a tool without a label of its own. Null when there is nothing to say.</summary>
        public static Dictionary<string, string>? Args(string toolName, string? title, IDictionary<string, object?>? args)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            if (!Labels.ContainsKey(toolName) && !string.IsNullOrWhiteSpace(title))
                result["name"] = title;
            foreach (var note in Notes(toolName, args))
                result[note.Key] = note.Value;
            return result.Count == 0 ? null : result;
        }

        /// <summary>
        /// A short note under a step in the chat ("page 2", "unread only"), built only from arguments that say nothing personal: paging numbers, flags, well-known folder names and the number of search terms and the sources searched.
        /// Search text, ids, names and addresses never go into it. Null when there is nothing worth saying.
        /// </summary>
        public static string? Detail(string toolName, IDictionary<string, object?>? args)
        {
            var notes = Notes(toolName, args);
            return notes.Count == 0 ? null : string.Join(" · ", notes.Select(n => n.English));
        }

        public static List<StepNote> Notes(string toolName, IDictionary<string, object?>? args)
        {
            var notes = new List<StepNote>();
            if (args is null)
                return notes;
            if (Number(args, "offset") is > 0 and var offset)
            {
                if (toolName.StartsWith("read_", StringComparison.Ordinal))
                    notes.Add(new StepNote("continued", "true", "continued"));
                else if (Number(args, "limit") is > 0 and var limit)
                    notes.Add(new StepNote("page", (offset / limit + 1).ToString(System.Globalization.CultureInfo.InvariantCulture), $"page {offset / limit + 1}"));
                else
                    notes.Add(new StepNote("more", "true", "more results"));
            }
            if (Bool(args, "unreadOnly") == true)
                notes.Add(new StepNote("unreadOnly", "true", "unread only"));
            if (Text(args, "folder") is { } folder && WellKnownFolders.TryGetValue(folder, out var folderName))
                notes.Add(new StepNote("folder", folder.ToLowerInvariant(), folderName));
            if (toolName == "list_mail" && !string.IsNullOrWhiteSpace(Text(args, "search")))
                notes.Add(new StepNote("withSearch", "true", "with a search"));
            if (toolName == "search")
            {
                var terms = Strings(args, "terms").Count(t => !string.IsNullOrWhiteSpace(t));
                if (terms > 0)
                    notes.Add(new StepNote("terms", terms.ToString(System.Globalization.CultureInfo.InvariantCulture), terms == 1 ? "1 term" : $"{terms} terms"));
                var sources = Strings(args, "sources").Select(s => s.Trim().ToLowerInvariant()).ToHashSet();
                var named = SearchSources.Where(sources.Contains).ToList();
                if (named.Count > 0)
                    notes.Add(new StepNote("sources", string.Join(",", named), "in " + string.Join(", ", named)));
            }
            return notes;
        }

        private static long? Number(IDictionary<string, object?> args, string name) => args.TryGetValue(name, out var value) ? value switch
        {
            int i => i,
            long l => l,
            JsonElement { ValueKind: JsonValueKind.Number } e when e.TryGetInt64(out var n) => n,
            JsonElement { ValueKind: JsonValueKind.String } e when long.TryParse(e.GetString(), out var n) => n,
            string s when long.TryParse(s, out var n) => n,
            _ => null,
        } : null;

        private static bool? Bool(IDictionary<string, object?> args, string name) => args.TryGetValue(name, out var value) ? value switch
        {
            bool b => b,
            JsonElement { ValueKind: JsonValueKind.True } => true,
            JsonElement { ValueKind: JsonValueKind.False } => false,
            string s when bool.TryParse(s, out var b) => b,
            _ => null,
        } : null;

        /// <summary>The running and done labels for a tool; an unknown tool falls back to its title, then to a generic phrase.</summary>
        public static (string Running, string Done) For(string toolName, string? title)
        {
            if (Labels.TryGetValue(toolName, out var labels))
                return labels;
            return string.IsNullOrWhiteSpace(title) ? ("Using a tool", "Used a tool") : ($"Using {title}", $"Used {title}");
        }

        /// <summary>The argument names each approval-required tool takes, in the order and with the labels the card shows. Arguments not listed here are still shown, under their own name.</summary>
        private static readonly Dictionary<string, (string Name, string Label)[]> ArgumentLabels = new(StringComparer.Ordinal)
        {
            ["send_mail"] = [("to", "To"), ("cc", "Cc"), ("bcc", "Bcc"), ("subject", "Subject"), ("body", "Body")],
            ["reply_mail"] = [("messageId", "Email id"), ("replyAll", "Reply to everyone"), ("comment", "Reply")],
            ["forward_mail"] = [("messageId", "Email id"), ("to", "To"), ("comment", "Note")],
            ["move_mail"] = [("messageId", "Email id"), ("folder", "Folder")],
            ["flag_mail"] = [("messageId", "Email id"), ("status", "Flag")],
            ["mark_mail_read"] = [("messageId", "Email id"), ("read", "Mark as read")],
            ["delete_mail"] = [("messageId", "Email id")],
            ["send_chat_message"] = [("chatId", "Chat id"), ("text", "Message")],
            ["report_absence"] = [("dateFrom", "From date"), ("dateTo", "To date"), ("hourFrom", "From time"), ("hourTo", "To time"), ("reason", "Reason"), ("comment", "Comment")],
            ["withdraw_absence_report"] = [("ids", "Report ids")],
            ["create_page"] = [("sectionId", "Section id"), ("title", "Page title"), ("content", "Content")],
            ["update_page"] = [("pageId", "Page id"), ("title", "New title"), ("appendText", "Text to append")],
        };

        /// <summary>Every argument of the call with a human label: what the "Show everything that will be sent" block lists. Nothing is shortened.</summary>
        public static List<HelplyStoredDetail> AllArguments(string toolName, IDictionary<string, object?>? args)
        {
            var rows = new List<HelplyStoredDetail>();
            if (args is null)
                return rows;
            var known = ArgumentLabels.TryGetValue(toolName, out var labels) ? labels : [];
            foreach (var (name, label) in known)
                if (Text(args, name) is { Length: > 0 } value)
                    rows.Add(new HelplyStoredDetail { Label = label, Value = value });
            foreach (var key in args.Keys.Except(known.Select(k => k.Name), StringComparer.Ordinal).OrderBy(k => k, StringComparer.Ordinal))
                if (Text(args, key) is { Length: > 0 } value)
                    rows.Add(new HelplyStoredDetail { Label = key == "accountId" ? "Account id" : key, Value = value });
            return rows;
        }

        /// <summary>The approval card for a call: its heading, the one-line summary and the detail rows. Built from the arguments, so what the user approves is what will run. A resolved target (what the ids point to) goes into the summary and the first rows.</summary>
        public static (string ToolLabel, string Summary, List<HelplyStoredDetail> Details) Approval(string toolName, string? title, IDictionary<string, object?>? args, HelplyTarget? target = null)
        {
            var heading = string.IsNullOrWhiteSpace(title) ? toolName : title;
            var details = new List<HelplyStoredDetail>();
            if (target is not null)
                details.AddRange(target.Rows);

            void Add(string label, string? value)
            {
                if (!string.IsNullOrWhiteSpace(value))
                    details.Add(new HelplyStoredDetail { Label = label, Value = value });
            }

            string Arg(string name) => Text(args, name) ?? string.Empty;
            var mail = target?.Description ?? "an email";

            string summary;
            switch (toolName)
            {
                case "send_mail":
                    summary = $"Send an email to {Or(Arg("to"), "the given recipients")} with the subject \"{Arg("subject")}\"";
                    Add("To", Arg("to"));
                    Add("Cc", Arg("cc"));
                    Add("Bcc", Arg("bcc"));
                    Add("Subject", Arg("subject"));
                    Add("Body preview", Preview(Arg("body")));
                    break;
                case "reply_mail":
                    summary = (Text(args, "replyAll") is "True" or "true" ? "Reply to everyone on " : "Reply to ") + mail;
                    Add("Reply", Preview(Arg("comment")));
                    break;
                case "forward_mail":
                    summary = $"Forward {mail} to {Or(Arg("to"), "the given recipients")}";
                    Add("To", Arg("to"));
                    Add("Note", Preview(Arg("comment")));
                    break;
                case "move_mail":
                    summary = $"Move {mail} to the folder \"{Arg("folder")}\"";
                    Add("Folder", Arg("folder"));
                    break;
                case "flag_mail":
                    summary = $"Set the flag of {mail} to \"{Arg("status")}\"";
                    Add("Flag", Arg("status"));
                    break;
                case "mark_mail_read":
                    summary = $"Mark {mail} as " + (Text(args, "read") is "False" or "false" ? "unread" : "read");
                    break;
                case "delete_mail":
                    summary = $"Delete {mail}";
                    break;
                case "send_chat_message":
                    summary = $"Send a message in {target?.Description ?? "a Teams chat"}";
                    Add("Message", Preview(Arg("text")));
                    break;
                case "report_absence":
                    summary = $"Report an absence from {Arg("dateFrom")} to {Arg("dateTo")}";
                    Add("From", Arg("dateFrom"));
                    Add("To", Arg("dateTo"));
                    Add("Reason", Arg("reason"));
                    Add("Comment", Preview(Arg("comment")));
                    Add("Hours", string.IsNullOrWhiteSpace(Arg("hourFrom")) ? null : $"{Arg("hourFrom")} - {Arg("hourTo")}");
                    break;
                case "withdraw_absence_report":
                    summary = "Withdraw " + (target?.Description ?? "a reported absence");
                    break;
                case "create_page":
                    summary = $"Create the OneNote page \"{Arg("title")}\"";
                    Add("Page title", Arg("title"));
                    Add("Content preview", Preview(Arg("content")));
                    break;
                case "update_page":
                    summary = string.IsNullOrWhiteSpace(Arg("title")) ? $"Add text to {target?.Description ?? "a OneNote page"}" : $"Rename {target?.Description ?? "a OneNote page"} to \"{Arg("title")}\"" + (string.IsNullOrWhiteSpace(Arg("appendText")) ? string.Empty : " and add text");
                    Add("New title", Arg("title"));
                    Add("Text to append", Preview(Arg("appendText")));
                    break;
                default:
                    summary = $"Use {heading}";
                    break;
            }

            return (heading, summary, details);
        }

        /// <summary>An argument as a list of strings: an array's items, or the single value.</summary>
        public static List<string> Strings(IDictionary<string, object?>? args, string name)
        {
            if (args is null || !args.TryGetValue(name, out var value) || value is null)
                return [];
            return value switch
            {
                string s => [s],
                JsonElement { ValueKind: JsonValueKind.String } e => [e.GetString() ?? string.Empty],
                JsonElement { ValueKind: JsonValueKind.Array } e => e.EnumerateArray().Select(i => i.ValueKind == JsonValueKind.String ? i.GetString() ?? string.Empty : i.GetRawText()).ToList(),
                JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => [],
                JsonElement e => [e.GetRawText()],
                IEnumerable list => list.Cast<object?>().Select(i => i?.ToString() ?? string.Empty).ToList(),
                _ => [value.ToString() ?? string.Empty],
            };
        }

        private static string Or(string value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value;

        private static string? Preview(string text)
        {
            var trimmed = text.Trim();
            if (trimmed.Length == 0)
                return null;
            return trimmed.Length <= BodyPreviewLength ? trimmed : trimmed[..BodyPreviewLength] + "...";
        }

        /// <summary>An argument as display text: strings as they are, lists joined with commas, anything else as its JSON.</summary>
        public static string? Text(IDictionary<string, object?>? args, string name)
        {
            if (args is null || !args.TryGetValue(name, out var value) || value is null)
                return null;
            return value switch
            {
                string s => s,
                JsonElement { ValueKind: JsonValueKind.String } e => e.GetString(),
                JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
                JsonElement { ValueKind: JsonValueKind.Array } e => string.Join(", ", e.EnumerateArray().Select(i => i.ValueKind == JsonValueKind.String ? i.GetString() : i.GetRawText())),
                JsonElement e => e.GetRawText(),
                IEnumerable list and not string => string.Join(", ", list.Cast<object?>().Select(i => i?.ToString())),
                _ => value.ToString(),
            };
        }
    }
}
