using Microsoft.EntityFrameworkCore;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Plugin.Abstractions;

namespace Schuly.Infrastructure.Plugins
{
    /// <summary>
    /// One plugin's <see cref="ISchoolData"/>. Every row it writes carries <see cref="Source"/>,
    /// and it only writes to students that same plugin provisioned.
    /// </summary>
    public sealed class PluginSchoolData(SchulyDbContext db, string source) : ISchoolData
    {
        public string Source { get; } = source;

        public async Task<Guid> EnsureSchoolAsync(SchoolRecord school, CancellationToken cancellationToken = default)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(school.Name);
            var website = string.IsNullOrWhiteSpace(school.Website) ? null : school.Website;
            var existing = website is not null
                ? await db.Schools.FirstOrDefaultAsync(s => s.Website == website, cancellationToken)
                : await db.Schools.FirstOrDefaultAsync(s => s.Website == null && s.Name == school.Name, cancellationToken);

            if (existing is null)
            {
                existing = new School { Name = Clip(school.Name, 200)!, Website = website, LogoUrl = school.LogoUrl };
                db.Schools.Add(existing);
            }
            else if (string.IsNullOrWhiteSpace(existing.LogoUrl) && school.LogoUrl is not null)
            {
                existing.LogoUrl = school.LogoUrl;
            }

            await db.SaveChangesAsync(cancellationToken);
            return existing.Id;
        }

        public async Task<Guid> EnsureStudentAsync(Guid schoolId, Guid applicationUserId, StudentRecord student, CancellationToken cancellationToken = default)
        {
            var user = await db.SchoolUsers.FirstOrDefaultAsync(su => su.ApplicationUserId == applicationUserId && su.SchoolId == schoolId, cancellationToken);
            if (user is null)
            {
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                user = new SchoolUser
                {
                    Source = Source,
                    ApplicationUserId = applicationUserId,
                    SchoolId = schoolId,
                    FirstName = "",
                    LastName = "",
                    Email = "",
                    EntryDate = student.EntryDate ?? today,
                    Role = Roles.Student,
                    State = UserState.Active,
                };
                db.SchoolUsers.Add(user);
            }
            else if (user.Source is null)
            {
                user.Source = Source;
            }
            else if (user.Source != Source)
            {
                throw new UnauthorizedAccessException($"Student {user.Id} is managed by {user.Source}, not {Source}.");
            }

            FillBlanks(user, student);
            await db.SaveChangesAsync(cancellationToken);
            return user.Id;
        }

        public async Task<SyncResult> SyncAgendaAsync(Guid schoolUserId, IReadOnlyCollection<AgendaRecord> entries, CancellationToken cancellationToken = default)
        {
            await OwnedStudentAsync(schoolUserId, cancellationToken);
            var existing = await ExistingAsync(db.AgendaEntries.Where(a => a.SchoolUserId == schoolUserId), cancellationToken);
            var (added, updated) = (0, 0);

            foreach (var record in Latest(entries, e => e.ExternalId))
            {
                var start = record.Start.UtcDateTime;
                DateTime? end = record.End?.UtcDateTime is { } e && e >= start ? e : null;
                if (!existing.TryGetValue(record.ExternalId, out var row))
                {
                    row = new AgendaEntry { Source = Source, ExternalId = record.ExternalId, SchoolUserId = schoolUserId, EntryType = AgendaEntryType.Event, Title = "", Date = start };
                    db.AgendaEntries.Add(row);
                    added++;
                }

                row.EntryType = (AgendaEntryType)record.Kind;
                row.Title = Clip(record.Title, 200) ?? "";
                row.Description = record.Description;
                row.Place = record.Place;
                row.Date = start;
                row.EndDate = end;
                if (IsModified(row)) updated++;
            }

            await db.SaveChangesAsync(cancellationToken);
            return new SyncResult(added, updated);
        }

