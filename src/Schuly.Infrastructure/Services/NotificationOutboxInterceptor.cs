using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Schuly.Domain;
using Schuly.Domain.Enums;

namespace Schuly.Infrastructure.Services
{
    // Turns Grade / Absence / AgendaEntry writes into NotificationOutbox rows in the same
    // transaction, so a later drain service can send pushes without re-inspecting domain
    // writes. Only runs for non-user-initiated saves (plugin syncs) - see
    // NotificationOriginBehavior for why the app's own writes are excluded.
    public sealed class NotificationOutboxInterceptor(INotificationOriginContext origin, ILogger<NotificationOutboxInterceptor> logger) : SaveChangesInterceptor
    {
        private sealed record Candidate(NotificationType Type, Guid EntityId, Guid? SchoolUserId, Guid? ClassId, Guid? ExamId, Exam? Exam, string? Summary, DateTime? OccursAt);

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            if (origin.IsUserInitiated || eventData.Context is null)
                return base.SavingChanges(eventData, result);

            try
            {
                var context = eventData.Context;
                var candidates = Collect(context);

                if (candidates.Count > 0)
                {
                    var schoolUserMap = ResolveSchoolUsers(context, candidates);
                    var classMap = ResolveClasses(context, candidates);
                    var examMap = ResolveExamNames(context, candidates);

                    Enqueue(context, candidates, schoolUserMap, classMap, examMap);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to enqueue notification outbox rows");
            }

            return base.SavingChanges(eventData, result);
        }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (origin.IsUserInitiated || eventData.Context is null)
                return await base.SavingChangesAsync(eventData, result, cancellationToken);

            try
            {
                var context = eventData.Context;
                var candidates = Collect(context);

                if (candidates.Count > 0)
                {
                    var schoolUserMap = await ResolveSchoolUsersAsync(context, candidates, cancellationToken);
                    var classMap = await ResolveClassesAsync(context, candidates, cancellationToken);
                    var examMap = await ResolveExamNamesAsync(context, candidates, cancellationToken);

                    Enqueue(context, candidates, schoolUserMap, classMap, examMap);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to enqueue notification outbox rows");
            }

            return await base.SavingChangesAsync(eventData, result, cancellationToken);
        }

        // Pure change-tracker scan - no DB access, shared by both overrides.
        private static List<Candidate> Collect(DbContext context)
        {
            var candidates = new List<Candidate>();

            foreach (var entry in context.ChangeTracker.Entries<Grade>())
            {
                if (entry.State == EntityState.Added)
                    candidates.Add(new Candidate(NotificationType.GradeAdded, entry.Entity.Id, entry.Entity.SchoolUserId, null, entry.Entity.ExamId, entry.Entity.Exam, null, null));
                else if (entry.State == EntityState.Modified && (entry.Property(g => g.Score).IsModified || entry.Property(g => g.Weighting).IsModified))
                    candidates.Add(new Candidate(NotificationType.GradeChanged, entry.Entity.Id, entry.Entity.SchoolUserId, null, entry.Entity.ExamId, entry.Entity.Exam, null, null));
            }

            foreach (var entry in context.ChangeTracker.Entries<Absence>())
            {
                if (entry.State == EntityState.Added)
                    // Only the date: the reason can be health data and must not get a second copy here.
                    candidates.Add(new Candidate(NotificationType.AbsenceAdded, entry.Entity.Id, entry.Entity.SchoolUserId, null, null, null, null, entry.Entity.From));
            }

            foreach (var entry in context.ChangeTracker.Entries<AgendaEntry>())
            {
                NotificationType? type = entry.State switch
                {
                    EntityState.Added => NotificationType.AgendaAdded,
                    EntityState.Modified when entry.Property(a => a.Date).IsModified || entry.Property(a => a.EndDate).IsModified || entry.Property(a => a.EntryType).IsModified => NotificationType.AgendaChanged,
                    _ => null,
                };

                if (type is null)
                    continue;

                // School-wide entries would fan out to every student in the school; not notified.
                if (entry.Entity.SchoolId is not null)
                    continue;

                candidates.Add(new Candidate(type.Value, entry.Entity.Id, entry.Entity.SchoolUserId, entry.Entity.ClassId, null, null, entry.Entity.Title, entry.Entity.Date));
            }

            return candidates;
        }

        private static Dictionary<Guid, Guid> ResolveSchoolUsers(DbContext context, List<Candidate> candidates)
        {
            var ids = SchoolUserIds(candidates);
            var map = TrackedSchoolUsers(context, ids);
            var remaining = ids.Where(id => !map.ContainsKey(id)).ToList();

            if (remaining.Count > 0)
            {
                var found = context.Set<SchoolUser>()
                    .Where(su => remaining.Contains(su.Id))
                    .Select(su => new { su.Id, su.ApplicationUserId })
                    .ToList();

                foreach (var su in found)
                    map[su.Id] = su.ApplicationUserId;
            }

            return map;
        }

        private static async Task<Dictionary<Guid, Guid>> ResolveSchoolUsersAsync(DbContext context, List<Candidate> candidates, CancellationToken cancellationToken)
        {
            var ids = SchoolUserIds(candidates);
            var map = TrackedSchoolUsers(context, ids);
            var remaining = ids.Where(id => !map.ContainsKey(id)).ToList();

            if (remaining.Count > 0)
            {
                var found = await context.Set<SchoolUser>()
                    .Where(su => remaining.Contains(su.Id))
                    .Select(su => new { su.Id, su.ApplicationUserId })
                    .ToListAsync(cancellationToken);

                foreach (var su in found)
                    map[su.Id] = su.ApplicationUserId;
            }

            return map;
        }

