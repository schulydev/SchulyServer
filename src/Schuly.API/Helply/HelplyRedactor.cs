using System.Text;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Scrubs what must never reach a user from text Helply produces: the model id (becomes "Helply"), and the gateway URL, host and API key (become "[redacted]").
    /// Matching is case-insensitive. <see cref="Stream"/> handles text that arrives in pieces: it holds back a tail that could be the start of a secret until the next
    /// piece shows whether it is, so a secret split across deltas is still caught.
    /// </summary>
    public sealed class HelplyRedactor
    {
        public const string ModelReplacement = "Helply";
        public const string SecretReplacement = "[redacted]";
        private const int MinimumSecretLength = 3;

        private readonly (string Secret, string Replacement)[] _rules;
        private readonly int _longest;

        public HelplyRedactor(IEnumerable<(string Secret, string Replacement)> rules)
        {
            _rules = rules.Where(r => r.Secret.Length >= MinimumSecretLength).DistinctBy(r => r.Secret, StringComparer.OrdinalIgnoreCase).OrderByDescending(r => r.Secret.Length).ToArray();
            _longest = _rules.Length == 0 ? 0 : _rules[0].Secret.Length;
        }

        public static HelplyRedactor None { get; } = new([]);

        public string Redact(string text)
        {
            foreach (var (secret, replacement) in _rules)
                text = text.Replace(secret, replacement, StringComparison.OrdinalIgnoreCase);
            return text;
        }

        public Stream CreateStream() => new(this);

        /// <summary>Stateful redaction of one text stream. Call <see cref="Push"/> per piece and <see cref="Flush"/> at the end.</summary>
        public sealed class Stream(HelplyRedactor owner)
        {
            private readonly StringBuilder _pending = new();

            public string Push(string piece)
            {
                if (owner._rules.Length == 0)
                    return piece;
                _pending.Append(piece);
                var text = owner.Redact(_pending.ToString());
                var hold = HeldTail(text);
                _pending.Clear().Append(text, text.Length - hold, hold);
                return text[..^hold];
            }

            public string Flush()
            {
                var text = owner.Redact(_pending.ToString());
                _pending.Clear();
                return text;
            }

            // The longest ending of the text that is a proper beginning of some secret: it may complete with the next piece.
            private int HeldTail(string text)
            {
                for (var length = Math.Min(owner._longest - 1, text.Length); length > 0; length--)
                {
                    var tail = text.AsSpan(text.Length - length);
                    foreach (var (secret, _) in owner._rules)
                        if (secret.Length > length && secret.AsSpan(0, length).Equals(tail, StringComparison.OrdinalIgnoreCase))
                            return length;
                }
                return 0;
            }
        }
    }
}
