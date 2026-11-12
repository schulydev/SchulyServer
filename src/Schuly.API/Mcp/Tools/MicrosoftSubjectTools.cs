using System.ComponentModel;
using System.Collections.Concurrent;
using System.Text.Json;
using Mediator;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using Schuly.Application.Dtos;
using Schuly.Application.Queries.Agenda;
using Schuly.Application.Queries.Exam;
using Schuly.Application.Queries.SchoolUser;
using Schuly.Domain.Enums;
using Schuly.Domain.Mcp;
using static Schuly.API.Mcp.Tools.McpToolSupport;

namespace Schuly.API.Mcp.Tools
{
    /// <summary>The user's subject map: subjects from the school data, the names they go by, and the Teams channels and OneNote notebooks and sections that belong to them.</summary>
    public sealed partial class MicrosoftTools
    {
        private const int MaxChannelCalls = 12;
        private const int MaxNotebookSectionCalls = 8;
        private const int MaxMatchesPerKind = 5;
        private const int SubjectsConcurrency = 4;
        private static readonly TimeSpan SubjectsTimeout = TimeSpan.FromSeconds(20);

        [McpServerTool(Name = "list_subjects", Title = "List my subjects", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = true)]
        [Description("Returns the user's subjects in one call, from their own school data (per school account) with the teacher where the school passes it on, every name the subject goes by (Mathe / Mathematik / MA / maths, W&R / Wirtschaft und Recht, Physik / physique ...; use these as search terms), the Teams channels and OneNote notebooks or sections that match it (confidence exact, alias or fuzzy) and the next and the last assessment. Call it first to resolve what the user means by a subject, then search exactly there. Pass subject to get only the subjects that match a name or abbreviation in any language, with year and class prefixes ignored (Mathe 4. LJ matches Mathematik). Teams and OneNote matches are left out, and the answer says so, when this connection may not read them; exams, agenda and grades likewise need Exams, Calendar and Grades read. partial is true when a limit or a failing source made the answer incomplete.")]
        [McpAccess(McpArea.SchoolAccounts, McpAccessLevel.Read)]
        public async Task<string> ListSubjects([Description("Only this subject, by any of its names or abbreviations.")] string? subject = null, [Description("Microsoft account for the Teams and OneNote matches; defaults to the first one this connection may use.")] Guid? accountId = null, CancellationToken ct = default)
        {
            var permissions = Caller(accessor).Permissions;
            var skipped = new List<object>();
            var errors = new List<string>();

            var schoolUsers = Unwrap(await mediator.Send(new GetSchoolUsersQuery(), ct));
            var all = schoolUsers
                .SelectMany(s => s.Classes.Select(c => new SubjectRow(c.ClassId, c.ClassName, s.Id, s.SchoolName)))
                .DistinctBy(r => (r.SchoolUserId, r.ClassId))
                .ToList();
            var rows = string.IsNullOrWhiteSpace(subject) ? all : all.Where(r => SubjectAliases.Match(subject, r.Name) != SubjectMatch.None).ToList();

            List<ExamDto> exams = [];
            if (!permissions.Allows(McpArea.Exams, McpAccessLevel.Read))
                skipped.Add(new { source = "exams", reason = "needs Exams read" });
            else
                exams = Unwrap(await mediator.Send(new GetExamsQuery(), ct));
            var gradesAllowed = permissions.Allows(McpArea.Grades, McpAccessLevel.Read);
            if (!gradesAllowed)
                skipped.Add(new { source = "grades", reason = "needs Grades read" });

            List<AgendaEntryDto> lessons = [];
            if (!permissions.Allows(McpArea.Calendar, McpAccessLevel.Read))
                skipped.Add(new { source = "teachers", reason = "needs Calendar read" });
            else
                lessons = Unwrap(await mediator.Send(new GetAgendasQuery(), ct)).Where(a => a.EntryType == AgendaEntryType.Lesson).ToList();

            var partial = false;
            var names = new MicrosoftNames();
            if (rows.Count > 0)
            {
                var wantTeams = permissions.Allows(McpArea.Drive, McpAccessLevel.Read);
                var wantNotebooks = permissions.Allows(McpArea.OneNote, McpAccessLevel.Read);
                if (!wantTeams)
                    skipped.Add(new { source = "teams", reason = "needs Drive read" });
                if (!wantNotebooks)
                    skipped.Add(new { source = "onenote", reason = "needs OneNote read" });
                if (wantTeams || wantNotebooks)
                {
                    try
                    {
                        var account = await AccountAsync(accountId, ct);
                        names = await LoadMicrosoftNamesAsync(account, wantTeams, wantNotebooks, errors, ct);
                        partial = names.Partial;
                    }
                    catch (McpException ex)
                    {
                        skipped.Add(new { source = "microsoft", reason = ex.Message });
                    }
                }
            }
            partial |= errors.Count > 0;

            var today = SwissTime.Today();
            var subjects = rows.Select(r => SubjectOutput(r, exams, lessons, names, gradesAllowed, today)).ToList();
            return Serialize(new
            {
                query = string.IsNullOrWhiteSpace(subject) ? null : new { input = subject.Trim(), subject = SubjectAliases.Resolve(subject)?.Name, aliases = SubjectAliases.AliasesOf(subject).Take(14) },
                partial,
                skipped = skipped.Count == 0 ? null : skipped,
                errors = errors.Count == 0 ? null : errors.Take(10).ToList(),
                subjects,
                note = rows.Count == 0 ? (all.Count == 0 ? "No school classes are connected to this account." : "None of the user's subjects matches that name. Search with query.aliases as terms instead.") : null,
            });
        }

