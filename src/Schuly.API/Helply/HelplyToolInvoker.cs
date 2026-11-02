using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Every tool call of a Helply turn runs through here (it is the function invoker of the tool loop), for MCP tools and workspace tools alike:
    /// <list type="bullet">
    /// <item>A call whose arguments are larger than the cap is refused before it runs, so the model cannot push a whole file into a mail or a message in one call.</item>
    /// <item>A call repeated with identical arguments gets a reminder in its result, and the loop ends at <see cref="TerminateAt"/> repeats (ported from Tessaly's repeat guard).</item>
    /// <item>A result longer than the cap is cut with a note, so no tool can flood the prompt. Tessaly left tool results uncapped.</item>
    /// </list>
    /// </summary>
    public sealed class HelplyToolInvoker(int maxArgumentChars, int maxResultChars)
    {
        public const int GentleAt = 3;
        public const int DetailedAt = 5;
        public const int TerminateAt = 8;

        private const string GentleReminder = "You are repeating the exact same tool call with identical arguments. Look at the previous result before calling again: if the task is not done, try a different approach or different arguments instead.";

        public async ValueTask<object?> InvokeAsync(FunctionInvocationContext context, CancellationToken cancellationToken)
        {
            var size = ArgumentChars(context.Arguments);
            if (size > maxArgumentChars)
                return Error(string.Create(CultureInfo.InvariantCulture, $"Refused: the arguments are {size:N0} characters long and a tool call may carry at most {maxArgumentChars:N0}. Send less content, or work with the file in the workspace and share it instead."));

            var result = await context.Function.InvokeAsync(context.Arguments, cancellationToken);

            var repeats = CountConsecutiveRepeats(context.Messages, context.CallContent);
            if (repeats >= TerminateAt)
                context.Terminate = true;
            var reminder = repeats >= DetailedAt ? DetailedReminder(context.CallContent.Name, repeats) : repeats >= GentleAt ? GentleReminder : null;

            var capped = Cap(result, maxResultChars);
            return reminder is null ? capped : $"{ResultText(capped)}\n\n[Reminder] {reminder}";
        }

        public static int ArgumentChars(IEnumerable<KeyValuePair<string, object?>>? arguments) => arguments is null ? 0 : JsonSerializer.Serialize(arguments.ToDictionary(a => a.Key, a => a.Value), AIJsonUtilities.DefaultOptions).Length;

        /// <summary>The result as it was when short enough, otherwise its text cut to the cap with a note.</summary>
        public static object? Cap(object? result, int max)
        {
            if (result is null)
                return null;
            var text = ResultText(result);
            if (text.Length <= max)
                return result;
            return text[..max] + string.Create(CultureInfo.InvariantCulture, $"\n[Cut: the result was {text.Length:N0} characters and only the first {max:N0} are shown. Ask for less, or page through it.]");
        }

        /// <summary>How many identical calls end with <paramref name="call"/>, itself included, walking back through every tool call of the conversation so far.</summary>
        public static int CountConsecutiveRepeats(IEnumerable<ChatMessage> messages, FunctionCallContent call)
        {
            var calls = messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>().ToList();
            var index = calls.FindLastIndex(c => c.CallId == call.CallId);
            if (index < 0)
                return 1;
            var key = Canonical(call);
            var count = 0;
            for (var i = index; i >= 0 && calls[i].Name == call.Name && Canonical(calls[i]) == key; i--)
                count++;
            return count;
        }

        private static string DetailedReminder(string toolName, int count) =>
            $"Repeated tool call: {toolName}, {count} times in a row with the same arguments. These calls are not making progress. Do not call it with these arguments again; use the latest result, choose a different action, or finish your answer.";

        private static string Canonical(FunctionCallContent call) => HelplyApprovalHash.Compute(call.Name, call.Arguments);

        public static string ResultText(object? result) => result switch
        {
            null => string.Empty,
            string text => text,
            JsonElement { ValueKind: JsonValueKind.String } element => element.GetString() ?? string.Empty,
            _ => JsonSerializer.Serialize(result, AIJsonUtilities.DefaultOptions),
        };

        private static JsonElement Error(string text) => JsonSerializer.SerializeToElement(new { isError = true, content = new[] { new { type = "text", text } } });
    }
}
