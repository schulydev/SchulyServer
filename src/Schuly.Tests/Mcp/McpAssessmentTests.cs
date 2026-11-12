using System.Text.Json;
using Mediator;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Schuly.API.Helply;
using Schuly.API.Mcp.Tools;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Application.Queries.Agenda;
using Schuly.Application.Queries.Exam;
using Schuly.Application.Queries.SchoolUser;
using Schuly.Domain.Enums;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using static Schuly.Tests.Mcp.McpTestSupport;

namespace Schuly.Tests.Mcp
{
    /// <summary>Assessment keyword detection and the list_assessments tool: merging exams and agenda, de-duplication, subject aliases, date range and permissions.</summary>
    [NotInParallel]
    public class McpAssessmentTests
    {
        private static readonly Guid SchoolUserId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
        private static readonly Guid MathId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
        private static readonly Guid PhysicsId = Guid.Parse("c0000000-0000-0000-0000-000000000003");

        private static SchoolData _data = new();

        private sealed class SchoolData
        {
            public List<SchoolUserDto> SchoolUsers { get; set; } = [];
            public List<ExamDto> Exams { get; set; } = [];
            public List<AgendaEntryDto> Agenda { get; set; } = [];
        }

        private static DateOnly Day(int days) => DateOnly.FromDateTime(DateTime.UtcNow).AddDays(days);

        private static DateTime At(int days, int hour = 0, int minute = 0) => DateTime.UtcNow.Date.AddDays(days).AddHours(hour).AddMinutes(minute);

        private static AgendaEntryDto Entry(AgendaEntryType type, string title, DateTime date, Guid? classId = null, string? description = null) => new() { EntryType = type, Title = title, Description = description, Date = date, ClassId = classId };

        private static SchoolData Sample() => new()
        {
            SchoolUsers =
            [
                new SchoolUserDto
                {
                    Id = SchoolUserId, SchoolId = Guid.NewGuid(), SchoolName = "GIBB", FirstName = "Sam", LastName = "Student", Email = "s@x", Role = Roles.Student,
                    Classes = [new UserClassDto { ClassId = MathId, ClassName = "Mathematik 4. LJ" }, new UserClassDto { ClassId = PhysicsId, ClassName = "Physik" }],
                },
            ],
            Exams =
            [
                new ExamDto { Id = Guid.NewGuid(), Name = "Test 4", ClassId = MathId, Date = Day(5), ClassAverage = 0 },
                new ExamDto { Id = Guid.NewGuid(), Name = "Schlusspruefung", ClassId = PhysicsId, Date = Day(40), ClassAverage = 0 },
                new ExamDto { Id = Guid.NewGuid(), Name = "Test 2", ClassId = MathId, Date = Day(-30), ClassAverage = 0 },
                new ExamDto { Id = Guid.NewGuid(), Name = "Ohne Datum", ClassId = MathId, Date = null, ClassAverage = 0 },
            ],
            Agenda =
            [
                Entry(AgendaEntryType.Lesson, "Mathematik", At(1, 8), MathId, "Hans Muster"),
                Entry(AgendaEntryType.Lesson, "Mathematik", At(2, 8), MathId, "Hans Muster"),
                Entry(AgendaEntryType.Test, "Mathe Test", At(5, 8, 15), MathId),
                Entry(AgendaEntryType.Event, "Präsentation Marketing", At(7, 14)),
                Entry(AgendaEntryType.Lesson, "Mathematik", At(9, 10), MathId, "Abgabe Projekt"),
                Entry(AgendaEntryType.Lesson, "Mathematik", At(9, 11), MathId, "Abgabe Projekt"),
                Entry(AgendaEntryType.Test, "Biologie", At(3)),
                Entry(AgendaEntryType.Holiday, "Prüfungsfrei", At(4)),
                Entry(AgendaEntryType.Test, "Physik Test", At(-3), PhysicsId),
            ],
        };

        private static McpPermissionSet Only(params (McpArea Area, McpAccessLevel Level)[] areas)
        {
            var set = McpPermissionSet.None();
            foreach (var (area, level) in areas)
                set.Areas[area] = level;
            return set;
        }