        private static object SubjectOutput(SubjectRow r, List<ExamDto> exams, List<AgendaEntryDto> lessons, MicrosoftNames names, bool gradesAllowed, DateOnly today)
        {
            var known = SubjectAliases.Resolve(r.Name);
            var mine = exams.Where(e => e.ClassId == r.ClassId).ToList();
            var next = mine.Where(e => e.Date is { } d && d >= today).OrderBy(e => e.Date).FirstOrDefault();
            var last = mine.Where(e => e.Date is { } d && d < today).OrderByDescending(e => e.Date).FirstOrDefault();
            object? lastOutput = last is null ? null : ExamOutput(last, "exam");
            if (last is null && gradesAllowed)
            {
                var graded = mine.Where(e => e.Grades.Any(g => g.SchoolUserId == r.SchoolUserId)).OrderByDescending(e => e.Date ?? DateOnly.MinValue).FirstOrDefault();
                if (graded is not null)
                    lastOutput = new { source = "grade", examId = graded.Id, name = graded.Name, date = graded.Date, score = graded.Grades.First(g => g.SchoolUserId == r.SchoolUserId).Score };
            }

            var teachers = SubjectTeachers.FromLessons(lessons.Where(a => a.ClassId == r.ClassId || (a.ClassId is null && known is not null && SubjectAliases.Resolve(a.Title)?.Key == known.Key)).Select(a => a.Description));
            return new
            {
                subjectId = r.ClassId,
                name = r.Name,
                canonical = known?.Name,
                school = r.SchoolName,
                schoolUserId = r.SchoolUserId,
                aliases = SubjectAliases.AliasesOf(r.Name).Take(14),
                teachers = teachers.Count == 0 ? null : teachers,
                teams = names.MatchTeams(r.Name).Take(MaxMatchesPerKind).ToList(),
                notebooks = names.MatchNotebooks(r.Name).Take(MaxMatchesPerKind).ToList(),
                nextAssessment = next is null ? null : ExamOutput(next, "exam"),
                lastAssessment = lastOutput,
            };
        }

        private static object ExamOutput(ExamDto e, string source) => new { source, examId = e.Id, name = e.Name, date = e.Date, type = e.Type };

