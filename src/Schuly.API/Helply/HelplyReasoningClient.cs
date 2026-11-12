using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.AI;
using Schuly.Domain.Helply;

namespace Schuly.API.Helply
{
    /// <summary>The models whose gateway refused the reasoning parameter. Kept for the lifetime of the process, so each model is only refused once.</summary>
    public static class HelplyReasoningSupport
    {
        private static readonly ConcurrentDictionary<string, bool> Refused = new(StringComparer.OrdinalIgnoreCase);

        public static bool IsRefused(string model) => Refused.ContainsKey(model);

        public static void MarkRefused(string model) => Refused[model] = true;

        /// <summary>Whether a failure is the gateway rejecting the reasoning parameter (a 400 or 422 that names it), as opposed to any other error.</summary>
        public static bool IsReasoningRejection(Exception ex)
        {
            for (var e = ex; e is not null; e = e.InnerException)
            {
                int? status = e is System.ClientModel.ClientResultException client ? client.Status : e is HttpRequestException { StatusCode: { } code } ? (int)code : null;
                if (status is 400 or 422 && e.Message.Contains("reasoning", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        public static ReasoningEffort ToEffort(HelplyReasoningEffort effort) => effort switch
        {
            HelplyReasoningEffort.Low => ReasoningEffort.Low,
            HelplyReasoningEffort.Medium => ReasoningEffort.Medium,
            _ => ReasoningEffort.High,
        };
    }

    /// <summary>
    /// Sends the user's reasoning effort with every model request. If the gateway rejects the request because of that parameter, the same request is sent once more without it and
    /// the model is remembered as not supporting it, so later requests leave it out.
    /// </summary>
    public sealed class HelplyReasoningClient(IChatClient inner, string model, HelplyReasoningEffort effort) : DelegatingChatClient(inner)
    {
        public override async Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        {
            var list = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();
            if (HelplyReasoningSupport.IsRefused(model))
                return await base.GetResponseAsync(list, options, cancellationToken);
            try
            {
                return await base.GetResponseAsync(list, With(options), cancellationToken);
            }
            catch (Exception ex) when (HelplyReasoningSupport.IsReasoningRejection(ex))
            {
                HelplyReasoningSupport.MarkRefused(model);
                return await base.GetResponseAsync(list, options, cancellationToken);
            }
        }

        public override async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var list = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();
            var withReasoning = !HelplyReasoningSupport.IsRefused(model);
            for (var attempt = 0; attempt < 2; attempt++)
            {
                var enumerator = base.GetStreamingResponseAsync(list, withReasoning ? With(options) : options, cancellationToken).GetAsyncEnumerator(cancellationToken);
                try
                {
                    bool has;
                    try
                    {
                        has = await enumerator.MoveNextAsync();
                    }
                    catch (Exception ex) when (withReasoning && HelplyReasoningSupport.IsReasoningRejection(ex))
                    {
                        // Refused before anything came back, so nothing was shown yet: ask again without the parameter.
                        HelplyReasoningSupport.MarkRefused(model);
                        withReasoning = false;
                        continue;
                    }
                    while (has)
                    {
                        yield return enumerator.Current;
                        has = await enumerator.MoveNextAsync();
                    }
                    yield break;
                }
                finally
                {
                    await enumerator.DisposeAsync();
                }
            }
        }

        private ChatOptions With(ChatOptions? options)
        {
            var copy = options?.Clone() ?? new ChatOptions();
            copy.Reasoning = new ReasoningOptions { Effort = HelplyReasoningSupport.ToEffort(effort) };
            return copy;
        }
    }
}
