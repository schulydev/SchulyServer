using System.Collections;
using System.Text.Json;
using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    /// <summary>What the user is told about a tool call: plain-language labels while it runs and when it is done, and, for tools that act, the approval summary built from the call's arguments.</summary>
    public static class HelplyToolLabels
    {
        public const int BodyPreviewLength = 300;

        private static readonly Dictionary<string, (string Running, string Done)> Labels = new(StringComparer.Ordinal)
        {
            ["get_profile"] = ("Reading your profile", "Read your profile"),
            ["list_school_accounts"] = ("Checking your school accounts", "Checked your school accounts"),
            ["list_grades"] = ("Looking up your grades", "Looked up your grades"),
            ["list_semester_reports"] = ("Looking up your semester reports", "Looked up your semester reports"),
            ["list_exams"] = ("Checking your exams", "Checked your exams"),
            ["list_agenda"] = ("Checking your agenda", "Checked your agenda"),
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
            ["list_notebooks"] = ("Checking your OneNote notebooks", "Checked your OneNote notebooks"),
            ["list_calendar_events"] = ("Checking your calendar", "Checked your calendar"),
            ["list_reported_absences"] = ("Checking your reported absences", "Checked your reported absences"),
            ["list_absence_reasons"] = ("Checking the absence reasons", "Checked the absence reasons"),
            ["report_absence"] = ("Reporting an absence", "Reported an absence"),
            ["withdraw_absence_report"] = ("Withdrawing an absence report", "Withdrew an absence report"),
        };

        public static IReadOnlyCollection<string> KnownTools => Labels.Keys;

        /// <summary>The running and done labels for a tool; an unknown tool falls back to its title, then to a generic phrase.</summary>
        public static (string Running, string Done) For(string toolName, string? title)
        {
            if (Labels.TryGetValue(toolName, out var labels))
                return labels;
            return string.IsNullOrWhiteSpace(title) ? ("Using a tool", "Used a tool") : ($"Using {title}", $"Used {title}");
        }

        /// <summary>The approval card for a call: its heading, the one-line summary and the detail rows. Built from the arguments, so what the user approves is what will run.</summary>
        public static (string ToolLabel, string Summary, List<HelplyStoredDetail> Details) Approval(string toolName, string? title, IDictionary<string, object?>? args)
        {
            var heading = string.IsNullOrWhiteSpace(title) ? toolName : title;
            var details = new List<HelplyStoredDetail>();

            void Add(string label, string? value)
            {
                if (!string.IsNullOrWhiteSpace(value))
                    details.Add(new HelplyStoredDetail { Label = label, Value = value });
            }

            string Arg(string name) => Text(args, name) ?? string.Empty;

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
                    summary = Text(args, "replyAll") == "True" || Text(args, "replyAll") == "true" ? "Reply to everyone on an email" : "Reply to an email";
                    Add("Reply", Preview(Arg("comment")));
                    break;
                case "forward_mail":
                    summary = $"Forward an email to {Or(Arg("to"), "the given recipients")}";
                    Add("To", Arg("to"));
                    Add("Note", Preview(Arg("comment")));
                    break;
                case "move_mail":
                    summary = $"Move an email to the folder \"{Arg("folder")}\"";
                    Add("Folder", Arg("folder"));
                    break;
                case "flag_mail":
                    summary = $"Set the flag of an email to \"{Arg("status")}\"";
                    Add("Flag", Arg("status"));
                    break;
                case "mark_mail_read":
                    summary = Text(args, "read") is "False" or "false" ? "Mark an email as unread" : "Mark an email as read";
                    break;
                case "delete_mail":
                    summary = "Delete an email";
                    break;
                case "send_chat_message":
                    summary = "Send a message in a Teams chat";
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
                    summary = "Withdraw a reported absence";
                    break;
                default:
                    summary = $"Use {heading}";
                    break;
            }

            return (heading, summary, details);
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
