using System.IO.Compression;
using System.Text;

namespace Schuly.Infrastructure.Helply
{
    /// <summary>What an uploaded file turned out to be.</summary>
    public enum HelplyFileKind
    {
        Image,
        Pdf,
        Text,
        Word,
        Excel,
        PowerPoint,
    }

    public sealed record HelplyFileType(HelplyFileKind Kind, string MediaType);

    /// <summary>
    /// Decides what an upload is from its bytes alone. The client's file name and content type only have to agree with what the bytes say: a PNG named <c>.pdf</c>, a PDF sent as
    /// <c>image/png</c> or a zip that is not the Office document its extension claims is refused. Office files are zips, so they are opened as such and only their entry list is read
    /// (never extracted), which also refuses archives that would unpack to far more than they weigh.
    /// </summary>
    public static class HelplyFileTypes
    {
        public const long MaxBytes = 20 * 1024 * 1024;
        public const int MaxZipEntries = 5000;
        public const long MaxZipUncompressedBytes = 200L * 1024 * 1024;
        public const int MaxZipRatio = 200;

        public const string Png = "image/png";
        public const string Jpeg = "image/jpeg";
        public const string Gif = "image/gif";
        public const string Webp = "image/webp";
        public const string PdfType = "application/pdf";
        public const string PlainText = "text/plain";
        public const string Csv = "text/csv";
        public const string Markdown = "text/markdown";
        public const string Docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        public const string Xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        public const string Pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