        private static List<Guid> SchoolUserIds(List<Candidate> candidates) =>
            candidates.Where(c => c.SchoolUserId is not null).Select(c => c.SchoolUserId!.Value).Distinct().ToList();

        // A sync can create the SchoolUser and the notifying data in the same SaveChanges,
        // so tracked additions must be checked before falling back to a query.
        private static Dictionary<Guid, Guid> TrackedSchoolUsers(DbContext context, List<Guid> ids)
        {
            var map = new Dictionary<Guid, Guid>();

            foreach (var entry in context.ChangeTracker.Entries<SchoolUser>())
            {
                if (entry.State == EntityState.Added && ids.Contains(entry.Entity.Id))
                    map[entry.Entity.Id] = entry.Entity.ApplicationUserId;
            }

            return map;
        }

        private static Dictionary<Guid, List<Guid>> ResolveClasses(DbContext context, List<Candidate> candidates)
        {
            var ids = ClassIds(candidates);
            if (ids.Count == 0)
                return [];

            return context.Set<Class>()
                .Where(c => ids.Contains(c.Id))
                .Include(c => c.Students)
                .ToList()
                .ToDictionary(c => c.Id, c => c.Students.Select(s => s.ApplicationUserId).ToList());
        }

        private static async Task<Dictionary<Guid, List<Guid>>> ResolveClassesAsync(DbContext context, List<Candidate> candidates, CancellationToken cancellationToken)
        {
            var ids = ClassIds(candidates);
            if (ids.Count == 0)
                return [];

            var classes = await context.Set<Class>()
                .Where(c => ids.Contains(c.Id))
                .Include(c => c.Students)
                .ToListAsync(cancellationToken);

            return classes.ToDictionary(c => c.Id, c => c.Students.Select(s => s.ApplicationUserId).ToList());
        }

        private static List<Guid> ClassIds(List<Candidate> candidates) =>
            candidates.Where(c => c.ClassId is not null).Select(c => c.ClassId!.Value).Distinct().ToList();

        private static Dictionary<Guid, string> ResolveExamNames(DbContext context, List<Candidate> candidates)
        {
            var ids = MissingExamIds(candidates);
            var map = TrackedExamNames(context, ids);
            var remaining = ids.Where(id => !map.ContainsKey(id)).ToList();

            if (remaining.Count > 0)
            {
                var found = context.Set<Exam>()
                    .Where(e => remaining.Contains(e.Id))
                    .Select(e => new { e.Id, e.Name })
                    .ToList();

                foreach (var e in found)
                    map[e.Id] = e.Name;
            }

            return map;
        }

        private static async Task<Dictionary<Guid, string>> ResolveExamNamesAsync(DbContext context, List<Candidate> candidates, CancellationToken cancellationToken)
        {
            var ids = MissingExamIds(candidates);
            var map = TrackedExamNames(context, ids);
            var remaining = ids.Where(id => !map.ContainsKey(id)).ToList();

            if (remaining.Count > 0)
            {
                var found = await context.Set<Exam>()
                    .Where(e => remaining.Contains(e.Id))
                    .Select(e => new { e.Id, e.Name })
                    .ToListAsync(cancellationToken);

                foreach (var e in found)
                    map[e.Id] = e.Name;
            }

            return map;
        }

        // Only look up exams whose name wasn't already available via the loaded navigation.
        private static List<Guid> MissingExamIds(List<Candidate> candidates) =>
            candidates.Where(c => c.ExamId is not null && c.Exam is null).Select(c => c.ExamId!.Value).Distinct().ToList();

        private static Dictionary<Guid, string> TrackedExamNames(DbContext context, List<Guid> ids)
        {
            var map = new Dictionary<Guid, string>();

            foreach (var entry in context.ChangeTracker.Entries<Exam>())
            {
                if (entry.State == EntityState.Added && ids.Contains(entry.Entity.Id))
                    map[entry.Entity.Id] = entry.Entity.Name;
            }

            return map;
        }

        private static void Enqueue(DbContext context, List<Candidate> candidates, Dictionary<Guid, Guid> schoolUserMap, Dictionary<Guid, List<Guid>> classMap, Dictionary<Guid, string> examMap)
        {
            var now = DateTime.UtcNow;

            foreach (var candidate in candidates)
            {
                var subjectName = candidate.Exam?.Name ?? (candidate.ExamId is Guid examId && examMap.TryGetValue(examId, out var name) ? name : null);

                if (candidate.SchoolUserId is Guid schoolUserId)
                {
                    if (schoolUserMap.TryGetValue(schoolUserId, out var applicationUserId))
                        Add(context, applicationUserId, candidate, subjectName, now);
                }
                else if (candidate.ClassId is Guid classId && classMap.TryGetValue(classId, out var students))
                {
                    foreach (var applicationUserId in students)
                        Add(context, applicationUserId, candidate, subjectName, now);
                }
            }
        }

        private static void Add(DbContext context, Guid applicationUserId, Candidate candidate, string? subjectName, DateTime now)
        {
            // CreatedAt/UpdatedAt/NextAttemptAt are set explicitly: UpdateDateTrackingFields()
            // already ran before this interceptor, so an unset UpdatedAt would be a
            // non-UTC default DateTime that Npgsql rejects.
            context.Set<NotificationOutbox>().Add(new NotificationOutbox
            {
                Id = Guid.NewGuid(),
                ApplicationUserId = applicationUserId,
                Type = candidate.Type,
                EntityId = candidate.EntityId,
                SubjectName = subjectName,
                Summary = candidate.Summary,
                OccursAt = candidate.OccursAt,
                Status = NotificationOutboxStatus.Pending,
                RetryCount = 0,
                NextAttemptAt = now,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }
    }
}
