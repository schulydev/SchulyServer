using System.Text;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;
using A = DocumentFormat.OpenXml.Drawing;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace Schuly.Infrastructure.Helply
{
    /// <summary>The text of a file, and its pages (PDF) or slides (PowerPoint) when it has them.</summary>
    public sealed record HelplyExtractedText(string Text, int? PageCount);

    /// <summary>
    /// Reads the text out of an upload once, when it arrives, entirely in process. PDFs get a <c>--- Page N ---</c> line before each page, spreadsheets a <c>--- Sheet name ---</c>
    /// line before each sheet and presentations a <c>--- Slide N ---</c> line before each slide, so the model can grep for a passage and say where it is. Everything is capped:
    /// a file never yields more than <see cref="MaxChars"/> characters, and a damaged or encrypted file yields nothing rather than an error.
    /// </summary>
    public static class HelplyTextExtractor
    {
        public const int MaxChars = 2_000_000;
        public const int MaxPages = 2000;
        public const int MaxSheetRows = 20_000;

        public static HelplyExtractedText? Extract(HelplyFileKind kind, byte[] data)
        {
            try
            {
                return kind switch
                {
                    HelplyFileKind.Pdf => Pdf(data),
                    HelplyFileKind.Word => Word(data),
                    HelplyFileKind.Excel => Excel(data),
                    HelplyFileKind.PowerPoint => PowerPoint(data),
                    HelplyFileKind.Text => new HelplyExtractedText(Cap(new StringBuilder(DecodeText(data))), null),
                    _ => null,
                };
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                return null;
            }
        }

        /// <summary>UTF-8 without a leading byte-order mark.</summary>
        public static string DecodeText(byte[] data) => Encoding.UTF8.GetString(data.AsSpan().StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]) ? data.AsSpan(3) : data);

        private static HelplyExtractedText Pdf(byte[] data)
        {
            using var document = PdfDocument.Open(data);
            var text = new StringBuilder();
            foreach (var page in document.GetPages())
            {
                if (page.Number > MaxPages || text.Length >= MaxChars)
                    break;
                // Content order keeps words and lines apart; page.Text runs them together.
                text.Append("--- Page ").Append(page.Number).Append(" ---\n").Append(ContentOrderTextExtractor.GetText(page).Trim()).Append("\n\n");
            }
            return new HelplyExtractedText(Cap(text), document.NumberOfPages);
        }

        private static OpenSettings Settings => new() { MaxCharactersInPart = 50_000_000, AutoSave = false };

        private static HelplyExtractedText Word(byte[] data)
        {
            using var stream = new MemoryStream(data, writable: false);
            using var document = WordprocessingDocument.Open(stream, false, Settings);
            var text = new StringBuilder();
            var body = document.MainDocumentPart?.Document?.Body;
            if (body is not null)
            {
                foreach (var block in body.ChildElements)
                {
                    if (text.Length >= MaxChars)
                        break;
                    if (block is W.Table table)
                    {
                        foreach (var row in table.Elements<W.TableRow>())
                            text.Append(string.Join('\t', row.Elements<W.TableCell>().Select(c => c.InnerText.Trim()))).Append('\n');
                        text.Append('\n');
                    }
                    else if (block is W.Paragraph paragraph)
                        text.Append(paragraph.InnerText).Append('\n');
                }
            }
            return new HelplyExtractedText(Cap(text), null);
        }

        private static HelplyExtractedText Excel(byte[] data)
        {
            using var stream = new MemoryStream(data, writable: false);
            using var document = SpreadsheetDocument.Open(stream, false, Settings);
            var workbook = document.WorkbookPart;
            var text = new StringBuilder();
            if (workbook?.Workbook?.Sheets is { } sheets)
            {
                var shared = workbook.SharedStringTablePart?.SharedStringTable?.Elements<SharedStringItem>().Select(s => s.InnerText).ToArray() ?? [];
                foreach (var sheet in sheets.Elements<Sheet>())
                {
                    if (text.Length >= MaxChars || sheet.Id?.Value is not { } relation || workbook.GetPartById(relation) is not WorksheetPart part)
                        continue;
                    text.Append("--- Sheet ").Append(sheet.Name?.Value).Append(" ---\n");
                    var rows = 0;
                    foreach (var row in part.Worksheet?.Descendants<Row>() ?? [])
                    {
                        if (++rows > MaxSheetRows || text.Length >= MaxChars)
                            break;
                        text.Append(string.Join('\t', row.Elements<Cell>().Select(c => CellText(c, shared)))).Append('\n');
                    }
                    text.Append('\n');
                }
            }
            return new HelplyExtractedText(Cap(text), null);
        }

        private static string CellText(Cell cell, string[] shared)
        {
            var value = cell.CellValue?.Text ?? cell.InlineString?.InnerText ?? string.Empty;
            if (cell.DataType?.Value == CellValues.SharedString && int.TryParse(value, out var index))
                return index >= 0 && index < shared.Length ? shared[index] : string.Empty;
            return value;
        }

        private static HelplyExtractedText PowerPoint(byte[] data)
        {
            using var stream = new MemoryStream(data, writable: false);
            using var document = PresentationDocument.Open(stream, false, Settings);
            var presentation = document.PresentationPart;
            var text = new StringBuilder();
            var slides = 0;
            if (presentation?.Presentation?.SlideIdList is { } list)
            {
                foreach (var id in list.Elements<DocumentFormat.OpenXml.Presentation.SlideId>())
                {
                    if (id.RelationshipId?.Value is not { } relation || presentation.GetPartById(relation) is not SlidePart slide)
                        continue;
                    slides++;
                    if (text.Length >= MaxChars)
                        continue;
                    text.Append("--- Slide ").Append(slides).Append(" ---\n");
                    foreach (var paragraph in slide.Slide?.Descendants<A.Paragraph>() ?? [])
                    {
                        var line = string.Concat(paragraph.Descendants<A.Text>().Select(t => t.Text));
                        if (line.Length > 0)
                            text.Append(line).Append('\n');
                    }
                    text.Append('\n');
                }
            }
            return new HelplyExtractedText(Cap(text), slides);
        }

        private static string Cap(StringBuilder text) => text.Length <= MaxChars ? text.ToString() : text.ToString(0, MaxChars);
    }
}
