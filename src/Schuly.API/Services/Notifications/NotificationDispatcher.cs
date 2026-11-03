using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;

namespace Schuly.API.Services.Notifications
{
    // Turns pending NotificationOutbox rows into pushes. Split out from the hosted loop so
    // one drain pass is directly unit-testable. A row leaves the table as soon as it is
    // handled: the outbox is a queue, not a record of what was sent.
    public sealed class NotificationDispatcher(SchulyDbContext dbContext, IPushSender sender, ILogger<NotificationDispatcher> logger)
    {
        private const int BatchSize = 100;
        private const int MaxRetryCount = 5;
        private const int MaxRetryDelayMinutes = 30;

        public async Task<int> DrainOnceAsync(CancellationToken cancellationToken)
        {
            try
            {
                var now = DateTime.UtcNow;
                var rows = await dbContext.NotificationOutbox
                    .Where(r => r.Status == NotificationOutboxStatus.Pending && r.NextAttemptAt <= now)
                    .OrderBy(r => r.CreatedAt)
                    .Take(BatchSize)
                    .ToListAsync(cancellationToken);

                if (rows.Count == 0)
                    return 0;

                if (!sender.IsConfigured)
                {
                    // Startup already logged that push is disabled; this repeats per poll,
                    // so keep it at Debug.
                    logger.LogDebug("Push sender is not configured; draining the notification outbox without sending");
                    dbContext.NotificationOutbox.RemoveRange(rows);
                    await dbContext.SaveChangesAsync(cancellationToken);
                    return rows.Count;
                }

                await DeliverAsync(rows, now, cancellationToken);
                await dbContext.SaveChangesAsync(cancellationToken);
                return rows.Count;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Notification outbox drain failed");
                return 0;
            }
        }

        private async Task DeliverAsync(List<NotificationOutbox> rows, DateTime now, CancellationToken cancellationToken)
        {
            var userIds = rows.Select(r => r.ApplicationUserId).Distinct().ToList();

            var preferences = await dbContext.NotificationPreferences
                .Where(p => userIds.Contains(p.ApplicationUserId))
                .ToDictionaryAsync(p => p.ApplicationUserId, cancellationToken);

            var tokens = await dbContext.DeviceTokens
                .Where(t => userIds.Contains(t.ApplicationUserId))
                .ToListAsync(cancellationToken);

            var tokensByUser = tokens.GroupBy(t => t.ApplicationUserId).ToDictionary(g => g.Key, g => g.ToList());
            var scores = await GradeValuesAsync(rows, preferences, cancellationToken);
            var unregisteredTokens = new HashSet<string>();

            foreach (var userGroup in rows.GroupBy(r => r.ApplicationUserId))
                await DeliverForUserAsync(userGroup.Key, userGroup.ToList(), preferences.GetValueOrDefault(userGroup.Key), tokensByUser.GetValueOrDefault(userGroup.Key), scores, unregisteredTokens, now, cancellationToken);

            if (unregisteredTokens.Count > 0)
                dbContext.DeviceTokens.RemoveRange(tokens.Where(t => unregisteredTokens.Contains(t.Token)));
        }

        private async Task DeliverForUserAsync(Guid userId, List<NotificationOutbox> userRows, NotificationPreference? preference, List<DeviceToken>? userTokens, Dictionary<Guid, decimal> scores, HashSet<string> unregisteredTokens, DateTime now, CancellationToken cancellationToken)
        {
            var grades = preference?.Grades ?? true;
            var absences = preference?.Absences ?? true;
            var agenda = preference?.Agenda ?? true;
            var includeGradeValue = preference?.IncludeGradeValue ?? false;

            var deliverable = new List<NotificationOutbox>();

            foreach (var row in userRows)
            {
                if (IsCategoryEnabled(row.Type, grades, absences, agenda))
                    deliverable.Add(row);
                else
                    dbContext.NotificationOutbox.Remove(row);
            }

            if (deliverable.Count == 0)
                return;

            if (userTokens is null || userTokens.Count == 0)
            {
                dbContext.NotificationOutbox.RemoveRange(deliverable);
                return;
            }

            var tokensByLocale = userTokens.GroupBy(t => t.Locale).ToList();

            foreach (var typeGroup in deliverable.GroupBy(r => r.Type))
            {
                var groupRows = typeGroup.ToList();

                try
                {
                    foreach (var localeGroup in tokensByLocale)
                    {
                        var localeTokens = localeGroup.Select(t => t.Token).ToList();
                        var message = groupRows.Count > 1
                            ? NotificationMessageFactory.CreateAggregate(typeGroup.Key, localeGroup.Key, groupRows.Count)
                            : NotificationMessageFactory.Create(groupRows[0], localeGroup.Key, includeGradeValue, scores.TryGetValue(groupRows[0].EntityId, out var score) ? score : null);

                        var result = await sender.SendAsync(localeTokens, message, cancellationToken);

                        foreach (var deadToken in result.UnregisteredTokens)
                            unregisteredTokens.Add(deadToken);
                    }

                    dbContext.NotificationOutbox.RemoveRange(groupRows);
                }
                catch (Exception ex)
                {
                    MarkFailedAttempt(groupRows, ex, now);
                    logger.LogWarning(ex, "Failed to send push notification batch for user {UserId}", userId);
                }
            }
        }

        private static bool IsCategoryEnabled(NotificationType type, bool grades, bool absences, bool agenda) => type switch
        {
            NotificationType.GradeAdded or NotificationType.GradeChanged => grades,
            NotificationType.AbsenceAdded => absences,
            NotificationType.AgendaAdded or NotificationType.AgendaChanged => agenda,
            _ => true,
        };

        // Grade values are read when the push goes out, and only for users who asked to see them, so the outbox never holds one.
        private async Task<Dictionary<Guid, decimal>> GradeValuesAsync(List<NotificationOutbox> rows, Dictionary<Guid, NotificationPreference> preferences, CancellationToken cancellationToken)
        {
            var gradeIds = rows
                .Where(r => r.Type is NotificationType.GradeAdded or NotificationType.GradeChanged && preferences.GetValueOrDefault(r.ApplicationUserId)?.IncludeGradeValue == true)
                .Select(r => r.EntityId)
                .ToList();

            return gradeIds.Count == 0
                ? []
                : await dbContext.Grades.Where(g => gradeIds.Contains(g.Id)).ToDictionaryAsync(g => g.Id, g => g.Score, cancellationToken);
        }

        private void MarkFailedAttempt(List<NotificationOutbox> rows, Exception ex, DateTime now)
        {
            var errorMessage = Truncate(ex.Message, 1000);

            foreach (var row in rows)
            {
                row.RetryCount++;
                row.LastError = errorMessage;
                row.UpdatedAt = now;

                if (row.RetryCount >= MaxRetryCount)
                {
                    logger.LogWarning("Dropped a {Type} notification after {Attempts} failed attempts", row.Type, row.RetryCount);
                    dbContext.NotificationOutbox.Remove(row);
                }
                else
                    row.NextAttemptAt = now + TimeSpan.FromMinutes(Math.Min(MaxRetryDelayMinutes, Math.Pow(2, row.RetryCount)));
            }
        }

        private static string Truncate(string value, int maxLength) => value.Length <= maxLength ? value : value[..maxLength];
    }
}
