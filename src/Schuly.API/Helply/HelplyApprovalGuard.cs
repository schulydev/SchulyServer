using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.AI;
using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Ties an approval to the exact call it was shown for. The hash covers the tool name and the arguments in a canonical form (object keys sorted, compact), so the same call
    /// always gives the same hash and any change to a recipient, a body or an id gives another one.
    /// </summary>
    public static class HelplyApprovalHash
    {
        public static string Compute(string toolName, IEnumerable<KeyValuePair<string, object?>>? arguments)
        {
            var args = new JsonObject();
            foreach (var (key, value) in arguments ?? [])
                args[key] = value is null ? null : JsonSerializer.SerializeToNode(value, AIJsonUtilities.DefaultOptions);
            var canonical = Canonical(args)!.ToJsonString();
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(toolName + "\n" + canonical)));
        }

        /// <summary>Recomputes the hash from the serialized request that is stored with an approval, which is what will run if the user approves it.</summary>
        public static string? OfStoredRequest(HelplyStoredApproval approval, JsonSerializerOptions options)
        {
            try
            {
                if (JsonSerializer.Deserialize<AIContent>(approval.Request, options) is ToolApprovalRequestContent { ToolCall: FunctionCallContent call } && call.Name == approval.ToolName)
                    return Compute(call.Name, call.Arguments);
            }
            catch (JsonException)
            {
            }
            return null;
        }

        /// <summary>True when the stored approval still describes the call its stored request would run.</summary>
        public static bool Matches(HelplyStoredApproval approval, JsonSerializerOptions options) =>
            approval.ArgumentsHash.Length > 0 && OfStoredRequest(approval, options) is { } actual && string.Equals(actual, approval.ArgumentsHash, StringComparison.Ordinal);

        private static JsonNode? Canonical(JsonNode? node) => node switch
        {
            JsonObject obj => new JsonObject(obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => KeyValuePair.Create(p.Key, Canonical(p.Value?.DeepClone())))),
            JsonArray array => new JsonArray(array.Select(i => Canonical(i?.DeepClone())).ToArray()),
            _ => node?.DeepClone(),
        };
    }

    /// <summary>The calls the user approved in this turn, by hash. A hash can be used once: it is gone after the call it approved has run (or been refused).</summary>
    public sealed class HelplyApprovalGuard
    {
        private readonly object _gate = new();
        private readonly List<string> _approved = [];

        public void Approve(string hash)
        {
            lock (_gate)
                _approved.Add(hash);
        }

        public bool TryConsume(string hash)
        {
            lock (_gate)
                return _approved.Remove(hash);
        }
    }

    /// <summary>
    /// Wraps a tool that needs approval. Whatever reaches it must carry exactly the name and arguments the user approved in this turn; otherwise it does not run and the model is told
    /// to ask again. The framework's own approval step sits outside this wrapper, so this is the second lock on the same door.
    /// </summary>
    public sealed class HelplyGuardedFunction(AIFunction inner, HelplyApprovalGuard guard) : DelegatingAIFunction(inner)
    {
        public const string NotApproved = "This action was not approved as requested; ask the user again.";

        protected override ValueTask<object?> InvokeCoreAsync(AIFunctionArguments arguments, CancellationToken cancellationToken)
        {
            if (!guard.TryConsume(HelplyApprovalHash.Compute(Name, arguments)))
                return new ValueTask<object?>(JsonSerializer.SerializeToElement(new { isError = true, content = new[] { new { type = "text", text = NotApproved } } }));
            return base.InvokeCoreAsync(arguments, cancellationToken);
        }
    }
}