        private static async Task<(McpHttpHost Host, McpClient Client)> StartAsync(string name, McpPermissionSet permissions)
        {
            var host = await McpHttpHost.StartAsync(name, services => services.AddScoped<IMediator, SchoolMediator>());
            var userId = host.Scoped(sp => NewUser(sp.GetRequiredService<SchulyDbContext>()).User.Id);
            return (host, await host.ConnectAsync(await host.ApiKeyAsync(userId, permissions)));
        }

        private static async Task<JsonElement> CallAsync(McpClient client, string tool, Dictionary<string, object?>? args = null)
        {
            var result = await client.CallToolAsync(tool, args ?? []);
            await Assert.That(result.IsError ?? false).IsFalse().Because(tool);
            return JsonDocument.Parse(((TextContentBlock)result.Content[0]).Text).RootElement;
        }

        private static List<JsonElement> Items(JsonElement result) => result.GetProperty("assessments").GetProperty("assessments").EnumerateArray().ToList();

        private static string[] Titles(JsonElement result) => Items(result).Select(i => i.GetProperty("title").GetString()!).ToArray();

        [Test]
        [Arguments("Test 3", "exam")]
        [Arguments("Mathetest", "exam")]
        [Arguments("Prüfung Kapitel 4", "exam")]
        [Arguments("Schlusspruefung", "exam")]
        [Arguments("LK Physik", "exam")]
        [Arguments("Lernkontrolle Gleichungen", "exam")]
        [Arguments("Mündliche Prüfung", "exam")]
        [Arguments("Contrôle de maths", "exam")]
        [Arguments("Épreuve de français", "exam")]
        [Arguments("Verifica di storia", "exam")]
        [Arguments("Esame finale", "exam")]
        [Arguments("Vortrag Marketing", "presentation")]
        [Arguments("Referat", "presentation")]
        [Arguments("Präsentation Projekt", "presentation")]
        [Arguments("Presentation of the report", "presentation")]
        [Arguments("Abgabe Projektarbeit", "hand-in")]
        [Arguments("Hand-in report", "hand-in")]
        [Arguments("Rendu du dossier", "hand-in")]
        [Arguments("Consegna progetto", "hand-in")]
        [Arguments("Projektprüfung", "exam")]
        public async Task Assessment_words_in_four_languages_are_recognised(string text, string kind)
        {
            await Assert.That(AssessmentKinds.Classify(text, null)).IsEqualTo(kind);
        }

        [Test]
        [Arguments("Mathematik")]
        [Arguments("Stundenplan")]
        [Arguments("Protest gegen Lärm")]
        [Arguments("latest news")]
        [Arguments("Kein Test heute")]
        [Arguments("Ohne Prüfung")]
        [Arguments("example")]
        [Arguments("Hand Training")]
        public async Task Other_text_is_not_an_assessment(string text)
        {
            await Assert.That(AssessmentKinds.Classify(text, null)).IsNull();
        }

        [Test]
        public async Task The_lesson_note_counts_too()
        {
            await Assert.That(AssessmentKinds.Classify("Mathematik", "Nächste Woche Prüfung zu Kapitel 3")).IsEqualTo("exam");
            await Assert.That(AssessmentKinds.Classify("Mathematik", "Hans Muster")).IsNull();
        }

        [Test]
        public async Task List_assessments_merges_exams_and_agenda_and_lists_the_same_test_once()
        {
            _data = Sample();
            var (host, client) = await StartAsync(nameof(List_assessments_merges_exams_and_agenda_and_lists_the_same_test_once), Only((McpArea.Exams, McpAccessLevel.Read), (McpArea.Calendar, McpAccessLevel.Read)));
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "list_assessments");

            // Default range: today to +30 days. Past entries, the exam in 40 days, the holiday, plain lessons and the exam without a date are not in it.
            await Assert.That(Titles(result)).IsEquivalentTo(new[] { "Biologie", "Test 4", "Präsentation Marketing", "Mathematik: Abgabe Projekt" }, TUnit.Assertions.Enums.CollectionOrdering.Matching);
            var items = Items(result);

