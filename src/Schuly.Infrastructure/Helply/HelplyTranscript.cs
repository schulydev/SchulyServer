using System.Text.Json;
using System.Text.Json.Serialization;

namespace Schuly.Infrastructure.Helply
{
    public static class HelplyToolStatus
    {
        public const string Running = "running";
        public const string Done = "done";
        public const string Failed = "failed";
        public const string Denied = "denied";
    }

    /// <summary>What the user sees in a conversation, plus the approvals still waiting for an answer. Stored encrypted; the model-side history lives in the session instead.</summary>
    public sealed class HelplyTranscript
    {
        public List<HelplyStoredMessage> Messages { get; set; } = [];
        public List<HelplyStoredApproval> Pending { get; set; } = [];

        private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

        public byte[] ToJson() => JsonSerializer.SerializeToUtf8Bytes(this, Options);

        public static HelplyTranscript FromJson(ReadOnlySpan<byte> json) => json.IsEmpty ? new HelplyTranscript() : JsonSerializer.Deserialize<HelplyTranscript>(json, Options) ?? new HelplyTranscript();
    }

    public sealed class HelplyStoredMessage
    {
        public Guid Id { get; set; }
        public string Role { get; set; } = "user";
        public string Text { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public List<HelplyStoredTool> Tools { get; set; } = [];
        public bool Failed { get; set; }
        /// <summary>Files on this message: the user's uploads, or the files Helply shared with its reply.</summary>
        public List<HelplyStoredAttachment> Attachments { get; set; } = [];
    }

    /// <summary>What the chat shows of an attachment. The bytes stay in the attachment table; this is only the label.</summary>
    public sealed class HelplyStoredAttachment
    {
        public Guid Id { get; set; }
        public string FileName { get; set; } = string.Empty;
        public string MediaType { get; set; } = string.Empty;
        public long SizeBytes { get; set; }
    }

    /// <summary>One command Helply ran in its workspace, as the user may inspect it: the command and the start of its output, both capped and redacted.</summary>
    public sealed class HelplyStoredCodeRun
    {
        public string Command { get; set; } = string.Empty;
        public string? Output { get; set; }
        public int? ExitCode { get; set; }
    }

    public sealed class HelplyStoredTool
    {
        public string Id { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public string Status { get; set; } = HelplyToolStatus.Running;
        /// <summary>Set for a workspace command (the bash tool).</summary>
        public HelplyStoredCodeRun? Code { get; set; }
        /// <summary>How much of the reply's text came before this step; null on steps stored before steps kept their place.</summary>
        public int? At { get; set; }
        /// <summary>A short note on the step built only from harmless arguments ("page 2", "unread only"); never names, addresses or search text.</summary>
        public string? Detail { get; set; }
        /// <summary>The stable key the web app translates the step's label by (the tool's name, or "generic"); null on steps stored before labels followed the language, which show <see cref="Label"/> as it is.</summary>
        public string? Key { get; set; }
        /// <summary>The structured arguments of that label (page number, flags, the tool's title); never names, addresses or search text.</summary>
        public Dictionary<string, string>? Args { get; set; }
    }

    public sealed class HelplyStoredDetail
    {
        public string Label { get; set; } = string.Empty;
        public string Value { get; set; } = string.Empty;
    }

    /// <summary>One tool call waiting for the user's yes or no. <see cref="Request"/> is the framework's serialized approval request, so the answer can be rebuilt on a later HTTP request.</summary>
    public sealed class HelplyStoredApproval
    {
        public string ApprovalId { get; set; } = string.Empty;
        public string ToolName { get; set; } = string.Empty;
        public string ToolCallId { get; set; } = string.Empty;
        public string ToolLabel { get; set; } = string.Empty;
        public string RunningLabel { get; set; } = string.Empty;
        public string DoneLabel { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public List<HelplyStoredDetail> Details { get; set; } = [];
        public bool Destructive { get; set; }
        /// <summary>Everything the call will send, labelled for people, in full (redacted like the rest).</summary>
        public List<HelplyStoredDetail> Arguments { get; set; } = [];
        /// <summary>"normal" or "high".</summary>
        public string Risk { get; set; } = "normal";
        public List<string> RiskReasons { get; set; } = [];
        /// <summary>SHA-256 over the tool name and the canonical arguments the user is asked to approve; empty for approvals stored before this existed, which cannot be approved.</summary>
        public string ArgumentsHash { get; set; } = string.Empty;
        public Guid MessageId { get; set; }
        public string Request { get; set; } = string.Empty;
    }
}
