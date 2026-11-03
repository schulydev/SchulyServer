using Microsoft.Extensions.Logging.Abstractions;
using Schuly.API.Services.Notifications;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class NotificationDispatcherTests
    {
        private static NotificationOutbox NewRow(Guid userId, NotificationType type, DateTime now, string? subjectName = null, string? summary = null, int retryCount = 0) => new()
        {
            Id = Guid.NewGuid(),
            ApplicationUserId = userId,
            Type = type,
            EntityId = Guid.NewGuid(),
            SubjectName = subjectName,
            Summary = summary,
            Status = NotificationOutboxStatus.Pending,
            RetryCount = retryCount,
            NextAttemptAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };

        [Test]
        public async Task Row_whose_category_is_disabled_is_deleted_without_sending()
        {
            var dbName = nameof(Row_whose_category_is_disabled_is_deleted_without_sending);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            ctx.NotificationPreferences.Add(new NotificationPreference { ApplicationUserId = userId, Grades = false, Absences = true, Agenda = true });
            var row = NewRow(userId, NotificationType.GradeAdded, now, subjectName: "Mathematik");
            ctx.NotificationOutbox.Add(row);
            ctx.SaveChanges();

            var sender = new FakePushSender();
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            var processed = await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(processed).IsEqualTo(1);
            await Assert.That(ctx.NotificationOutbox.Any()).IsFalse();
            await Assert.That(sender.Sends.Count).IsEqualTo(0);
        }

        [Test]
        public async Task User_with_no_device_tokens_has_rows_deleted()
        {
            var dbName = nameof(User_with_no_device_tokens_has_rows_deleted);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            var row = NewRow(userId, NotificationType.AbsenceAdded, now, summary: "Krank");
            ctx.NotificationOutbox.Add(row);
            ctx.SaveChanges();

            var sender = new FakePushSender();
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            var processed = await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(processed).IsEqualTo(1);
            await Assert.That(ctx.NotificationOutbox.Any()).IsFalse();
            await Assert.That(sender.Sends.Count).IsEqualTo(0);
        }

        [Test]
        public async Task De_and_en_tokens_each_get_their_own_send()
        {
            var dbName = nameof(De_and_en_tokens_each_get_their_own_send);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "de-token", Platform = "android", Locale = "de", LastSeenAt = now });
            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "en-token", Platform = "ios", Locale = "en", LastSeenAt = now });
            var row = NewRow(userId, NotificationType.AbsenceAdded, now, summary: "Krank");
            ctx.NotificationOutbox.Add(row);
            ctx.SaveChanges();

            var sender = new FakePushSender();
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            var processed = await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(processed).IsEqualTo(1);
            await Assert.That(ctx.NotificationOutbox.Any()).IsFalse();
            await Assert.That(sender.Sends.Count).IsEqualTo(2);

            var deSend = sender.Sends.Single(s => s.Tokens.Contains("de-token"));
            var enSend = sender.Sends.Single(s => s.Tokens.Contains("en-token"));
            await Assert.That(deSend.Message.Title).IsEqualTo("Neue Absenz");
            await Assert.That(enSend.Message.Title).IsEqualTo("New absence");
        }

        [Test]
        public async Task Three_grade_added_rows_for_one_user_produce_a_single_aggregated_send()
        {
            var dbName = nameof(Three_grade_added_rows_for_one_user_produce_a_single_aggregated_send);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "token-1", Platform = "android", Locale = "de", LastSeenAt = now });
            ctx.NotificationOutbox.Add(NewRow(userId, NotificationType.GradeAdded, now, subjectName: "Mathematik"));
            ctx.NotificationOutbox.Add(NewRow(userId, NotificationType.GradeAdded, now, subjectName: "Deutsch"));
            ctx.NotificationOutbox.Add(NewRow(userId, NotificationType.GradeAdded, now, subjectName: "Englisch"));
            ctx.SaveChanges();

            var sender = new FakePushSender();
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            var processed = await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(processed).IsEqualTo(3);
            await Assert.That(sender.Sends.Count).IsEqualTo(1);
            await Assert.That(sender.Sends[0].Message.Title).IsEqualTo("3 neue Noten");
            await Assert.That(ctx.NotificationOutbox.Any()).IsFalse();
        }

        [Test]
        public async Task Unregistered_token_is_deleted_from_device_tokens()
        {
            var dbName = nameof(Unregistered_token_is_deleted_from_device_tokens);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "dead-token", Platform = "android", Locale = "de", LastSeenAt = now });
            ctx.NotificationOutbox.Add(NewRow(userId, NotificationType.AbsenceAdded, now, summary: "Krank"));
            ctx.SaveChanges();

            var sender = new FakePushSender { UnregisteredTokensToReturn = ["dead-token"] };
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(ctx.DeviceTokens.Any(t => t.Token == "dead-token")).IsFalse();
        }

        [Test]
        public async Task A_grade_value_is_read_from_the_grade_when_the_push_goes_out()
        {
            using var ctx = TestDb.NewContext(Guid.NewGuid().ToString());
            var now = DateTime.UtcNow;
            var (withValue, withoutValue) = (Guid.NewGuid(), Guid.NewGuid());
            var (grade, otherGrade) = (new Grade { Id = Guid.NewGuid(), Score = 5.5m, Weighting = 1, ExamId = Guid.NewGuid(), SchoolUserId = Guid.NewGuid() }, new Grade { Id = Guid.NewGuid(), Score = 4m, Weighting = 1, ExamId = Guid.NewGuid(), SchoolUserId = Guid.NewGuid() });
            ctx.Grades.AddRange(grade, otherGrade);
            ctx.NotificationPreferences.Add(new NotificationPreference { ApplicationUserId = withValue, IncludeGradeValue = true });
            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = withValue, Token = "with", Platform = "android", Locale = "de", LastSeenAt = now });
            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = withoutValue, Token = "without", Platform = "android", Locale = "de", LastSeenAt = now });
            var first = NewRow(withValue, NotificationType.GradeAdded, now, subjectName: "Mathematik");
            first.EntityId = grade.Id;
            var second = NewRow(withoutValue, NotificationType.GradeAdded, now, subjectName: "Mathematik");
            second.EntityId = otherGrade.Id;
            ctx.NotificationOutbox.AddRange(first, second);
            ctx.SaveChanges();

            var sender = new FakePushSender();
            await new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance).DrainOnceAsync(CancellationToken.None);

            await Assert.That(sender.Sends.Single(s => s.Tokens.Contains("with")).Message.Body).IsEqualTo("Note: 5.50");
            await Assert.That(sender.Sends.Single(s => s.Tokens.Contains("without")).Message.Body).IsNull();
            await Assert.That(ctx.NotificationOutbox.Any()).IsFalse();
        }

        [Test]
        public async Task An_absence_push_shows_the_date_without_a_stored_reason()
        {
            using var ctx = TestDb.NewContext(Guid.NewGuid().ToString());
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();
            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "t", Platform = "android", Locale = "de", LastSeenAt = now });
            var row = NewRow(userId, NotificationType.AbsenceAdded, now);
            row.OccursAt = new DateTime(2026, 3, 2, 0, 0, 0, DateTimeKind.Utc);
            ctx.NotificationOutbox.Add(row);
            ctx.NotificationPreferences.Add(new NotificationPreference { ApplicationUserId = userId, IncludeDetails = true });
            ctx.SaveChanges();

            var sender = new FakePushSender();
            await new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance).DrainOnceAsync(CancellationToken.None);

            await Assert.That(sender.Sends.Single().Message.Body).IsEqualTo("02.03.2026");
        }

        [Test]
        public async Task A_user_who_never_chose_gets_a_push_without_the_subject()
        {
            using var ctx = TestDb.NewContext(Guid.NewGuid().ToString());
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();
            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "t", Platform = "android", Locale = "en", LastSeenAt = now });
            var row = NewRow(userId, NotificationType.GradeAdded, now);
            row.SubjectName = "Mathematik";
            ctx.NotificationOutbox.Add(row);
            ctx.SaveChanges();

            var sender = new FakePushSender();
            await new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance).DrainOnceAsync(CancellationToken.None);

            await Assert.That(sender.Sends.Single().Message.Title).IsEqualTo("New grade");
        }

        [Test]
        public async Task Throwing_sender_leaves_the_row_pending_with_retry_count_incremented()
        {
            var dbName = nameof(Throwing_sender_leaves_the_row_pending_with_retry_count_incremented);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "token-1", Platform = "android", Locale = "de", LastSeenAt = now });
            var row = NewRow(userId, NotificationType.AbsenceAdded, now, summary: "Krank");
            ctx.NotificationOutbox.Add(row);
            ctx.SaveChanges();

            var sender = new FakePushSender { ExceptionToThrow = new InvalidOperationException("boom") };
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(row.Status).IsEqualTo(NotificationOutboxStatus.Pending);
            await Assert.That(row.RetryCount).IsEqualTo(1);
            await Assert.That(row.NextAttemptAt).IsGreaterThan(now);
            await Assert.That(row.LastError).IsEqualTo("boom");
        }

        [Test]
        public async Task Row_at_retry_count_four_that_fails_again_is_deleted()
        {
            var dbName = nameof(Row_at_retry_count_four_that_fails_again_is_deleted);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "token-1", Platform = "android", Locale = "de", LastSeenAt = now });
            var row = NewRow(userId, NotificationType.AbsenceAdded, now, summary: "Krank", retryCount: 4);
            ctx.NotificationOutbox.Add(row);
            ctx.SaveChanges();

            var sender = new FakePushSender { ExceptionToThrow = new InvalidOperationException("boom") };
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(ctx.NotificationOutbox.Any()).IsFalse();
        }

        [Test]
        public async Task Unconfigured_sender_drains_the_batch_by_deleting_rows()
        {
            var dbName = nameof(Unconfigured_sender_drains_the_batch_by_deleting_rows);
            using var ctx = TestDb.NewContext(dbName);
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            var row = NewRow(userId, NotificationType.AbsenceAdded, now, summary: "Krank");
            ctx.NotificationOutbox.Add(row);
            ctx.SaveChanges();

            var sender = new FakePushSender { IsConfigured = false };
            var dispatcher = new NotificationDispatcher(ctx, sender, NullLogger<NotificationDispatcher>.Instance);

            var processed = await dispatcher.DrainOnceAsync(CancellationToken.None);

            await Assert.That(processed).IsEqualTo(1);
            await Assert.That(ctx.NotificationOutbox.Any()).IsFalse();
            await Assert.That(sender.Sends.Count).IsEqualTo(0);
        }
    }
}