        public async Task<SyncResult> SyncGradesAsync(Guid schoolUserId, IReadOnlyCollection<GradeRecord> grades, CancellationToken cancellationToken = default)
        {
            var student = await OwnedStudentAsync(schoolUserId, cancellationToken, withClasses: true);
            var existing = await ExistingAsync(db.Grades.Where(g => g.SchoolUserId == schoolUserId), cancellationToken);
            var classes = await db.Classes.Where(c => c.SchoolId == student.SchoolId).ToDictionaryAsync(c => c.Name, StringComparer.Ordinal, cancellationToken);
            var classIds = classes.Values.Select(c => c.Id).ToList();
            var exams = (await db.Exams.Where(e => classIds.Contains(e.ClassId)).ToListAsync(cancellationToken))
                .ToDictionary(e => (e.ClassId, e.Name));
            var newExams = new Dictionary<(Class, string), Exam>();
            var (added, updated) = (0, 0);

            foreach (var record in Latest(grades, g => g.ExternalId))
            {
                var subject = Clip(string.IsNullOrWhiteSpace(record.Subject) ? "Default" : record.Subject, 100)!;
                if (!classes.TryGetValue(subject, out var cls))
                {
                    cls = new Class { Source = Source, Name = subject, SchoolId = student.SchoolId };
                    db.Classes.Add(cls);
                    classes[subject] = cls;
                }
                if (!student.Classes.Contains(cls))
                    student.Classes.Add(cls);

                var examName = Clip(string.IsNullOrWhiteSpace(record.ExamName) ? subject : record.ExamName, 200)!;
                if (!exams.TryGetValue((cls.Id, examName), out var exam) && !newExams.TryGetValue((cls, examName), out exam))
                {
                    exam = new Exam { Source = Source, Name = examName, Type = ExamType.Classic, Date = record.ExamDate, Class = cls };
                    db.Exams.Add(exam);
                    newExams[(cls, examName)] = exam;
                }
                exam.Date ??= record.ExamDate;
                if (record.ClassAverage is { } classAverage)
                    exam.ReportedClassAverage = classAverage;

                if (!existing.TryGetValue(record.ExternalId, out var row))
                {
                    row = new Grade { Source = Source, ExternalId = record.ExternalId, SchoolUserId = schoolUserId, Exam = exam, Score = record.Score, Weighting = record.Weight };
                    db.Grades.Add(row);
                    added++;
                    continue;
                }

                row.Exam = exam;
                row.Score = record.Score;
                row.Weighting = record.Weight;
                if (IsModified(row)) updated++;
            }

            await db.SaveChangesAsync(cancellationToken);
            return new SyncResult(added, updated);
        }

        public async Task<SyncResult> SyncExamsAsync(Guid schoolUserId, IReadOnlyCollection<ExamRecord> exams, CancellationToken cancellationToken = default)
        {
            var student = await OwnedStudentAsync(schoolUserId, cancellationToken, withClasses: true);
            var classes = await db.Classes.Where(c => c.SchoolId == student.SchoolId).ToDictionaryAsync(c => c.Name, StringComparer.Ordinal, cancellationToken);
            var classIds = classes.Values.Select(c => c.Id).ToList();
            var existing = (await db.Exams.Where(e => classIds.Contains(e.ClassId)).ToListAsync(cancellationToken))
                .ToDictionary(e => (e.ClassId, e.Name));
            var added = new Dictionary<(Class, string), Exam>();
            var updated = 0;

            foreach (var record in exams)
            {
                var subject = Clip(string.IsNullOrWhiteSpace(record.Subject) ? "Default" : record.Subject, 100)!;
                if (!classes.TryGetValue(subject, out var cls))
                {
                    cls = new Class { Source = Source, Name = subject, SchoolId = student.SchoolId };
                    db.Classes.Add(cls);
                    classes[subject] = cls;
                }
                if (!student.Classes.Contains(cls))
                    student.Classes.Add(cls);

                var name = Clip(string.IsNullOrWhiteSpace(record.Name) ? subject : record.Name, 200)!;
                var isNew = !existing.TryGetValue((cls.Id, name), out var exam) && !added.TryGetValue((cls, name), out exam);
                if (isNew)
                {
                    exam = new Exam { Source = Source, Name = name, Type = ExamType.Classic, Date = record.Date, Class = cls };
                    db.Exams.Add(exam);
                    added[(cls, name)] = exam;
                }

                exam!.Date = record.Date;
                if (record.Description is { } description)
                    exam.Description = Clip(description, 1000);
                if (record.ClassAverage is { } classAverage)
                    exam.ReportedClassAverage = classAverage;
                if (!isNew && IsModified(exam)) updated++;
            }

            await db.SaveChangesAsync(cancellationToken);
            return new SyncResult(added.Count, updated);
        }