            var exam = items[1];
            await Assert.That(exam.GetProperty("source").GetString()).IsEqualTo("exams");
            await Assert.That(exam.GetProperty("kind").GetString()).IsEqualTo("exam");
            await Assert.That(exam.GetProperty("subject").GetString()).IsEqualTo("Mathematik 4. LJ");
            await Assert.That(exam.GetProperty("date").GetString()).IsEqualTo(Day(5).ToString("yyyy-MM-dd"));
            await Assert.That(exam.GetProperty("time").GetString()).IsEqualTo("08:15").Because("the time comes from the matching agenda entry");
            await Assert.That(exam.GetProperty("alsoInAgenda").GetBoolean()).IsTrue();
            await Assert.That(exam.GetProperty("teachers").EnumerateArray().Select(t => t.GetString()!)).Contains("Hans Muster");

            var other = items[0];
            await Assert.That(other.GetProperty("source").GetString()).IsEqualTo("agenda");
            await Assert.That(other.GetProperty("kind").GetString()).IsEqualTo("other");
            await Assert.That(other.GetProperty("subject").GetString()).IsEqualTo("Biologie");

            var presentation = items[2];
            await Assert.That(presentation.GetProperty("kind").GetString()).IsEqualTo("presentation");
            await Assert.That(presentation.GetProperty("time").GetString()).IsEqualTo("14:00");
            await Assert.That(presentation.TryGetProperty("subject", out _)).IsFalse();

            var handIn = items[3];
            await Assert.That(handIn.GetProperty("kind").GetString()).IsEqualTo("hand-in");
            await Assert.That(handIn.GetProperty("subject").GetString()).IsEqualTo("Mathematik 4. LJ");

            await Assert.That(result.GetProperty("searched").EnumerateArray().Select(s => s.GetString()!)).IsEquivalentTo(new[] { "exams", "agenda" });
            await Assert.That(result.GetProperty("note").GetString()).Contains("not schedule documents");
        }

        [Test]
        public async Task List_assessments_filters_by_subject_alias_and_by_date_range()
        {
            _data = Sample();
            var (host, client) = await StartAsync(nameof(List_assessments_filters_by_subject_alias_and_by_date_range), Only((McpArea.Exams, McpAccessLevel.Read), (McpArea.Calendar, McpAccessLevel.Read)));
            await using var _h = host;
            await using var _c = client;

            var mathe = await CallAsync(client, "list_assessments", new() { ["subject"] = "Mathe" });
            await Assert.That(Titles(mathe)).IsEquivalentTo(new[] { "Test 4", "Mathematik: Abgabe Projekt" }, TUnit.Assertions.Enums.CollectionOrdering.Matching);

            var bio = await CallAsync(client, "list_assessments", new() { ["subject"] = "biology" });
            await Assert.That(Titles(bio)).IsEquivalentTo(new[] { "Biologie" });

            var physique = await CallAsync(client, "list_assessments", new() { ["subject"] = "physique", ["to"] = Day(60).ToString("yyyy-MM-dd") });
            await Assert.That(Titles(physique)).IsEquivalentTo(new[] { "Schlusspruefung" });

            var past = await CallAsync(client, "list_assessments", new() { ["from"] = Day(-40).ToString("yyyy-MM-dd"), ["to"] = Day(-1).ToString("yyyy-MM-dd") });
            await Assert.That(Titles(past)).IsEquivalentTo(new[] { "Test 2", "Physik Test" }, TUnit.Assertions.Enums.CollectionOrdering.Matching);

            var bad = await client.CallToolAsync("list_assessments", new Dictionary<string, object?> { ["from"] = Day(5).ToString("yyyy-MM-dd"), ["to"] = Day(1).ToString("yyyy-MM-dd") });
            await Assert.That(bad.IsError ?? false).IsTrue();
        }

