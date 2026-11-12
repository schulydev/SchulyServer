using System.Collections.Concurrent;
using System.Text.Json;
using Mediator;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Schuly.API.Helply;
using Schuly.API.Mcp.Tools;
using Schuly.API.Plugins;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Application.Queries.Agenda;
using Schuly.Application.Queries.Exam;
using Schuly.Application.Queries.LinkedAccount;
using Schuly.Application.Queries.SchoolUser;
using Schuly.Domain.Enums;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure;
using static Schuly.Tests.Mcp.McpTestSupport;

namespace Schuly.Tests.Mcp
{
    /// <summary>The subject name table and the list_subjects tool: aliases, matching Teams and OneNote names, assessments, permissions and limits.</summary>
    [NotInParallel]
    public class McpSubjectTests
    {
        private static readonly Guid AccountId = Guid.Parse("11111111-2222-3333-4444-555555555555");
        private static readonly Guid SchoolUserId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
        private static readonly Guid MathId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
        private static readonly Guid WrId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
        private static readonly Guid PhysicsId = Guid.Parse("c0000000-0000-0000-0000-000000000003");

        private sealed record Seen(string Method, string Path, string Query);

        private static SchoolData _data = new();

        private sealed class SchoolData
        {
            public List<SchoolUserDto> SchoolUsers { get; set; } = [];
            public List<ExamDto> Exams { get; set; } = [];
            public List<AgendaEntryDto> Agenda { get; set; } = [];
        }

        private static DateOnly Today(int days) => DateOnly.FromDateTime(DateTime.UtcNow).AddDays(days);

        private static SchoolData Sample() => new()
        {
            SchoolUsers =
            [
                new SchoolUserDto
                {
                    Id = SchoolUserId, SchoolId = Guid.NewGuid(), SchoolName = "GIBB", FirstName = "Sam", LastName = "Student", Email = "s@x", Role = Roles.Student,
                    Classes = [new UserClassDto { ClassId = MathId, ClassName = "Mathematik 4. LJ" }, new UserClassDto { ClassId = WrId, ClassName = "Wirtschaft und Recht" }, new UserClassDto { ClassId = PhysicsId, ClassName = "Physik" }],
                },
            ],
            Exams =
            [
                new ExamDto { Id = Guid.NewGuid(), Name = "Test 4", ClassId = MathId, Date = Today(10), ClassAverage = 0 },
                new ExamDto { Id = Guid.NewGuid(), Name = "Test 3", ClassId = MathId, Date = Today(-20), ClassAverage = 0 },
                new ExamDto { Id = Guid.NewGuid(), Name = "Test 1", ClassId = MathId, Date = Today(-90), ClassAverage = 0 },
                new ExamDto { Id = Guid.NewGuid(), Name = "Recht Test", ClassId = WrId, Date = Today(-5), ClassAverage = 0 },
                new ExamDto { Id = Guid.NewGuid(), Name = "Mechanik", ClassId = PhysicsId, Date = null, ClassAverage = 0, Grades = [new GradeDto { Score = 5.5m, Weighting = 1, SchoolUserId = SchoolUserId }] },
            ],
            Agenda =
            [
                new AgendaEntryDto { EntryType = AgendaEntryType.Lesson, Title = "Mathematik", Description = "Hans Muster", Date = DateTime.UtcNow, ClassId = MathId },
                new AgendaEntryDto { EntryType = AgendaEntryType.Lesson, Title = "Mathematik", Description = "Hans Muster", Date = DateTime.UtcNow.AddDays(1), ClassId = MathId },
                new AgendaEntryDto { EntryType = AgendaEntryType.Lesson, Title = "Wirtschaft und Recht", Description = "Bitte Laptop mitnehmen!", Date = DateTime.UtcNow, ClassId = WrId },
            ],
        };

        private static McpPermissionSet Only(params (McpArea Area, McpAccessLevel Level)[] areas)
        {
            var set = McpPermissionSet.None();
            foreach (var (area, level) in areas)
                set.Areas[area] = level;
            return set;
        }