        public async Task<SyncResult> SyncAbsencesAsync(Guid schoolUserId, IReadOnlyCollection<AbsenceRecord> absences, CancellationToken cancellationToken = default)
        {
            await OwnedStudentAsync(schoolUserId, cancellationToken);
            var existing = await ExistingAsync(db.Absences.Where(a => a.SchoolUserId == schoolUserId), cancellationToken);
            var (added, updated) = (0, 0);
            var current = new List<Absence>();

            foreach (var record in Latest(absences, a => a.ExternalId))
            {
                var from = record.From.UtcDateTime;
                var until = record.Until.UtcDateTime < from ? from : record.Until.UtcDateTime;
                if (!existing.TryGetValue(record.ExternalId, out var row))
                {
                    row = new Absence { Source = Source, ExternalId = record.ExternalId, SchoolUserId = schoolUserId, Reason = "", Type = AbsenceType.Absence, From = from, Until = until };
                    db.Absences.Add(row);
                    added++;
                }

                row.Reason = Clip(string.IsNullOrWhiteSpace(record.Reason) ? "Absent" : record.Reason, 500)!;
                row.Type = record.IsLate ? AbsenceType.Delay : AbsenceType.Absence;
                row.IsExcused = record.IsExcused ?? row.IsExcused;
                row.StartTime = Clip(record.StartTime, 5) ?? row.StartTime;
                row.EndTime = Clip(record.EndTime, 5) ?? row.EndTime;
                row.ParentStatus = Clip(record.ParentStatus, 100) ?? row.ParentStatus;
                row.ParentStatusDate = record.ParentStatusDate ?? row.ParentStatusDate;
                row.TrainerStatus = Clip(record.TrainerStatus, 100) ?? row.TrainerStatus;
                row.TrainerStatusDate = record.TrainerStatusDate ?? row.TrainerStatusDate;
                row.TrainerComment = Clip(record.TrainerComment, Absence.MaxReasonLength) ?? row.TrainerComment;
                row.Comment = Clip(record.Comment, Absence.MaxReasonLength) ?? row.Comment;
                row.ExcuseDeadline = record.ExcuseDeadline ?? row.ExcuseDeadline;
                row.Lessons = record.Lessons ?? row.Lessons;
                row.From = from;
                row.Until = until;
                if (IsModified(row)) updated++;
                current.Add(row);
            }

            RemoveSuperseded(existing.Values, current);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncResult(added, updated);
        }

        public async Task<SyncResult> SyncDocumentsAsync(Guid schoolUserId, IReadOnlyCollection<DocumentRecord> documents, CancellationToken cancellationToken = default)
        {
            await OwnedStudentAsync(schoolUserId, cancellationToken);
            var existing = await ExistingAsync(db.StudentDocuments.Where(d => d.SchoolUserId == schoolUserId), cancellationToken);
            var (added, updated) = (0, 0);

            foreach (var record in Latest(documents, d => d.ExternalId))
            {
                if (!existing.TryGetValue(record.ExternalId, out var row))
                {
                    row = new StudentDocument { Source = Source, ExternalId = record.ExternalId, SchoolUserId = schoolUserId, Title = "" };
                    db.StudentDocuments.Add(row);
                    added++;
                }

                row.Title = Clip(record.Title, 300) ?? "";
                row.FileName = Clip(record.FileName, 300);
                row.Category = Clip(record.Category, 100);
                row.Comment = Clip(record.Comment, 2000);
                row.EnteredBy = Clip(record.EnteredBy, 200);
                if (record.File is { } file)
                {
                    row.FileUrl = file.Key;
                    row.FileSizeBytes = file.SizeBytes;
                }
                if (IsModified(row)) updated++;
            }

            await db.SaveChangesAsync(cancellationToken);
            return new SyncResult(added, updated);
        }