        /// <summary>Every extension Helply accepts, and the media type the bytes must turn out to be.</summary>
        public static readonly IReadOnlyDictionary<string, string> Extensions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".png"] = Png,
            [".jpg"] = Jpeg,
            [".jpeg"] = Jpeg,
            [".gif"] = Gif,
            [".webp"] = Webp,
            [".pdf"] = PdfType,
            [".txt"] = PlainText,
            [".csv"] = Csv,
            [".md"] = Markdown,
            [".markdown"] = Markdown,
            [".docx"] = Docx,
            [".xlsx"] = Xlsx,
            [".pptx"] = Pptx,
        };

        /// <summary>Client content types that say nothing and so never count as a mismatch.</summary>
        private static readonly HashSet<string> Unspecific = new(StringComparer.OrdinalIgnoreCase) { "", "application/octet-stream", "binary/octet-stream", "application/x-zip-compressed", "application/zip" };

        /// <summary>Other names browsers and systems give the same types.</summary>
        private static readonly Dictionary<string, string> Aliases = new(StringComparer.OrdinalIgnoreCase)
        {
            ["image/jpg"] = Jpeg,
            ["image/pjpeg"] = Jpeg,
            ["text/x-markdown"] = Markdown,
            ["application/csv"] = Csv,
            ["text/comma-separated-values"] = Csv,
            ["application/vnd.ms-excel"] = Csv,
        };

        public static HelplyFileKind KindOf(string mediaType) => mediaType switch
        {
            Png or Jpeg or Gif or Webp => HelplyFileKind.Image,
            PdfType => HelplyFileKind.Pdf,
            Docx => HelplyFileKind.Word,
            Xlsx => HelplyFileKind.Excel,
            Pptx => HelplyFileKind.PowerPoint,
            _ => HelplyFileKind.Text,
        };

        /// <summary>The detected type, or why the upload is refused (a message safe to show the user).</summary>
        public static (HelplyFileType? Type, string? Error) Detect(string? fileName, string? clientContentType, ReadOnlySpan<byte> data)
        {
            if (data.IsEmpty)
                return (null, "The file is empty.");
            if (data.Length > MaxBytes)
                return (null, $"A file can be at most {MaxBytes / (1024 * 1024)} MB.");

            var extension = Path.GetExtension(fileName ?? string.Empty);
            if (!Extensions.TryGetValue(extension, out var expected))
                return (null, "This kind of file is not supported. Attach an image, PDF, text, CSV, Markdown, Word, Excel or PowerPoint file.");

            var sniffed = Sniff(data, expected);
            if (sniffed is null)
                return (null, "The file's content does not match its type.");
            if (!string.Equals(sniffed, expected, StringComparison.Ordinal))
                return (null, "The file's content does not match its name.");

            var claimed = (clientContentType ?? string.Empty).Split(';')[0].Trim();
            claimed = Aliases.GetValueOrDefault(claimed, claimed);
            if (!Unspecific.Contains(claimed) && !string.Equals(claimed, sniffed, StringComparison.OrdinalIgnoreCase) && !(KindOf(sniffed) == HelplyFileKind.Text && claimed.Equals(PlainText, StringComparison.OrdinalIgnoreCase)))
                return (null, "The file's content does not match its type.");

            return (new HelplyFileType(KindOf(sniffed), sniffed), null);
        }

        /// <summary>The type the bytes are, judged by their signature. Text has none, so for a text extension it is text when it is valid UTF-8 without control bytes.</summary>
        public static string? Sniff(ReadOnlySpan<byte> data, string expectedByName)
        {
            if (data.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
                return Png;
            if (data.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]))
                return Jpeg;
            if (data.StartsWith("GIF87a"u8) || data.StartsWith("GIF89a"u8))
                return Gif;
            if (data.Length >= 12 && data.StartsWith("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8))
                return Webp;
            if (data.StartsWith("%PDF-"u8))
                return PdfType;
            if (data.StartsWith((ReadOnlySpan<byte>)[0x50, 0x4B, 0x03, 0x04]))
                return OfficeType(data);
            if (KindOf(expectedByName) == HelplyFileKind.Text && IsText(data))
                return expectedByName;
            return null;
        }

        /// <summary>Valid UTF-8 (a BOM is fine) with no NUL or other control bytes than tab, line feed, carriage return and form feed.</summary>
        public static bool IsText(ReadOnlySpan<byte> data)
        {
            if (data.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]))
                data = data[3..];
            foreach (var b in data)
                if (b < 0x20 && b is not (0x09 or 0x0A or 0x0D or 0x0C))
                    return false;
            return System.Text.Unicode.Utf8.IsValid(data);
        }

        /// <summary>Which Office document a zip is, from the parts it lists; null for any other zip or one that would unpack to too much.</summary>
        private static string? OfficeType(ReadOnlySpan<byte> data)
        {
            try
            {
                using var stream = new MemoryStream(data.ToArray(), writable: false);
                using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
                if (zip.Entries.Count > MaxZipEntries)
                    return null;
                long total = 0;
                var names = new HashSet<string>(StringComparer.Ordinal);
                foreach (var entry in zip.Entries)
                {
                    total += entry.Length;
                    if (total > MaxZipUncompressedBytes || (entry.CompressedLength > 0 && entry.Length / entry.CompressedLength > MaxZipRatio && entry.Length > 1024 * 1024))
                        return null;
                    names.Add(entry.FullName);
                }
                if (!names.Contains("[Content_Types].xml"))
                    return null;
                if (names.Contains("word/document.xml"))
                    return Docx;
                if (names.Contains("xl/workbook.xml"))
                    return Xlsx;
                if (names.Contains("ppt/presentation.xml"))
                    return Pptx;
                return null;
            }
            catch (InvalidDataException)
            {
                return null;
            }
        }

        /// <summary>
        /// A file name that is safe everywhere it goes: no path, no control characters, no characters a shell or a header would treat specially, at most 120 characters, and never
        /// starting with a dot or a dash. Letters outside ASCII are kept for display; <see cref="SandboxName"/> narrows further for the workspace.
        /// </summary>
        public static string DisplayName(string? name)
        {
            var leaf = (name ?? string.Empty).Replace('\\', '/');
            leaf = leaf[(leaf.LastIndexOf('/') + 1)..];
            var builder = new StringBuilder(leaf.Length);
            foreach (var c in leaf)
                builder.Append(char.IsControl(c) || c is '"' or '<' or '>' or '|' or ':' or '*' or '?' or ';' or '`' or '$' ? '_' : c);
            var safe = builder.ToString().Trim().TrimStart('.', '-').Trim();
            if (safe.Length > 120)
            {
                var extension = Path.GetExtension(safe);
                safe = extension.Length is > 0 and <= 10 ? safe[..(120 - extension.Length)] + extension : safe[..120];
            }
            return safe.Length == 0 ? "file" : safe;
        }

        /// <summary>A name the sandbox accepts: ASCII letters, digits, '.', '_' and '-' only, not starting with '.' or '-', at most 120 characters.</summary>
        public static string SandboxName(string? name)
        {
            var safe = new string((name ?? string.Empty).Select(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-' ? c : '_').ToArray()).TrimStart('.', '-');
            if (safe.Length > 120)
                safe = safe[^120..].TrimStart('.', '-');
            return safe.Length == 0 ? "file" : safe;
        }

        /// <summary>
        /// The type a file Helply created downloads as, from its name. HTML, SVG and anything unknown are plain bytes on purpose: served from the app's own origin they could run script.
        /// </summary>
        public static string MediaTypeForShared(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".txt" or ".log" => PlainText,
            ".md" => Markdown,
            ".csv" => Csv,
            ".json" => "application/json",
            ".py" => "text/x-python",
            ".png" => Png,
            ".jpg" or ".jpeg" => Jpeg,
            ".gif" => Gif,
            ".webp" => Webp,
            ".pdf" => PdfType,
            ".zip" => "application/zip",
            ".xlsx" => Xlsx,
            ".docx" => Docx,
            ".pptx" => Pptx,
            _ => "application/octet-stream",
        };
    }
}
