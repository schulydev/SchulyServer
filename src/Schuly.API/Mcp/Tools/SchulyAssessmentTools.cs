using System.ComponentModel;
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
    /// <summary>Assessments in one list: the exams the school entered, plus the agenda entries that announce a test, presentation or hand-in, without the same test twice.</summary>
    public sealed partial class SchulyTools
    {
        private const int DefaultAssessmentDays = 30;

        [McpServerTool(Name = "list_assessments", Title = "List assessments", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists the user's assessments (tests, exams, presentations, hand-ins, oral exams) in a date range in ONE list, newest dates last: the exams from list_exams merged with agenda entries that look like assessments (words such as Test, Prüfung, LK, Lernkontrolle, Vortrag, Präsentation, Abgabe, Projekt, mündlich, examen, épreuve, contrôle, verifica, esame, presentation, hand-in in German, French, Italian and English). Each item has date, time if known, subject, title, kind (exam, presentation, hand-in, other), source (exams or agenda) and the teacher if known. The same test in exams and agenda is listed once. Default range: today to 30 days ahead. subject accepts any name of the subject in any language (Mathe, Mathematik, maths). It does NOT read schedule documents such as Masterplan, Semesterplan or Prüfungsplan, and teachers often enter tests late, so an empty list does not mean there is none: for those documents use search and read_file.")]
        [McpAccess(McpArea.Exams, McpAccessLevel.Read)]
        public async Task<string> ListAssessments([Description("First day, yyyy-MM-dd. Default today.")] DateOnly? from = null, [Description("Last day, yyyy-MM-dd. Default 30 days after from.")] DateOnly? to = null, [Description("Only this subject, by any of its names or abbreviations.")] string? subject = null, [Description("Items to skip, for paging.")] int offset = 0, [Description("Items per page, 1-200.")] int limit = 100, CancellationToken ct = default)
        {
            var start = from ?? SwissTime.Today();
            var end = to ?? start.AddDays(DefaultAssessmentDays);
            if (end < start)
                throw new McpException("to must not be before from.");

            var permissions = Caller(accessor).Permissions;
            var schoolUsers = Unwrap(await mediator.Send(new GetSchoolUsersQuery(), ct));
            var classNames = schoolUsers.SelectMany(s => s.Classes).GroupBy(c => c.ClassId).ToDictionary(g => g.Key, g => g.First().ClassName);
            var exams = Unwrap(await mediator.Send(new GetExamsQuery(), ct));
            var searched = new List<string> { "exams" };
            var skipped = new List<object>();
            List<AgendaEntryDto> agenda = [];
            if (permissions.Allows(McpArea.Calendar, McpAccessLevel.Read))
            {
                searched.Add("agenda");
                agenda = Unwrap(await mediator.Send(new GetAgendasQuery(), ct));
            }
            else
                skipped.Add(new { source = "agenda", reason = "needs Calendar read" });

            var items = Assessments(exams, agenda, classNames, start, end, subject);
            return Serialize(new
            {
                from = start,
                to = end,
                subject = string.IsNullOrWhiteSpace(subject) ? null : subject.Trim(),
                searched,
                skipped = skipped.Count == 0 ? null : skipped,
                note = "Only exams and agenda entries are read, not schedule documents (Masterplan, Semesterplan, Prüfungsplan). If something is missing, search for those with search and read them with read_file.",
                assessments = Page(items.Select(i => new { date = i.Date, time = i.Time?.ToString("HH:mm"), subject = i.Subject, title = i.Title, kind = i.Kind, source = i.Source, teachers = i.Teachers.Count == 0 ? null : i.Teachers, alsoInAgenda = i.AlsoInAgenda ? true : (bool?)null, examId = i.ExamId, agendaEntryId = i.AgendaEntryId }), offset, limit, "assessments"),
            });
        }

        /// <summary>The merged, de-duplicated assessments in the range, ordered by date and time. Public so the rules can be tested without a server.</summary>
        public static List<AssessmentItem> Assessments(IReadOnlyList<ExamDto> exams, IReadOnlyList<AgendaEntryDto> agenda, IReadOnlyDictionary<Guid, string> classNames, DateOnly from, DateOnly to, string? subject)
        {
            string? ClassName(Guid? classId) => classId is { } id ? classNames.GetValueOrDefault(id) : null;
            string Key(string? name) => string.IsNullOrWhiteSpace(name) ? string.Empty : SubjectAliases.Resolve(name)?.Key ?? SubjectAliases.Clean(name);

            var lessons = agenda.Where(a => a.EntryType == AgendaEntryType.Lesson && AssessmentKinds.Classify(null, a.Description) is null).ToList();
            var teachersByClass = lessons.Where(a => a.ClassId is not null).GroupBy(a => a.ClassId!.Value).ToDictionary(g => g.Key, g => SubjectTeachers.FromLessons(g.Select(a => a.Description)));
            var teachersByKey = lessons.GroupBy(a => Key(ClassName(a.ClassId) ?? a.Title)).Where(g => g.Key.Length > 0).ToDictionary(g => g.Key, g => SubjectTeachers.FromLessons(g.Select(a => a.Description)));
            List<string> TeachersOf(Guid? classId, string? name) => classId is { } id && teachersByClass.TryGetValue(id, out var byClass) && byClass.Count > 0 ? byClass : teachersByKey.GetValueOrDefault(Key(name)) ?? [];

            bool Wanted(string? name, string? title)
            {
                if (string.IsNullOrWhiteSpace(subject))
                    return true;
                if (name is not null)
                    return SubjectAliases.Match(subject, name) != SubjectMatch.None;
                return SubjectAliases.Resolve(subject) is { } wanted && SubjectAliases.Resolve(title)?.Key == wanted.Key;
            }

            var items = new List<AssessmentItem>();
            foreach (var exam in exams.Where(e => e.Date is { } d && d >= from && d <= to))
            {
                var name = ClassName(exam.ClassId);
                if (!Wanted(name, exam.Name))
                    continue;
                items.Add(new AssessmentItem(exam.Date!.Value, null, name, exam.Name, AssessmentKinds.Classify(exam.Name, exam.Description) ?? AssessmentKinds.Exam, "exams", TeachersOf(exam.ClassId, name), exam.Id, null) { Key = Key(name) });
            }

            var seen = new HashSet<(string Key, DateOnly Date, string Title)>();
            foreach (var entry in agenda.Where(a => a.EntryType != AgendaEntryType.Holiday).OrderBy(a => a.Date))
            {
                var day = DateOnly.FromDateTime(entry.Date);
                if (day < from || day > to)
                    continue;
                var kind = AssessmentKinds.Classify(entry.Title, entry.Description) ?? (entry.EntryType == AgendaEntryType.Test ? AssessmentKinds.Other : null);
                if (kind is null)
                    continue;
                var name = ClassName(entry.ClassId) ?? SubjectAliases.Resolve(entry.Title)?.Name;
                if (!Wanted(name, entry.Title))
                    continue;
                var key = Key(name);
                TimeOnly? time = entry.Date.TimeOfDay == TimeSpan.Zero ? null : TimeOnly.FromTimeSpan(entry.Date.TimeOfDay);

                var title = AssessmentKinds.Classify(entry.Title, null) is null && AssessmentKinds.Classify(null, entry.Description) is not null ? $"{entry.Title}: {Cap(entry.Description!.Trim(), 120)}" : entry.Title;
                var twin = items.FirstOrDefault(i => i.Source == "exams" && i.Date == day && (key.Length > 0 ? i.Key == key : SubjectAliases.Normalize(entry.Title + " " + entry.Description).Contains(SubjectAliases.Normalize(i.Title))));
                if (twin is not null)
                {
                    twin.AlsoInAgenda = true;
                    twin.Time ??= time;
                    continue;
                }
                if (!seen.Add((key.Length > 0 ? key : SubjectAliases.Clean(entry.Title), day, SubjectAliases.Normalize(title))))
                    continue;
                items.Add(new AssessmentItem(day, time, name, title, kind, "agenda", TeachersOf(entry.ClassId, name), null, entry.Id) { Key = key });
            }
            return items.OrderBy(i => i.Date).ThenBy(i => i.Time ?? TimeOnly.MinValue).ThenBy(i => i.Subject, StringComparer.OrdinalIgnoreCase).ToList();
        }
    }

    public sealed class AssessmentItem(DateOnly date, TimeOnly? time, string? subject, string title, string kind, string source, List<string> teachers, Guid? examId, Guid? agendaEntryId)
    {
        public DateOnly Date { get; } = date;
        public TimeOnly? Time { get; set; } = time;
        public string? Subject { get; } = subject;
        public string Title { get; } = title;
        public string Kind { get; } = kind;
        public string Source { get; } = source;
        public List<string> Teachers { get; } = teachers;
        public Guid? ExamId { get; } = examId;
        public Guid? AgendaEntryId { get; } = agendaEntryId;
        public string Key { get; init; } = string.Empty;
        public bool AlsoInAgenda { get; set; }
    }
}