        private static readonly (McpArea, McpAccessLevel)[] Everything = [(McpArea.SchoolAccounts, McpAccessLevel.Read), (McpArea.Exams, McpAccessLevel.Read), (McpArea.Grades, McpAccessLevel.Read), (McpArea.Calendar, McpAccessLevel.Read), (McpArea.Drive, McpAccessLevel.Read), (McpArea.OneNote, McpAccessLevel.Read)];

        private static string DefaultAnswer(string path) => path switch
        {
            "teams" => """[{"id":"t1","displayName":"BM23d"}]""",
            "teams/t1/channels" => """[{"id":"c-gen","displayName":"General"},{"id":"c-math","displayName":"Mathe"},{"id":"c-wr","displayName":"W&R"},{"id":"c-ph","displayName":"Physique"},{"id":"c-deu","displayName":"Deutsch"}]""",
            "onenote/notebooks" => """[{"id":"nb1","displayName":"Klassennotizbuch"}]""",
            "onenote/notebooks/nb1/sections" => """{"children":[{"id":"s1","displayName":"Mathematik","kind":"section"},{"id":"s2","displayName":"Deutsch","kind":"section"},{"id":"g1","displayName":"Naturwissenschaften","kind":"group","children":[{"id":"s3","displayName":"Physik","kind":"section"}]}]}""",
            _ => "[]",
        };

        private static async Task<(McpHttpHost Host, McpClient Client, ConcurrentQueue<Seen> Seen)> StartAsync(string name, McpPermissionSet permissions, Func<string, string?>? answer = null)
        {
            var seen = new ConcurrentQueue<Seen>();
            var host = await McpHttpHost.StartAsync(
                name,
                services =>
                {
                    services.AddScoped<IMediator, SchoolMediator>();
                    services.AddSingleton<PluginHost>(sp => new PluginHost(sp, sp.GetRequiredService<IConfiguration>(), new ApplicationPartManager(), new PluginEndpointDataSource(), new PluginAssemblyMap(), null!, NullLogger<PluginHost>.Instance));
                },
                app => app.MapMethods("/api/plugins/microsoft/accounts/{accountId}/{**rest}", ["GET", "POST"], (HttpContext context, string rest) =>
                {
                    seen.Enqueue(new Seen(context.Request.Method, rest, context.Request.QueryString.Value ?? string.Empty));
                    var json = (answer ?? DefaultAnswer)(rest);
                    return json is null ? Results.NotFound() : Results.Content(json, "application/json");
                }));
            var userId = host.Scoped(sp => NewUser(sp.GetRequiredService<SchulyDbContext>()).User.Id);
            var key = await host.ApiKeyAsync(userId, permissions);
            return (host, await host.ConnectAsync(key), seen);
        }

        private static async Task<JsonElement> CallAsync(McpClient client, string tool, Dictionary<string, object?>? args = null)
        {
            var result = await client.CallToolAsync(tool, args ?? []);
            await Assert.That(result.IsError ?? false).IsFalse().Because(tool);
            return JsonDocument.Parse(((TextContentBlock)result.Content[0]).Text).RootElement;
        }

        private static JsonElement Subject(JsonElement result, string name) => result.GetProperty("subjects").EnumerateArray().Single(s => s.GetProperty("name").GetString() == name);

        // --- the name table ---

        [Test]
        [Arguments("Mathe 4. LJ", "Mathematik")]
        [Arguments("BM23d Mathematik Grundlagen", "Mathematik")]
        [Arguments("maths", "Mathematik")]
        [Arguments("MA", "Mathématiques")]
        [Arguments("W&R", "Wirtschaft und Recht")]
        [Arguments("Wirtschaft & Recht 2. Semester", "WuR")]
        [Arguments("Economie et droit", "Wirtschaft und Recht")]
        [Arguments("physique", "Physik")]
        [Arguments("Fisica", "Physik 3. LJ")]
        [Arguments("Français", "Französisch")]
        [Arguments("Franzoesisch", "français")]
        [Arguments("G&P", "Geschichte und Politik")]
        [Arguments("Histoire et politique", "GP")]
        [Arguments("Education physique", "Sport")]
        [Arguments("Éducation physique et sportive", "EPS")]
        [Arguments("ABU", "Allgemeinbildung")]
        [Arguments("Culture générale", "Allgemeinbildender Unterricht")]
        [Arguments("NW", "Naturwissenschaften")]
        [Arguments("Inglese", "Englisch")]
        public async Task Names_of_the_same_subject_match_as_aliases(string a, string b)
        {
            await Assert.That(SubjectAliases.Match(a, b) >= SubjectMatch.Alias).IsTrue();
            await Assert.That(SubjectAliases.Match(b, a) >= SubjectMatch.Alias).IsTrue();
        }

