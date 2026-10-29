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
    }

    public sealed class HelplyStoredTool
    {
        public string Id { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public string Status { get; set; } = HelplyToolStatus.Running;
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
        public Guid MessageId { get; set; }
        public string Request { get; set; } = string.Empty;
    }
}
