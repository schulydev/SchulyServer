using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Helply;

namespace Schuly.Tests.Helply
{
    public class HelplyAttachmentTests
    {
        private static string Attachments(Guid conversation) => $"/api/helply/conversations/{conversation}/attachments";

        [Test]
        public async Task Accepted_files_are_typed_by_their_bytes()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Accepted_files_are_typed_by_their_bytes));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);

            var cases = new (string Name, string? Declared, byte[] Data, string Expected)[]
            {
                ("photo.png", "image/png", HelplyFiles.Png, HelplyFileTypes.Png),
                ("scan.JPG", "image/jpg", HelplyFiles.Jpeg, HelplyFileTypes.Jpeg),
                ("noten.pdf", "application/pdf", HelplyFiles.Pdf("Mathematik 5.5"), HelplyFileTypes.PdfType),
                ("notes.md", "text/markdown", HelplyFiles.Text("# Hallo\nWelt"), HelplyFileTypes.Markdown),
                ("grades.csv", "application/vnd.ms-excel", HelplyFiles.Text("Fach;Note\nMathe;5.5\n"), HelplyFileTypes.Csv),
                ("plain.txt", null, HelplyFiles.Text("ä ö ü"), HelplyFileTypes.PlainText),
                ("brief.docx", "application/octet-stream", HelplyFiles.Docx("Liebe Klasse"), HelplyFileTypes.Docx),
                ("noten.xlsx", HelplyFileTypes.Xlsx, HelplyFiles.Xlsx("Noten", ["Mathe", "5.5"]), HelplyFileTypes.Xlsx),
                ("deck.pptx", null, HelplyFiles.Zip("[Content_Types].xml", "ppt/presentation.xml"), HelplyFileTypes.Pptx),
            };
            foreach (var (name, declared, data, expected) in cases)
            {
                var (status, json, body) = await host.UploadAsync(token, chat, name, declared, data);
                await Assert.That(status).IsEqualTo(200).Because(name + ": " + body);
                await Assert.That(json.GetProperty("mediaType").GetString()).IsEqualTo(expected);
                await Assert.That(json.GetProperty("sizeBytes").GetInt64()).IsEqualTo(data.LongLength);
            }
        }

        [Test]
        public async Task Mismatched_unknown_or_empty_files_are_refused()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Mismatched_unknown_or_empty_files_are_refused));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);

            var refused = new (string Name, string? Declared, byte[] Data)[]
            {
                ("photo.pdf", "application/pdf", HelplyFiles.Png),
                ("noten.pdf", "image/png", HelplyFiles.Pdf("x")),
                ("photo.png", "application/pdf", HelplyFiles.Png),
                ("evil.png", "image/png", HelplyFiles.Text("<svg onload=alert(1)>")),
                ("binary.txt", "text/plain", [0x41, 0x00, 0x42]),
                ("broken.txt", "text/plain", [0xC3, 0x28]),
                ("program.exe", "application/octet-stream", [0x4D, 0x5A, 0x90, 0x00]),
                ("page.html", "text/html", HelplyFiles.Text("<html></html>")),
                ("image.svg", "image/svg+xml", HelplyFiles.Text("<svg/>")),
                ("noextension", null, HelplyFiles.Png),
                ("fake.docx", HelplyFileTypes.Docx, HelplyFiles.Zip("[Content_Types].xml", "xl/workbook.xml")),
                ("plainzip.docx", HelplyFileTypes.Docx, HelplyFiles.Zip("readme.txt")),
                ("empty.txt", "text/plain", []),
            };
            foreach (var (name, declared, data) in refused)
            {
                var (status, _, body) = await host.UploadAsync(token, chat, name, declared, data);
                await Assert.That(status).IsEqualTo(400).Because(name + ": " + body);
            }
            await Assert.That((await host.ScopedAsync(sp => sp.GetRequiredService<SchulyDbContext>().HelplyAttachments.CountAsync()))).IsEqualTo(0);
        }

        [Test]
        public async Task A_file_over_20_mb_is_refused()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_file_over_20_mb_is_refused));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);

            var big = new byte[HelplyFileTypes.MaxBytes + 1];
            Encoding.ASCII.GetBytes("%PDF-1.7\n").CopyTo(big, 0);
            var (status, _, _) = await host.UploadAsync(token, chat, "huge.pdf", "application/pdf", big);
            await Assert.That(status).IsEqualTo(413);
        }

        [Test]
        public async Task A_message_carries_at_most_five_files_and_only_unsent_ones_of_its_own_conversation()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(A_message_carries_at_most_five_files_and_only_unsent_ones_of_its_own_conversation));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);
            var other = await host.CreateConversationAsync(token);

            var ids = new List<Guid>();
            for (var i = 0; i < 6; i++)
                ids.Add(await host.UploadIdAsync(token, chat, $"n{i}.txt", "text/plain", HelplyFiles.Text($"file {i}")));

            await Assert.That((await host.SendMessageAsync(token, chat, "look", [.. ids])).Status).IsEqualTo(400);
            await Assert.That((await host.SendMessageAsync(token, chat, "look", ids[0], ids[0])).Status).IsEqualTo(400);
            await Assert.That((await host.SendMessageAsync(token, other, "look", ids[0])).Status).IsEqualTo(400);
            await Assert.That((await host.SendMessageAsync(token, chat, "look", Guid.NewGuid())).Status).IsEqualTo(400);

            var sent = await host.SendMessageAsync(token, chat, "", ids[0], ids[1], ids[2], ids[3], ids[4]);
            await Assert.That(sent.Names).Contains("done");
            // Sent files cannot be sent again, nor removed on their own.
            await Assert.That((await host.SendMessageAsync(token, chat, "again", ids[0])).Status).IsEqualTo(400);
            await Assert.That((await host.CallAsync(HttpMethod.Delete, $"{Attachments(chat)}/{ids[0]}", token)).Status).IsEqualTo(404);
            await Assert.That((await host.CallAsync(HttpMethod.Delete, $"{Attachments(chat)}/{ids[5]}", token)).Status).IsEqualTo(204);

            var conversation = await host.CallAsync(HttpMethod.Get, $"/api/helply/conversations/{chat}", token);
            var user = conversation.Json.GetProperty("messages")[0];
            await Assert.That(user.GetProperty("attachments").GetArrayLength()).IsEqualTo(5);
            await Assert.That(user.GetProperty("attachments")[0].GetProperty("fileName").GetString()).IsEqualTo("n0.txt");
            // An empty message with files is titled after the first file.
            await Assert.That(conversation.Json.GetProperty("title").GetString()).IsEqualTo("n0.txt");
        }

        [Test]
        public async Task Only_ten_files_may_wait_unsent()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Only_ten_files_may_wait_unsent));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);
            for (var i = 0; i < HelplyAttachmentStore.MaxPendingPerConversation; i++)
                await host.UploadIdAsync(token, chat, $"n{i}.txt", "text/plain", HelplyFiles.Text("x"));
            await Assert.That((await host.UploadAsync(token, chat, "one-more.txt", "text/plain", HelplyFiles.Text("x"))).Status).IsEqualTo(400);
        }

        [Test]
        public async Task Files_are_scoped_to_their_owner()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Files_are_scoped_to_their_owner));
            var (_, alice) = host.NewUser();
            var (_, bob) = host.NewUser();
            var aliceChat = await host.CreateConversationAsync(alice);
            var bobChat = await host.CreateConversationAsync(bob);
            var file = await host.UploadIdAsync(alice, aliceChat, "zeugnis.pdf", "application/pdf", HelplyFiles.Pdf("Alice Zeugnis"));

            await Assert.That((await host.CallAsync(HttpMethod.Get, $"{Attachments(aliceChat)}/{file}", bob)).Status).IsEqualTo(404);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"{Attachments(bobChat)}/{file}", bob)).Status).IsEqualTo(404);
            await Assert.That((await host.CallAsync(HttpMethod.Delete, $"{Attachments(aliceChat)}/{file}", bob)).Status).IsEqualTo(404);
            await Assert.That((await host.UploadAsync(bob, aliceChat, "x.txt", "text/plain", HelplyFiles.Text("x"))).Status).IsEqualTo(404);
            await Assert.That((await host.SendMessageAsync(bob, bobChat, "steal", file)).Status).IsEqualTo(400);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"{Attachments(aliceChat)}/{file}", alice)).Status).IsEqualTo(200);
        }

        [Test]
        public async Task Downloads_are_never_cached_sniffed_or_shown_inline()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Downloads_are_never_cached_sniffed_or_shown_inline));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);
            var data = HelplyFiles.Text("Fach;Note\nMathe;5.5\n");
            var file = await host.UploadIdAsync(token, chat, "noten 2026; final.csv", "text/csv", data);

            using var response = await host.Http.SendAsync(host.Request(HttpMethod.Get, $"{Attachments(chat)}/{file}", token));
            await Assert.That((int)response.StatusCode).IsEqualTo(200);
            await Assert.That(response.Headers.CacheControl!.NoStore).IsTrue();
            await Assert.That(response.Headers.GetValues("X-Content-Type-Options").Single()).IsEqualTo("nosniff");
            await Assert.That(response.Content.Headers.ContentDisposition!.DispositionType).IsEqualTo("attachment");
            await Assert.That(response.Content.Headers.ContentDisposition.FileNameStar ?? response.Content.Headers.ContentDisposition.FileName!.Trim('"')).IsEqualTo("noten 2026_ final.csv");
            await Assert.That(response.Content.Headers.ContentType!.MediaType).IsEqualTo("text/csv");
            await Assert.That(await response.Content.ReadAsByteArrayAsync()).IsEquivalentTo(data);
        }

        [Test]
        public async Task Nothing_of_a_file_is_readable_at_rest_and_blobs_cannot_move()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Nothing_of_a_file_is_readable_at_rest_and_blobs_cannot_move));
            var (_, token) = host.NewUser();
            var chat = await host.CreateConversationAsync(token);
            var first = await host.UploadIdAsync(token, chat, "Geheimnis-Zebra.txt", "text/plain", HelplyFiles.Text("Zebra-secret-content 5.5"));
            var second = await host.UploadIdAsync(token, chat, "other.txt", "text/plain", HelplyFiles.Text("other"));

            await host.ScopedAsync(async sp =>
            {
                var db = sp.GetRequiredService<SchulyDbContext>();
                var rows = await db.HelplyAttachments.AsNoTracking().ToListAsync();
                var contents = await db.HelplyAttachmentContents.AsNoTracking().ToListAsync();
                foreach (var blob in rows.Select(r => r.FileName).Concat(contents.Select(c => c.Data)).Concat(contents.Select(c => c.Text!)))
                {
                    var raw = Encoding.UTF8.GetString(blob);
                    await Assert.That(raw).DoesNotContain("Zebra");
                    await Assert.That(raw).DoesNotContain("Geheimnis");
                }

                // Swap the encrypted bytes of the two files: neither decrypts under the other's id.
                var a = contents.Single(c => c.AttachmentId == first);
                var b = contents.Single(c => c.AttachmentId == second);
                var store = sp.GetRequiredService<HelplyConversationStore>();
                var userId = rows[0].ApplicationUserId;
                var tracked = await db.HelplyAttachmentContents.SingleAsync(c => c.AttachmentId == second);
                tracked.Data = a.Data;
                await db.SaveChangesAsync();
                await Assert.That(() => store.Attachments.ReadDataAsync(userId, chat, second)).Throws<CryptographicException>();
                // And a blob read as another user's fails too.
                await Assert.That(() => store.Attachments.ReadDataAsync(Guid.NewGuid(), chat, first)).ThrowsNothing();
                await Assert.That(await store.Attachments.ReadDataAsync(Guid.NewGuid(), chat, first)).IsNull();
                return 0;
            });
        }

        [Test]
        public async Task Text_is_extracted_once_with_page_and_sheet_markers()
        {
            var pdf = HelplyTextExtractor.Extract(HelplyFileKind.Pdf, HelplyFiles.Pdf("Erste Seite Mathe", "Zweite Seite Deutsch"))!;
            await Assert.That(pdf.PageCount).IsEqualTo(2);
            await Assert.That(pdf.Text).Contains("--- Page 1 ---\nErste Seite Mathe");
            await Assert.That(pdf.Text).Contains("--- Page 2 ---\nZweite Seite Deutsch");

            var docx = HelplyTextExtractor.Extract(HelplyFileKind.Word, HelplyFiles.Docx("Liebe Klasse", "Die Prüfung ist am Montag."))!;
            await Assert.That(docx.Text).IsEqualTo("Liebe Klasse\nDie Prüfung ist am Montag.\n");

            var xlsx = HelplyTextExtractor.Extract(HelplyFileKind.Excel, HelplyFiles.Xlsx("Noten", ["Fach", "Note"], ["Mathe", "5.5"]))!;
            await Assert.That(xlsx.Text).IsEqualTo("--- Sheet Noten ---\nFach\tNote\nMathe\t5.5\n\n");

            await Assert.That(HelplyTextExtractor.Extract(HelplyFileKind.Pdf, HelplyFiles.Text("%PDF-1.7 broken"))).IsNull();
            await Assert.That(HelplyTextExtractor.Extract(HelplyFileKind.Text, [0xEF, 0xBB, 0xBF, (byte)'h', (byte)'i'])!.Text).IsEqualTo("hi");
        }

        [Test]
        public async Task Files_go_with_their_conversation_and_unsent_ones_after_a_day()
        {
            await using var host = await HelplyHttpHost.StartAsync(nameof(Files_go_with_their_conversation_and_unsent_ones_after_a_day));
            var (_, token) = host.NewUser();
            var expiring = await host.CreateConversationAsync(token);
            var deleted = await host.CreateConversationAsync(token);
            var living = await host.CreateConversationAsync(token);

            var sent = await host.UploadIdAsync(token, living, "sent.txt", "text/plain", HelplyFiles.Text("sent"));
            await host.SendMessageAsync(token, living, "here", sent);
            var orphan = await host.UploadIdAsync(token, living, "orphan.txt", "text/plain", HelplyFiles.Text("orphan"));
            await host.UploadIdAsync(token, expiring, "a.txt", "text/plain", HelplyFiles.Text("a"));
            await host.UploadIdAsync(token, deleted, "b.txt", "text/plain", HelplyFiles.Text("b"));

            Task<int> Count() => host.ScopedAsync(sp => sp.GetRequiredService<SchulyDbContext>().HelplyAttachmentContents.CountAsync());
            await Assert.That(await Count()).IsEqualTo(4);

            await Assert.That((await host.CallAsync(HttpMethod.Delete, $"/api/helply/conversations/{deleted}", token)).Status).IsEqualTo(204);
            await Assert.That(await Count()).IsEqualTo(3);

            // A day later the unsent upload is an orphan; the sent one stays.
            host.Time.Advance(TimeSpan.FromHours(25));
            var orphans = await host.ScopedAsync(sp => sp.GetRequiredService<HelplyConversationStore>().Attachments.SweepOrphansAsync());
            await Assert.That(orphans).IsEqualTo(2);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"{Attachments(living)}/{orphan}", token)).Status).IsEqualTo(404);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"{Attachments(living)}/{sent}", token)).Status).IsEqualTo(200);

            // Keep "living" alive, let "expiring" pass its 30 days.
            await host.SendMessageAsync(token, living, "touch");
            host.Time.Advance(TimeSpan.FromDays(29));
            var still = await host.SendMessageAsync(token, living, "still here");
            await Assert.That(still.Names).Contains("done").Because(still.Status + " " + still.Body);
            host.Time.Advance(TimeSpan.FromDays(2));
            await host.ScopedAsync(sp => sp.GetRequiredService<HelplyConversationStore>().SweepAsync());
            await Assert.That(await Count()).IsEqualTo(1);
            await Assert.That((await host.CallAsync(HttpMethod.Get, $"{Attachments(living)}/{sent}", token)).Status).IsEqualTo(200);

            await Assert.That((await host.CallAsync(HttpMethod.Delete, "/api/helply/conversations", token)).Status).IsEqualTo(204);
            await Assert.That(await Count()).IsEqualTo(0);
        }
    }
}