        [Test]
        public async Task Normalisation_ignores_case_accents_punctuation_and_year_or_class_prefixes()
        {
            await Assert.That(SubjectAliases.Normalize("Wirtschaft & Recht")).IsEqualTo("wirtschaft und recht");
            await Assert.That(SubjectAliases.Normalize("Français")).IsEqualTo("francais");
            await Assert.That(SubjectAliases.Clean("Mathe 4. LJ")).IsEqualTo("mathe");
            await Assert.That(SubjectAliases.Clean("BM23d Mathe")).IsEqualTo("mathe");
            await Assert.That(SubjectAliases.Clean("BM-Mathematik (2. Sem.)")).IsEqualTo("mathematik");
            await Assert.That(SubjectAliases.Match("Mathematik 4. LJ", "mathematik")).IsEqualTo(SubjectMatch.Exact);
            await Assert.That(SubjectAliases.Match("Mathe", "Mathematik")).IsEqualTo(SubjectMatch.Alias);
            await Assert.That(SubjectAliases.Match("Biologi", "Biologie")).IsEqualTo(SubjectMatch.Fuzzy);
        }

        [Test]
        public async Task Different_subjects_and_short_abbreviations_inside_other_words_do_not_match()
        {
            await Assert.That(SubjectAliases.Match("Physik", "Chemie")).IsEqualTo(SubjectMatch.None);
            await Assert.That(SubjectAliases.Match("Sport", "Education physique")).IsEqualTo(SubjectMatch.Alias);
            await Assert.That(SubjectAliases.Match("Physik", "Education physique")).IsEqualTo(SubjectMatch.None);
            await Assert.That(SubjectAliases.Resolve("Fotografie und Design")).IsNull();
            await Assert.That(SubjectAliases.Resolve("Kunde de Lehre")).IsNull();
            await Assert.That(SubjectAliases.Match("", "Mathematik")).IsEqualTo(SubjectMatch.None);
            await Assert.That(SubjectAliases.AliasesOf("Mathe")).Contains("Mathematik");
            await Assert.That(SubjectAliases.AliasesOf("Fotografie")).IsEquivalentTo(new[] { "Fotografie" });
        }

        [Test]
        public async Task Teacher_names_are_taken_from_lesson_notes_that_look_like_names_only()
        {
            var teachers = SubjectTeachers.FromLessons(["Hans Muster", "Hans Muster, Anna Frei", "Bitte Laptop mitnehmen!", "Prüfung Test 3", null, ""]);
            await Assert.That(teachers).IsEquivalentTo(new[] { "Hans Muster", "Anna Frei" });
            await Assert.That(teachers[0]).IsEqualTo("Hans Muster");
        }

        // --- list_subjects ---

        [Test]
        public async Task List_subjects_merges_school_data_aliases_channels_notebooks_and_assessments()
        {
            _data = Sample();
            var (host, client, _) = await StartAsync(nameof(List_subjects_merges_school_data_aliases_channels_notebooks_and_assessments), Only(Everything));
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "list_subjects");
            await Assert.That(result.GetProperty("subjects").GetArrayLength()).IsEqualTo(3);
            await Assert.That(result.TryGetProperty("skipped", out _)).IsFalse();

