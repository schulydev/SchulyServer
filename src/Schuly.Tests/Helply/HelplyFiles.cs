using System.IO.Compression;
using System.Collections.Concurrent;
using System.Text;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Schuly.Infrastructure.Helply;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace Schuly.Tests.Helply
{
    /// <summary>Real files of every accepted kind, built in memory.</summary>
    public static class HelplyFiles
    {
        /// <summary>A 1x1 PNG.</summary>
        public static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

        public static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0x00, 0x01, 0xFF, 0xD9];

        public static byte[] Pdf(params string[] pages)
        {
            var builder = new PdfDocumentBuilder();
            var font = builder.AddStandard14Font(Standard14Font.Helvetica);
            foreach (var text in pages)
            {
                var page = builder.AddPage(UglyToad.PdfPig.Content.PageSize.A4);
                page.AddText(text, 12, new UglyToad.PdfPig.Core.PdfPoint(50, 750), font);
            }
            return builder.Build();
        }

        public static byte[] Docx(params string[] paragraphs)
        {
            using var stream = new MemoryStream();
            using (var document = WordprocessingDocument.Create(stream, WordprocessingDocumentType.Document))
            {
                var main = document.AddMainDocumentPart();
                main.Document = new W.Document(new W.Body(paragraphs.Select(p => new W.Paragraph(new W.Run(new W.Text(p))))));
            }
            return stream.ToArray();
        }

        public static byte[] Xlsx(string sheetName, params string[][] rows)
        {
            using var stream = new MemoryStream();
            using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook))
            {
                var workbook = document.AddWorkbookPart();
                workbook.Workbook = new Workbook();
                var sheetPart = workbook.AddNewPart<WorksheetPart>();
                var data = new SheetData(rows.Select(r => new Row(r.Select(c => new Cell { DataType = CellValues.InlineString, InlineString = new InlineString(new Text(c)) }))));
                sheetPart.Worksheet = new Worksheet(data);
                workbook.Workbook.AppendChild(new Sheets(new Sheet { Id = workbook.GetIdOfPart(sheetPart), SheetId = 1, Name = sheetName }));
            }
            return stream.ToArray();
        }

        /// <summary>A zip that lists the parts of the given Office type but holds nothing else, or any zip with the given entries.</summary>
        public static byte[] Zip(params string[] entries)
        {
            using var stream = new MemoryStream();
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
                foreach (var entry in entries)
                    using (var writer = new StreamWriter(zip.CreateEntry(entry).Open()))
                        writer.Write("<x/>");
            return stream.ToArray();
        }

        public static byte[] Text(string text) => Encoding.UTF8.GetBytes(text);
    }

    /// <summary>A sandbox sidecar in memory: commands are answered by a script, files live in a dictionary, and every call is recorded.</summary>
    public sealed class FakeSandboxClient : IHelplySandboxClient
    {
        public ConcurrentDictionary<string, byte[]> Files { get; } = new();
        public ConcurrentQueue<string> Commands { get; } = new();
        public ConcurrentQueue<Guid> Deleted { get; } = new();
        public Func<string, HelplySandboxExecResult> OnExec { get; set; } = _ => new HelplySandboxExecResult(0, "ok\n", string.Empty, false, false);

        public bool IsConfigured { get; set; } = true;

        public Task<HelplySandboxExecResult> ExecAsync(Guid conversationId, string command, int timeoutSeconds, CancellationToken ct)
        {
            Commands.Enqueue(command);
            return Task.FromResult(OnExec(command));
        }

        public Task<string?> WriteFileAsync(Guid conversationId, string path, byte[] content, CancellationToken ct)
        {
            Files[path] = content;
            return Task.FromResult<string?>(null);
        }

        public Task<(byte[]? Content, string? Error)> ReadFileAsync(Guid conversationId, string path, CancellationToken ct) =>
            Task.FromResult(Files.TryGetValue(path, out var content) ? ((byte[]?)content, (string?)null) : (null, $"Error: there is no regular file at '{path}' in the workspace."));

        public Task DeleteAsync(Guid conversationId, CancellationToken ct)
        {
            Deleted.Enqueue(conversationId);
            Files.Clear();
            return Task.CompletedTask;
        }
    }
}