        public async Task<SyncResult> SyncSemesterReportsAsync(Guid schoolUserId, IReadOnlyCollection<SemesterReportRecord> reports, CancellationToken cancellationToken = default)
        {
            await OwnedStudentAsync(schoolUserId, cancellationToken);
            var existing = await db.SemesterReports
                .Include(r => r.Subjects)
                .Where(r => r.SchoolUserId == schoolUserId)
                .ToListAsync(cancellationToken);
            var byKey = existing.ToDictionary(r => (r.ProgramCode, r.SchoolYearStart, r.SemesterHalf));
            var (added, updated) = (0, 0);

            foreach (var record in reports.GroupBy(r => (Clip(r.ProgramCode, 50)!, r.SchoolYearStart, r.SemesterHalf)).Select(g => g.Last()))
            {
                if (record.SemesterHalf is not (1 or 2))
                    throw new ArgumentException($"SemesterHalf must be 1 or 2, got {record.SemesterHalf}.", nameof(reports));
                var key = (Clip(record.ProgramCode, 50)!, record.SchoolYearStart, record.SemesterHalf);
                if (byKey.TryGetValue(key, out var report) && report.Source is not null && report.Source != Source)
                    continue;

                var isNew = report is null;
                if (report is null)
                {
                    report = new SemesterReport { Source = Source, SchoolUserId = schoolUserId, ProgramCode = key.Item1, SchoolYearStart = record.SchoolYearStart, SemesterHalf = record.SemesterHalf, ClassName = "" };
                    db.SemesterReports.Add(report);
                    byKey[key] = report;
                }
                else if (report.Source is null)
                {
                    continue;
                }

                report.ClassName = Clip(record.ClassName, 100) ?? "";
                report.PromotionDecision = Clip(record.PromotionDecision, 100);
                report.GradeAverage = record.GradeAverage;
                report.ExcusedAbsences = record.ExcusedAbsences;
                report.UnexcusedAbsences = record.UnexcusedAbsences;
                report.TotalAbsences = record.ExcusedAbsences is null && record.UnexcusedAbsences is null ? null : (record.ExcusedAbsences ?? 0) + (record.UnexcusedAbsences ?? 0);
                var subjectsChanged = ReplaceSubjects(report, record.Subjects);

                if (isNew) added++;
                else if (subjectsChanged || IsModified(report)) updated++;
            }

            await db.SaveChangesAsync(cancellationToken);
            return new SyncResult(added, updated);
        }

        private bool ReplaceSubjects(SemesterReport report, IReadOnlyList<SemesterSubjectRecord> subjects)
        {
            var wanted = subjects
                .GroupBy(s => Clip(s.SubjectCode, 50)!)
                .Select(g => g.Last())
                .Select(s => (Code: Clip(s.SubjectCode, 50)!, Name: Clip(s.SubjectName, 200)!, s.Grade, Marker: Clip(s.Marker, 20), Type: Clip(s.SubjectTypeMarker, 10)))
                .OrderBy(s => s.Code, StringComparer.Ordinal)
                .ToList();
            var current = report.Subjects
                .Select(s => (Code: s.SubjectCode, Name: s.SubjectName, s.Grade, s.Marker, Type: s.SubjectTypeMarker))
                .OrderBy(s => s.Code, StringComparer.Ordinal)
                .ToList();
            if (wanted.SequenceEqual(current))
                return false;

            foreach (var subject in report.Subjects.ToList())
                db.SemesterSubjectGrades.Remove(subject);
            report.Subjects.Clear();
            foreach (var s in wanted)
                report.Subjects.Add(new SemesterSubjectGrade { SubjectCode = s.Code, SubjectName = s.Name, Grade = s.Grade, Marker = s.Marker, SubjectTypeMarker = s.Type });
            return true;
        }