            var math = Subject(result, "Mathematik 4. LJ");
            await Assert.That(math.GetProperty("canonical").GetString()).IsEqualTo("Mathematik");
            await Assert.That(math.GetProperty("school").GetString()).IsEqualTo("GIBB");
            await Assert.That(math.GetProperty("aliases").EnumerateArray().Select(a => a.GetString())).Contains("Mathe");
            await Assert.That(math.GetProperty("teachers").EnumerateArray().Select(a => a.GetString()!)).IsEquivalentTo(new[] { "Hans Muster" });
            var channel = math.GetProperty("teams").EnumerateArray().Single();
            await Assert.That(channel.GetProperty("channelId").GetString()).IsEqualTo("c-math");
            await Assert.That(channel.GetProperty("teamId").GetString()).IsEqualTo("t1");
            await Assert.That(channel.GetProperty("confidence").GetString()).IsEqualTo("alias");
            var section = math.GetProperty("notebooks").EnumerateArray().Single();
            await Assert.That(section.GetProperty("sectionId").GetString()).IsEqualTo("s1");
            await Assert.That(section.GetProperty("confidence").GetString()).IsEqualTo("exact");
            await Assert.That(math.GetProperty("nextAssessment").GetProperty("name").GetString()).IsEqualTo("Test 4");
            await Assert.That(math.GetProperty("nextAssessment").GetProperty("date").GetString()).IsEqualTo(Today(10).ToString("yyyy-MM-dd"));
            await Assert.That(math.GetProperty("lastAssessment").GetProperty("name").GetString()).IsEqualTo("Test 3");

            var wr = Subject(result, "Wirtschaft und Recht");
            await Assert.That(wr.GetProperty("teams").EnumerateArray().Single().GetProperty("channelId").GetString()).IsEqualTo("c-wr");
            await Assert.That(wr.TryGetProperty("teachers", out _)).IsFalse();
            await Assert.That(wr.TryGetProperty("nextAssessment", out _)).IsFalse();
            await Assert.That(wr.GetProperty("lastAssessment").GetProperty("name").GetString()).IsEqualTo("Recht Test");

            var physics = Subject(result, "Physik");
            await Assert.That(physics.GetProperty("teams").EnumerateArray().Single().GetProperty("channelId").GetString()).IsEqualTo("c-ph");
            await Assert.That(physics.GetProperty("notebooks").EnumerateArray().Single().GetProperty("sectionId").GetString()).IsEqualTo("s3");
            var fallback = physics.GetProperty("lastAssessment");
            await Assert.That(fallback.GetProperty("source").GetString()).IsEqualTo("grade");
            await Assert.That(fallback.GetProperty("score").GetDecimal()).IsEqualTo(5.5m);
        }

        [Test]
        public async Task List_subjects_leaves_out_what_the_connection_may_not_read_and_says_so()
        {
            _data = Sample();
            var (host, client, seen) = await StartAsync(nameof(List_subjects_leaves_out_what_the_connection_may_not_read_and_says_so), Only((McpArea.SchoolAccounts, McpAccessLevel.Read)));
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "list_subjects");
            await Assert.That(seen.IsEmpty).IsTrue();
            var skipped = result.GetProperty("skipped").EnumerateArray().Select(s => s.GetProperty("source").GetString() + ":" + s.GetProperty("reason").GetString()).ToList();
            await Assert.That(skipped).IsEquivalentTo(new[] { "exams:needs Exams read", "grades:needs Grades read", "teachers:needs Calendar read", "teams:needs Drive read", "onenote:needs OneNote read" });
            var math = Subject(result, "Mathematik 4. LJ");
            await Assert.That(math.GetProperty("teams").GetArrayLength()).IsEqualTo(0);
            await Assert.That(math.TryGetProperty("nextAssessment", out _)).IsFalse();
            await Assert.That(math.TryGetProperty("teachers", out _)).IsFalse();

