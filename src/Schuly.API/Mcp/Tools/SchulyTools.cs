using System.ComponentModel;
using Mediator;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using Schuly.Application.Dtos;
using Schuly.Application.Queries.Absence;
using Schuly.Application.Queries.Agenda;
using Schuly.Application.Queries.Exam;
using Schuly.Application.Queries.LinkedAccount;
using Schuly.Application.Queries.SchoolUser;
using Schuly.Application.Queries.SemesterReport;
using Schuly.Application.Queries.StudentDocument;
using Schuly.Application.Queries.User;
using Schuly.Domain.Mcp;
using Schuly.Plugin.Abstractions;
using static Schuly.API.Mcp.Tools.McpToolSupport;

namespace Schuly.API.Mcp.Tools
{
    /// <summary>The user's own school data, read through the same Mediator queries as the REST API and so under the same checks.</summary>
    [McpServerToolType]
    public sealed partial class SchulyTools(IMediator mediator, IHttpContextAccessor accessor, InProcessPluginApi plugins)
    {
        private const int MaxDocumentBytes = 2 * 1024 * 1024;
        private const int MaxBase64Bytes = 256 * 1024;

        [McpServerTool(Name = "get_profile", Title = "Get my profile", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Returns the signed-in Schuly user: name, email and the school profiles (school user ids) their grades, absences and documents belong to. Call this first when you need a school_user_id.")]
        [McpAccess(McpArea.SchoolAccounts, McpAccessLevel.Read)]
        public async Task<string> GetProfile(CancellationToken ct)
        {
            var me = Unwrap(await mediator.Send(new GetCurrentUserQuery(), ct));
            var schoolUsers = Unwrap(await mediator.Send(new GetSchoolUsersQuery(), ct));
            return Serialize(new
            {
                me.DisplayName,
                me.Email,
                schoolProfiles = schoolUsers.Select(s => new { schoolUserId = s.Id, s.SchoolName, name = $"{s.FirstName} {s.LastName}", role = s.Role, state = s.State, classes = s.Classes.Select(c => c.ClassName) }),
            });
        }

        [McpServerTool(Name = "list_school_accounts", Title = "List school accounts", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists the accounts the user connected to Schuly: school profiles, linked Microsoft 365 accounts (account_id for the mail, Teams, Drive and OneNote tools) and Schulnetz (Schulware) accounts (account_id for the absence report tools).")]
        [McpAccess(McpArea.SchoolAccounts, McpAccessLevel.Read)]
        public async Task<string> ListSchoolAccounts(CancellationToken ct)
        {
            var caller = Caller(accessor);
            var schoolUsers = Unwrap(await mediator.Send(new GetSchoolUsersQuery(), ct));
            var linked = Unwrap(await mediator.Send(new GetMyLinkedAccountsQuery(null), ct));
            var schulware = await plugins.GetAsync("/api/plugins/schulware/accounts", ct);
            var odaorg = await plugins.GetAsync("/api/plugins/odaorg/accounts", ct);

            return Serialize(new
            {
                schoolProfiles = schoolUsers.Select(s => new { schoolUserId = s.Id, s.SchoolName, name = $"{s.FirstName} {s.LastName}", role = s.Role }),
                linkedAccounts = linked
                    .Where(a => a.Provider != LinkedProviders.Microsoft || caller.Permissions.AllowsMicrosoftAccount(a.Id))
                    .Select(a => new { accountId = a.Id, a.Provider, a.Email, a.DisplayName }),
                schulnetzAccounts = schulware.IsSuccess ? Items(schulware.Json()).Select(a => new { accountId = Str(a, "id"), displayName = Str(a, "displayName"), schulnetzUrl = Str(a, "schulnetzBaseUrl"), schoolUserId = Str(a, "schoolUserId") }).ToList() : null,
                odaorgAccounts = odaorg.IsSuccess ? Items(odaorg.Json()).Select(a => Clean(a)).ToList() : null,
            });
        }

        [McpServerTool(Name = "list_grades", Title = "List grades", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists the user's grades with subject, exam, date, score and weight, plus the weighted average per subject. Swiss scale: 6 is best, 4 is the pass mark.")]
        [McpAccess(McpArea.Grades, McpAccessLevel.Read)]
        public async Task<string> ListGrades([Description("Only grades whose subject contains this text (case-insensitive).")] string? subject = null, [Description("Only grades of this school profile (see get_profile).")] Guid? schoolUserId = null, [Description("Items to skip, for paging.")] int offset = 0, [Description("Items per page, 1-200.")] int limit = 100, CancellationToken ct = default)
        {
            var schoolUsers = Unwrap(await mediator.Send(new GetSchoolUsersQuery(), ct));
            var mine = schoolUsers.Select(s => s.Id).Where(id => schoolUserId is null || id == schoolUserId).ToHashSet();
            var classNames = schoolUsers.SelectMany(s => s.Classes).GroupBy(c => c.ClassId).ToDictionary(g => g.Key, g => g.First().ClassName);
            var exams = Unwrap(await mediator.Send(new GetExamsQuery(), ct));

            var grades = exams
                .SelectMany(e => e.Grades.Where(g => mine.Contains(g.SchoolUserId)).Select(g => new { exam = e, grade = g }))
                .Select(x => new { subject = classNames.GetValueOrDefault(x.exam.ClassId, "Unknown subject"), examName = x.exam.Name, date = x.exam.Date, score = x.grade.Score, weight = x.grade.Weighting, classAverage = x.exam.ClassAverage > 0 ? x.exam.ClassAverage : (decimal?)null, examId = x.exam.Id })
                .Where(g => subject is null || g.subject.Contains(subject, StringComparison.OrdinalIgnoreCase))
                .OrderBy(g => g.subject).ThenByDescending(g => g.date)
                .ToList();

            var averages = grades
                .GroupBy(g => g.subject)
                .Select(g => new { subject = g.Key, average = g.Sum(x => x.weight) > 0 ? Math.Round(g.Sum(x => x.score * x.weight) / g.Sum(x => x.weight), 2) : (decimal?)null, count = g.Count() })
                .ToList();

            return Serialize(new { subjectAverages = averages, grades = Page(grades, offset, limit, "grades") });
        }

        [McpServerTool(Name = "list_semester_reports", Title = "List semester reports", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists the user's semester reports (Zeugnisse): per semester the class, promotion decision, grade average, absences and the grade of every subject.")]
        [McpAccess(McpArea.Grades, McpAccessLevel.Read)]
        public async Task<string> ListSemesterReports([Description("Only reports of this school profile.")] Guid? schoolUserId = null, CancellationToken ct = default)
        {
            var reports = Unwrap(await mediator.Send(new GetSemesterReportsQuery(), ct));
            return Serialize(reports
                .Where(r => schoolUserId is null || r.SchoolUserId == schoolUserId)
                .OrderByDescending(r => r.SchoolYearStart).ThenByDescending(r => r.SemesterHalf)
                .Select(r => new { semester = $"{r.SchoolYearStart}/{r.SchoolYearStart + 1} semester {r.SemesterHalf}", r.ClassName, r.PromotionDecision, r.GradeAverage, r.InsufficientGradeCount, r.DeficiencyPoints, r.ExcusedAbsences, r.UnexcusedAbsences, subjects = r.Subjects.Select(s => new { s.SubjectName, s.Grade, s.Marker }) }));
        }

        [McpServerTool(Name = "list_exams", Title = "List exams", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists exams (tests) with subject, date, type and class average. Use from/to to look at upcoming or past exams.")]
        [McpAccess(McpArea.Exams, McpAccessLevel.Read)]
        public async Task<string> ListExams([Description("Earliest exam date, yyyy-MM-dd.")] DateOnly? from = null, [Description("Latest exam date, yyyy-MM-dd.")] DateOnly? to = null, int offset = 0, int limit = 100, CancellationToken ct = default)
        {
            var schoolUsers = Unwrap(await mediator.Send(new GetSchoolUsersQuery(), ct));
            var classNames = schoolUsers.SelectMany(s => s.Classes).GroupBy(c => c.ClassId).ToDictionary(g => g.Key, g => g.First().ClassName);
            var exams = Unwrap(await mediator.Send(new GetExamsQuery(), ct))
                .Where(e => (from is null || e.Date >= from) && (to is null || e.Date <= to))
                .OrderBy(e => e.Date)
                .Select(e => new { examId = e.Id, subject = classNames.GetValueOrDefault(e.ClassId), e.Name, e.Description, e.Type, e.Date, classAverage = e.ClassAverage > 0 ? e.ClassAverage : (decimal?)null });
            return Serialize(Page(exams, offset, limit, "exams"));
        }

        [McpServerTool(Name = "list_agenda", Title = "List agenda", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists the Schuly agenda (lessons, tests, events, holidays) between two dates. For Microsoft 365 calendar events use list_calendar_events.")]
        [McpAccess(McpArea.Calendar, McpAccessLevel.Read)]
        public async Task<string> ListAgenda([Description("Start of the window, yyyy-MM-dd. Defaults to today.")] DateOnly? from = null, [Description("End of the window, yyyy-MM-dd. Defaults to 14 days after from.")] DateOnly? to = null, int offset = 0, int limit = 100, CancellationToken ct = default)
        {
            var start = (from ?? DateOnly.FromDateTime(DateTime.UtcNow)).ToDateTime(TimeOnly.MinValue);
            var end = (to ?? DateOnly.FromDateTime(start).AddDays(14)).ToDateTime(TimeOnly.MaxValue);
            var entries = Unwrap(await mediator.Send(new GetAgendasQuery(), ct))
                .Where(a => a.Date <= end && (a.EndDate ?? a.Date) >= start)
                .OrderBy(a => a.Date)
                .Select(a => new { type = a.EntryType, a.Title, description = a.Description is null ? null : Cap(a.Description, 500), a.Place, start = a.Date, end = a.EndDate });
            return Serialize(Page(entries, offset, limit, "entries"));
        }

        [McpServerTool(Name = "list_absences", Title = "List absences", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists the user's recorded absences and delays with reason, time span and whether they are excused. To report a new absence to Schulnetz use report_absence.")]
        [McpAccess(McpArea.Absences, McpAccessLevel.Read)]
        public async Task<string> ListAbsences([Description("Earliest date, yyyy-MM-dd.")] DateOnly? from = null, [Description("Latest date, yyyy-MM-dd.")] DateOnly? to = null, int offset = 0, int limit = 100, CancellationToken ct = default)
        {
            var absences = Unwrap(await mediator.Send(new GetAbsencesQuery(), ct))
                .Where(a => (from is null || DateOnly.FromDateTime(a.Until) >= from) && (to is null || DateOnly.FromDateTime(a.From) <= to))
                .OrderByDescending(a => a.From)
                .Select(a => new { a.Type, a.Reason, a.From, a.Until, a.IsExcused });
            return Serialize(Page(absences, offset, limit, "absences"));
        }

        [McpServerTool(Name = "list_documents", Title = "List documents", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Lists the user's school documents (certificates, letters, reports) with title, category, file name and size. Read one with read_document.")]
        [McpAccess(McpArea.Documents, McpAccessLevel.Read)]
        public async Task<string> ListDocuments([Description("Only titles or categories containing this text.")] string? search = null, int offset = 0, int limit = 100, CancellationToken ct = default)
        {
            var documents = Unwrap(await mediator.Send(new GetStudentDocumentsQuery(), ct))
                .Where(d => search is null || d.Title.Contains(search, StringComparison.OrdinalIgnoreCase) || d.Category?.Contains(search, StringComparison.OrdinalIgnoreCase) == true)
                .OrderByDescending(d => d.CreatedAt)
                .Select(d => new { documentId = d.Id, d.Title, d.Category, d.Comment, d.FileName, d.FileSizeBytes, d.FollowUpAction, d.FollowUpDate, d.CreatedAt });
            return Serialize(Page(documents, offset, limit, "documents"));
        }

        [McpServerTool(Name = "read_document", Title = "Read document", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
        [Description("Returns a document's content: as text for text files (paged with offset/max_chars), as base64 for other files up to 256 KB, otherwise just its size. PDFs come back as base64 when small enough.")]
        [McpAccess(McpArea.Documents, McpAccessLevel.Read)]
        public async Task<string> ReadDocument([Description("The documentId from list_documents.")] Guid documentId, [Description("Character offset for text content.")] int offset = 0, [Description("Characters per page of text content.")] int maxChars = DefaultMaxChars, CancellationToken ct = default)
        {
            var download = Unwrap(await mediator.Send(new OpenStudentDocumentQuery(documentId), ct));
            await using var stream = download.Stream;
            if (stream.ContentLength > MaxDocumentBytes)
                return Serialize(new { fileName = download.FileName, sizeBytes = stream.ContentLength, note = "The document is too large to return here. Open it in Schuly instead." });

            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.Content.ReadAsync(chunk, ct)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > MaxDocumentBytes)
                    return Serialize(new { fileName = download.FileName, note = "The document is too large to return here. Open it in Schuly instead." });
            }
            return Serialize(FileContent(buffer.ToArray(), stream.ContentType, download.FileName, MaxBase64Bytes, offset, maxChars));
        }
    }
}
