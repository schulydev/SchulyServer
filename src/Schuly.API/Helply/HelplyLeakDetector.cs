using System.Text;

namespace Schuly.API.Helply
{
    /// <summary>
    /// Notices when a call that sends something out carries a large passage copied from the user's files or from what the workspace returned in this turn. The sources are cut into
    /// overlapping windows of <see cref="Window"/> characters every <see cref="Stride"/> characters (after folding case and whitespace); every window found in the outgoing text counts
    /// its characters once. Any copied run of at least <see cref="Window"/> + <see cref="Stride"/> characters is sure to contain a whole source window, so copying cannot hide by
    /// shifting the text. It only flags; the approval card shows the warning and the user decides.
    /// </summary>
    public sealed class HelplyLeakDetector
    {
        public const int Window = 64;
        public const int Stride = 32;
        public const int FlagAtChars = 400;
        private const int MaxSourceChars = 2_000_000;

        private readonly HashSet<string> _windows = new(StringComparer.Ordinal);
        private int _sourceChars;

        public bool IsEmpty => _windows.Count == 0;

        public void AddSource(string? text)
        {
            if (string.IsNullOrEmpty(text) || _sourceChars >= MaxSourceChars)
                return;
            var normalized = Normalize(text);
            _sourceChars += normalized.Length;
            for (var i = 0; i + Window <= normalized.Length; i += Stride)
                _windows.Add(normalized.Substring(i, Window));
        }

        /// <summary>About how many characters of <paramref name="outgoing"/> are copied from the sources.</summary>
        public int CopiedChars(string? outgoing)
        {
            if (string.IsNullOrEmpty(outgoing) || _windows.Count == 0)
                return 0;
            var text = Normalize(outgoing);
            var covered = new bool[text.Length];
            for (var i = 0; i + Window <= text.Length; i++)
                if (_windows.Contains(text.Substring(i, Window)))
                    Array.Fill(covered, true, i, Window);
            return covered.Count(c => c);
        }

        public bool Flags(string? outgoing) => CopiedChars(outgoing) >= FlagAtChars;

        private static string Normalize(string text)
        {
            var builder = new StringBuilder(text.Length);
            var space = false;
            foreach (var c in text)
            {
                if (char.IsWhiteSpace(c))
                {
                    space = builder.Length > 0;
                    continue;
                }
                if (space)
                    builder.Append(' ');
                space = false;
                builder.Append(char.ToLowerInvariant(c));
            }
            return builder.ToString();
        }
    }
}