            var (teamsHost, teamsClient, teamsSeen) = await StartAsync(nameof(List_subjects_leaves_out_what_the_connection_may_not_read_and_says_so) + "B", Only((McpArea.SchoolAccounts, McpAccessLevel.Read), (McpArea.Drive, McpAccessLevel.Read), (McpArea.Exams, McpAccessLevel.Read)));
            await using var _h2 = teamsHost;
            await using var _c2 = teamsClient;
            var partialAccess = await CallAsync(teamsClient, "list_subjects");
            await Assert.That(teamsSeen.Any(s => s.Path.StartsWith("onenote"))).IsFalse();
            await Assert.That(teamsSeen.Any(s => s.Path == "teams")).IsTrue();
            await Assert.That(Subject(partialAccess, "Physik").TryGetProperty("lastAssessment", out _)).IsFalse().Because("the grade fallback needs Grades read");
            await Assert.That(Subject(partialAccess, "Mathematik 4. LJ").GetProperty("nextAssessment").GetProperty("name").GetString()).IsEqualTo("Test 4");
        }

        [Test]
        public async Task List_subjects_with_a_subject_returns_only_matching_subjects_and_the_search_names()
        {
            _data = Sample();
            var (host, client, _) = await StartAsync(nameof(List_subjects_with_a_subject_returns_only_matching_subjects_and_the_search_names), Only(Everything));
            await using var _h = host;
            await using var _c = client;

            var maths = await CallAsync(client, "list_subjects", new() { ["subject"] = "maths" });
            await Assert.That(maths.GetProperty("subjects").EnumerateArray().Select(s => s.GetProperty("name").GetString()!)).IsEquivalentTo(new[] { "Mathematik 4. LJ" });
            await Assert.That(maths.GetProperty("query").GetProperty("aliases").EnumerateArray().Select(a => a.GetString())).Contains("Mathematik");

            var none = await CallAsync(client, "list_subjects", new() { ["subject"] = "Chemie" });
            await Assert.That(none.GetProperty("subjects").GetArrayLength()).IsEqualTo(0);
            await Assert.That(none.GetProperty("note").GetString()).Contains("aliases");
        }

        [Test]
        public async Task List_subjects_reports_a_failing_source_and_caps_the_Microsoft_calls()
        {
            _data = Sample();
            var teams = "[" + string.Join(",", Enumerable.Range(0, 15).Select(i => "{\"id\":\"t" + i + "\",\"displayName\":\"Team " + i + "\"}")) + "]";
            var (host, client, seen) = await StartAsync(nameof(List_subjects_reports_a_failing_source_and_caps_the_Microsoft_calls), Only(Everything), path => path switch
            {
                "teams" => teams,
                "onenote/notebooks" => null,
                _ => path.EndsWith("/channels") ? """[{"id":"x","displayName":"Mathe"}]""" : "[]",
            });
            await using var _h = host;
            await using var _c = client;

            var result = await CallAsync(client, "list_subjects");
            await Assert.That(result.GetProperty("partial").GetBoolean()).IsTrue();
            await Assert.That(seen.Count(s => s.Path.EndsWith("/channels"))).IsEqualTo(12);
            await Assert.That(result.GetProperty("errors").EnumerateArray().Any(e => e.GetString()!.StartsWith("notebooks:"))).IsTrue();
            await Assert.That(Subject(result, "Mathematik 4. LJ").GetProperty("teams").GetArrayLength()).IsEqualTo(5);
        }

        [Test]
        public async Task List_subjects_is_hidden_without_school_account_read()
        {
            var (host, client, _) = await StartAsync(nameof(List_subjects_is_hidden_without_school_account_read), Only((McpArea.Exams, McpAccessLevel.Read)));
            await using var _h = host;
            await using var _c = client;
            await Assert.That((await client.ListToolsAsync()).Select(t => t.Name)).DoesNotContain("list_subjects");
        }

        [Test]
        public async Task The_prompt_resolves_the_subject_with_list_subjects_and_keeps_the_manual_fallback()
        {
            var prompt = HelplyPrompt.System(DateTimeOffset.UtcNow);

            await Assert.That(prompt).Contains("call list_subjects with the user's word as subject");
            await Assert.That(prompt).Contains("If it is unavailable or finds nothing, collect subject names yourself from list_grades");
        }

        private sealed class SchoolMediator : IMediator
        {
            private readonly EmptyMediator _inner = new();

            public ValueTask<TResponse> Send<TResponse>(IQuery<TResponse> query, CancellationToken cancellationToken = default)
            {
                object? answer = query switch
                {
                    GetMyLinkedAccountsQuery => Result<List<LinkedAccountDto>>.Success([new LinkedAccountDto { Id = AccountId, Provider = "microsoft", Email = "student@school.test" }]),
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