        [Test]
        public async Task List_assessments_reads_the_agenda_only_with_Calendar_read()
        {
            _data = Sample();
            var (host, client) = await StartAsync(nameof(List_assessments_reads_the_agenda_only_with_Calendar_read), Only((McpArea.Exams, McpAccessLevel.Read)));
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "list_assessments");
            await Assert.That(Titles(result)).IsEquivalentTo(new[] { "Test 4" });
            await Assert.That(Items(result)[0].TryGetProperty("teachers", out _)).IsFalse();
            await Assert.That(result.GetProperty("searched").EnumerateArray().Select(s => s.GetString()!)).IsEquivalentTo(new[] { "exams" });
            await Assert.That(result.GetProperty("skipped")[0].GetProperty("reason").GetString()).IsEqualTo("needs Calendar read");

            var (hiddenHost, hiddenClient) = await StartAsync(nameof(List_assessments_reads_the_agenda_only_with_Calendar_read) + "B", Only((McpArea.Calendar, McpAccessLevel.Read)));
            await using var _h2 = hiddenHost;
            await using var _c2 = hiddenClient;
            await Assert.That((await hiddenClient.ListToolsAsync()).Select(t => t.Name)).DoesNotContain("list_assessments");
        }

        [Test]
        public async Task The_tool_description_says_it_does_not_read_schedule_documents()
        {
            _data = Sample();
            var (host, client) = await StartAsync(nameof(The_tool_description_says_it_does_not_read_schedule_documents), Only((McpArea.Exams, McpAccessLevel.Read)));
            await using var _h = host;
            await using var _c = client;

            var tool = (await client.ListToolsAsync()).Single(t => t.Name == "list_assessments");
            await Assert.That(tool.Description).Contains("does NOT read schedule documents");
            await Assert.That(tool.Description).Contains("search and read_file");
        }

        [Test]
        public async Task The_prompt_finds_dates_with_list_assessments_and_keeps_the_fallbacks()
        {
            var prompt = HelplyPrompt.System(DateTimeOffset.UtcNow);

            await Assert.That(prompt).Contains("Use list_assessments with a date range");
            await Assert.That(prompt).Contains("fall back to list_exams and list_agenda");
            await Assert.That(prompt).Contains("an empty result does not mean there is no test");
        }

        private sealed class SchoolMediator : IMediator
        {
            private readonly EmptyMediator _inner = new();

            public ValueTask<TResponse> Send<TResponse>(IQuery<TResponse> query, CancellationToken cancellationToken = default)
            {
                object? answer = query switch
                {
                    GetSchoolUsersQuery => Result<List<SchoolUserDto>>.Success(_data.SchoolUsers),
                    GetExamsQuery => Result<List<ExamDto>>.Success(_data.Exams),
                    GetAgendasQuery => Result<List<AgendaEntryDto>>.Success(_data.Agenda),
                    _ => null,
                };
                return answer is null ? _inner.Send(query, cancellationToken) : new((TResponse)answer);
            }

            public ValueTask<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default) => _inner.Send(request, cancellationToken);
            public ValueTask<TResponse> Send<TResponse>(ICommand<TResponse> command, CancellationToken cancellationToken = default) => _inner.Send(command, cancellationToken);
            public ValueTask<object?> Send(object message, CancellationToken cancellationToken = default) => _inner.Send(message, cancellationToken);
            public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamQuery<TResponse> query, CancellationToken cancellationToken = default) => _inner.CreateStream(query, cancellationToken);
            public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) => _inner.CreateStream(request, cancellationToken);
            public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamCommand<TResponse> command, CancellationToken cancellationToken = default) => _inner.CreateStream(command, cancellationToken);
            public IAsyncEnumerable<object?> CreateStream(object message, CancellationToken cancellationToken = default) => _inner.CreateStream(message, cancellationToken);
            public ValueTask Publish<TNotification>(TNotification notification, CancellationToken cancellationToken = default) where TNotification : INotification => _inner.Publish(notification, cancellationToken);
            public ValueTask Publish(object notification, CancellationToken cancellationToken = default) => _inner.Publish(notification, cancellationToken);
        }
    }
}