        /// <summary>Team, channel, notebook and section names of the user's Microsoft account, fetched with a cap on calls and a timeout.</summary>
        private async Task<MicrosoftNames> LoadMicrosoftNamesAsync(Guid account, bool teams, bool notebooks, List<string> errors, CancellationToken ct)
        {
            var result = new MicrosoftNames();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(SubjectsTimeout);
            using var gate = new SemaphoreSlim(SubjectsConcurrency);
            var failures = new ConcurrentBag<string>();
            var teamRows = new ConcurrentBag<(string Id, string Name, List<(string Id, string Name)> Channels)>();
            var notebookRows = new ConcurrentBag<(string Id, string Name, List<(string Id, string Name)> Sections)>();

            async Task Guarded(string label, Func<CancellationToken, Task> work)
            {
                await gate.WaitAsync(timeout.Token);
                try
                {
                    await work(timeout.Token);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    failures.Add($"{label}: timed out");
                }
                catch (McpException ex)
                {
                    failures.Add($"{label}: {ex.Message}");
                }
                finally
                {
                    gate.Release();
                }
            }

            var tasks = new List<Task>();
            if (teams)
                tasks.Add(Guarded("teams", async c =>
                {
                    var list = Items(await ReadAsync($"{Base}/accounts/{account}/teams", c)).Select(t => (Id: Str(t, "id"), Name: Str(t, "displayName"))).Where(t => t.Id is not null && t.Name is not null).Select(t => (Id: t.Id!, Name: t.Name!)).ToList();
                    if (list.Count > MaxChannelCalls)
                        result.Partial = true;
                    await Task.WhenAll(list.Take(MaxChannelCalls).Select(t => Guarded("channels", async c2 =>
                    {
                        var channels = Items(await ReadAsync($"{Base}/accounts/{account}/teams/{Uri.EscapeDataString(t.Id)}/channels", c2)).Select(x => (Id: Str(x, "id"), Name: Str(x, "displayName"))).Where(x => x.Id is not null && x.Name is not null).Select(x => (Id: x.Id!, Name: x.Name!)).ToList();
                        teamRows.Add((t.Id, t.Name, channels));
                    })));
                    foreach (var t in list.Skip(MaxChannelCalls))
                        teamRows.Add((t.Id, t.Name, []));
                }));
            if (notebooks)
                tasks.Add(Guarded("notebooks", async c =>
                {
                    var list = Items(await ReadAsync($"{Base}/accounts/{account}/onenote/notebooks?teams=true", c)).Select(n => (Id: Str(n, "id"), Name: Str(n, "displayName"))).Where(n => n.Id is not null && n.Name is not null).Select(n => (Id: n.Id!, Name: n.Name!)).ToList();
                    if (list.Count > MaxNotebookSectionCalls)
                        result.Partial = true;
                    await Task.WhenAll(list.Take(MaxNotebookSectionCalls).Select(n => Guarded("sections", async c2 =>
                    {
                        var tree = await ReadAsync($"{Base}/accounts/{account}/onenote/notebooks/{Uri.EscapeDataString(n.Id)}/sections", c2) ?? default;
                        var sections = new List<(string Id, string Name)>();
                        CollectSections(Prop(tree, "children"), sections, 0);
                        notebookRows.Add((n.Id, n.Name, sections));
                    })));
                    foreach (var n in list.Skip(MaxNotebookSectionCalls))
                        notebookRows.Add((n.Id, n.Name, []));
                }));
            try
            {
                await Task.WhenAll(tasks);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                failures.Add("microsoft: timed out");
            }
            ct.ThrowIfCancellationRequested();

            errors.AddRange(failures.Distinct());
            result.Teams.AddRange(teamRows.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase));
            result.Notebooks.AddRange(notebookRows.OrderBy(n => n.Name, StringComparer.OrdinalIgnoreCase));
            return result;
        }

        private static void CollectSections(JsonElement? nodes, List<(string Id, string Name)> into, int depth)
        {
            if (depth > 8)
                return;
            foreach (var node in Items(nodes))
            {
                if (Str(node, "id") is { } id && Str(node, "displayName") is { } name)
                    into.Add((id, name));
                if (Str(node, "kind") == "group")
                    CollectSections(Prop(node, "children"), into, depth + 1);
            }
        }

        private sealed record SubjectRow(Guid ClassId, string Name, Guid SchoolUserId, string? SchoolName);

        private sealed class MicrosoftNames
        {
            private static readonly string[] GeneralChannels = ["general", "allgemein"];

            public bool Partial { get; set; }
            public List<(string Id, string Name, List<(string Id, string Name)> Channels)> Teams { get; } = [];
            public List<(string Id, string Name, List<(string Id, string Name)> Sections)> Notebooks { get; } = [];

            public IEnumerable<object> MatchTeams(string subject) => Teams
                .SelectMany(t => new[] { (Team: t, Channel: ((string Id, string Name)?)null) }.Concat(t.Channels.Where(c => !GeneralChannels.Contains(SubjectAliases.Normalize(c.Name))).Select(c => (Team: t, Channel: ((string Id, string Name)?)c))))
                .Select(x => (x.Team, x.Channel, Match: SubjectAliases.Match(subject, x.Channel?.Name ?? x.Team.Name)))
                .Where(x => x.Match != SubjectMatch.None)
                .OrderByDescending(x => x.Match)
                .Select(x => (object)new { teamId = x.Team.Id, team = x.Team.Name, channelId = x.Channel?.Id, channel = x.Channel?.Name, confidence = Confidence(x.Match) });

            public IEnumerable<object> MatchNotebooks(string subject) => Notebooks
                .SelectMany(n => new[] { (Notebook: n, Section: ((string Id, string Name)?)null) }.Concat(n.Sections.Select(s => (Notebook: n, Section: ((string Id, string Name)?)s))))
                .Select(x => (x.Notebook, x.Section, Match: SubjectAliases.Match(subject, x.Section?.Name ?? x.Notebook.Name)))
                .Where(x => x.Match != SubjectMatch.None)
                .OrderByDescending(x => x.Match)
                .Select(x => (object)new { notebookId = x.Notebook.Id, notebook = x.Notebook.Name, sectionId = x.Section?.Id, section = x.Section?.Name, confidence = Confidence(x.Match) });

            private static string Confidence(SubjectMatch match) => match switch { SubjectMatch.Exact => "exact", SubjectMatch.Alias => "alias", _ => "fuzzy" };
        }
    }
}
