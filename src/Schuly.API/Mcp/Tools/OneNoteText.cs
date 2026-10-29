using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Schuly.API.Mcp.Tools
{
    /// <summary>Conversions between OneNote page markup and the plain text a model reads and writes.</summary>
    public static partial class OneNoteText
    {
        public const int MaxWriteChars = 100_000;

        /// <summary>Plain text of a sanitized OneNote body: paragraphs and lines kept, list items as "- ", table cells separated by " | ", entities decoded.</summary>
        public static string HtmlToText(string? html)
        {
            if (string.IsNullOrWhiteSpace(html))
                return string.Empty;
            var text = Dropped().Replace(html, " ");
            text = ListItem().Replace(text, "\n- ");
            text = CellEnd().Replace(text, " | ");
            text = BlockEdge().Replace(text, "\n");
            text = Tag().Replace(text, string.Empty);
            text = WebUtility.HtmlDecode(text).Replace(' ', ' ');
            var lines = text.Split('\n').Select(CleanLine);
            return BlankLines().Replace(string.Join('\n', lines), "\n").Trim();
        }

        /// <summary>Safe markup for plain text: every line escaped and wrapped in its own paragraph, blank lines dropped.</summary>
        public static string TextToHtml(string? text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return string.Empty;
            var builder = new StringBuilder();
            foreach (var line in text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;
                builder.Append("<p>").Append(WebUtility.HtmlEncode(line.Trim())).Append("</p>");
            }
            return builder.ToString();
        }

        private static string CleanLine(string line)
        {
            line = SpaceRun().Replace(line, " ").Trim();
            while (line.EndsWith('|'))
                line = line[..^1].TrimEnd();
            return line;
        }

        [GeneratedRegex(@"<(script|style|svg|head)[^>]*>.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
        private static partial Regex Dropped();

        [GeneratedRegex(@"<\s*li(\s[^>]*)?>", RegexOptions.IgnoreCase)]
        private static partial Regex ListItem();

        [GeneratedRegex(@"<\s*/\s*t[dh]\s*>", RegexOptions.IgnoreCase)]
        private static partial Regex CellEnd();

        [GeneratedRegex(@"<\s*/?\s*(br|p|div|tr|h[1-6]|ul|ol|table|thead|tbody|tfoot|pre|blockquote|hr)(\s[^>]*)?/?>", RegexOptions.IgnoreCase)]
        private static partial Regex BlockEdge();

        [GeneratedRegex(@"<[^>]+>")]
        private static partial Regex Tag();

        [GeneratedRegex(@"[ \t\r\f\v]+")]
        private static partial Regex SpaceRun();

        [GeneratedRegex(@"\n{2,}")]
        private static partial Regex BlankLines();
    }
}