        public async Task<IReadOnlySet<string>> GetDocumentIdsAsync(Guid schoolUserId, CancellationToken cancellationToken = default)
        {
            await OwnedStudentAsync(schoolUserId, cancellationToken);
            var ids = await db.StudentDocuments
                .Where(d => d.SchoolUserId == schoolUserId && d.Source == Source && d.ExternalId != null)
                .Select(d => d.ExternalId!)
                .ToListAsync(cancellationToken);
            return ids.ToHashSet(StringComparer.Ordinal);
        }

        private async Task<SchoolUser> OwnedStudentAsync(Guid schoolUserId, CancellationToken cancellationToken, bool withClasses = false)
        {
            IQueryable<SchoolUser> query = withClasses ? db.SchoolUsers.Include(su => su.Classes) : db.SchoolUsers;
            var student = await query.FirstOrDefaultAsync(su => su.Id == schoolUserId, cancellationToken)
                ?? throw new InvalidOperationException($"Student {schoolUserId} does not exist.");
            if (student.Source is null)
                student.Source = Source;
            else if (student.Source != Source)
                throw new UnauthorizedAccessException($"Student {schoolUserId} is managed by {student.Source}, not {Source}.");
            return student;
        }

        /// <summary>A row that says the same as one the school just sent, under an id it no longer uses. It would never be updated again, so it could only ever show an old state.</summary>
        private void RemoveSuperseded(IEnumerable<Absence> existing, List<Absence> current)
        {
            var kept = current.ToHashSet();
            var said = current.Select(a => (a.Type, a.From, a.Until, a.Reason)).ToHashSet();
            db.Absences.RemoveRange(existing.Where(a => !kept.Contains(a) && said.Contains((a.Type, a.From, a.Until, a.Reason))));
        }

        private async Task<Dictionary<string, T>> ExistingAsync<T>(IQueryable<T> query, CancellationToken cancellationToken) where T : class, ISyncedEntity
        {
            var rows = await query.Where(e => e.Source == Source && e.ExternalId != null).ToListAsync(cancellationToken);
            return rows.ToDictionary(e => e.ExternalId!, StringComparer.Ordinal);
        }

        private static IEnumerable<T> Latest<T>(IEnumerable<T> records, Func<T, string> externalId)
        {
            var latest = new Dictionary<string, T>(StringComparer.Ordinal);
            foreach (var record in records)
            {
                var id = externalId(record);
                ArgumentException.ThrowIfNullOrWhiteSpace(id, nameof(externalId));
                if (id.Length > SchulyDbContext.ExternalIdMaxLength)
                    throw new ArgumentException($"ExternalId is longer than {SchulyDbContext.ExternalIdMaxLength} characters: {id[..40]}...", nameof(externalId));
                latest[id] = record;
            }
            return latest.Values;
        }

        private bool IsModified(object row)
        {
            var entry = db.Entry(row);
            return entry.State == EntityState.Modified || (entry.State == EntityState.Unchanged && entry.Properties.Any(p => p.IsModified));
        }

        private static string? Clip(string? value, int max) => value is null || value.Length <= max ? value : value[..max];

        private static void FillBlanks(SchoolUser user, StudentRecord student)
        {
            if (string.IsNullOrWhiteSpace(user.FirstName) && student.FirstName is not null) user.FirstName = Clip(student.FirstName, 100)!;
            if (string.IsNullOrWhiteSpace(user.LastName) && student.LastName is not null) user.LastName = Clip(student.LastName, 100)!;
            if (string.IsNullOrWhiteSpace(user.Email) && student.Email is not null) user.Email = Clip(student.Email, 255)!;
            user.LeaveDate ??= student.LeaveDate;
            if (student.ProfilePictureUrl is not null) user.ProfilePictureUrl = student.ProfilePictureUrl;
        }
    }
}
