using Schuly.API.Mcp.Tools;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Mcp;

namespace Schuly.Tests.Mcp
{
    public class OneNoteTextTests
    {
        [Test]
        public async Task Paragraphs_and_line_breaks_become_lines_and_entities_are_decoded()
        {
            var text = OneNoteText.HtmlToText("<div data-outline=\"x\"><p>Fish &amp; chips</p><p>Line one<br>Line two&nbsp;end</p></div>");

            await Assert.That(text).IsEqualTo("Fish & chips\nLine one\nLine two end");
        }

        [Test]
        public async Task List_items_get_a_dash_and_table_cells_are_separated_by_a_pipe()
        {
            var list = OneNoteText.HtmlToText("<p>Todo</p><ul><li>Milk</li><li>Bread</li></ul>");
            var table = OneNoteText.HtmlToText("<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>");

            await Assert.That(list).IsEqualTo("Todo\n- Milk\n- Bread");
            await Assert.That(table).IsEqualTo("A | B\nC | D");
        }

        [Test]
        public async Task Ink_scripts_and_tags_are_dropped_and_empty_input_gives_empty_text()
        {
            var text = OneNoteText.HtmlToText("<svg class=\"on-ink\"><path d=\"M0 0\"/></svg><script>alert(1)</script><p>Only <b>this</b> &lt;stays&gt;</p>");

            await Assert.That(text).IsEqualTo("Only this <stays>");
            await Assert.That(OneNoteText.HtmlToText(null)).IsEqualTo(string.Empty);
            await Assert.That(OneNoteText.HtmlToText("  ")).IsEqualTo(string.Empty);
        }

        [Test]
        public async Task Plain_text_becomes_one_escaped_paragraph_per_line()
        {
            var html = OneNoteText.TextToHtml("Hello <script>alert(1)</script>\r\n\r\n  a & b  \nlast");

            await Assert.That(html).IsEqualTo("<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p><p>a &amp; b</p><p>last</p>");
            await Assert.That(OneNoteText.TextToHtml(null)).IsEqualTo(string.Empty);
            await Assert.That(OneNoteText.TextToHtml("  \n ")).IsEqualTo(string.Empty);
        }

        [Test]
        public async Task OneNote_can_be_granted_write_access_and_the_write_scope_round_trips()
        {
            var set = new McpPermissionSet { Areas = { [McpArea.OneNote] = McpAccessLevel.ReadWrite } };

            await Assert.That(McpScopes.Normalize(set).Level(McpArea.OneNote)).IsEqualTo(McpAccessLevel.ReadWrite);
            await Assert.That(McpScopes.Granted(set)).Contains("ms.onenote.write");
            await Assert.That(McpScopes.Requested("ms.onenote.write").Level(McpArea.OneNote)).IsEqualTo(McpAccessLevel.Read);
        }
    }
}
