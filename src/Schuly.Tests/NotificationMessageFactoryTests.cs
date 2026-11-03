using Schuly.API.Services.Notifications;
using Schuly.Domain;
using Schuly.Domain.Enums;

namespace Schuly.Tests
{
    public class NotificationMessageFactoryTests
    {
        private static NotificationOutbox NewRow(NotificationType type, string? subjectName = null, string? summary = null, DateTime? occursAt = null) => new()
        {
            Id = Guid.NewGuid(),
            ApplicationUserId = Guid.NewGuid(),
            Type = type,
            EntityId = Guid.NewGuid(),
            SubjectName = subjectName,
            Summary = summary,
            OccursAt = occursAt,
            Status = NotificationOutboxStatus.Pending,
        };

        [Test]
        public async Task By_default_no_subject_title_or_date_leaves_the_server()
        {
            var at = new DateTime(2026, 3, 4, 8, 0, 0, DateTimeKind.Utc);
            var rows = new[]
            {
                new NotificationOutbox { ApplicationUserId = Guid.NewGuid(), Type = NotificationType.GradeAdded, EntityId = Guid.NewGuid(), SubjectName = "Mathematik", NextAttemptAt = at },
                new NotificationOutbox { ApplicationUserId = Guid.NewGuid(), Type = NotificationType.GradeChanged, EntityId = Guid.NewGuid(), SubjectName = "Mathematik", NextAttemptAt = at },
                new NotificationOutbox { ApplicationUserId = Guid.NewGuid(), Type = NotificationType.AbsenceAdded, EntityId = Guid.NewGuid(), OccursAt = at, NextAttemptAt = at },
                new NotificationOutbox { ApplicationUserId = Guid.NewGuid(), Type = NotificationType.AgendaAdded, EntityId = Guid.NewGuid(), Summary = "Ausflug", OccursAt = at, NextAttemptAt = at },
                new NotificationOutbox { ApplicationUserId = Guid.NewGuid(), Type = NotificationType.AgendaChanged, EntityId = Guid.NewGuid(), Summary = "Ausflug", OccursAt = at, NextAttemptAt = at },
            };

            foreach (var row in rows)
            {
                var message = NotificationMessageFactory.Create(row, "de", includeGradeValue: false);
                var text = message.Title + " " + message.Body;
                await Assert.That(text).DoesNotContain("Mathematik");
                await Assert.That(text).DoesNotContain("Ausflug");
                await Assert.That(text).DoesNotContain("2026");
                await Assert.That(message.Body).IsNull();
            }
        }

        [Test]
        public async Task Grade_added_title_is_localized()
        {
            var row = NewRow(NotificationType.GradeAdded, subjectName: "Mathematik");

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Title).IsEqualTo("Neue Note in Mathematik");
            await Assert.That(en.Title).IsEqualTo("New grade in Mathematik");
        }

        [Test]
        public async Task Grade_changed_title_is_localized()
        {
            var row = NewRow(NotificationType.GradeChanged, subjectName: "Mathematik");

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Title).IsEqualTo("Note geändert in Mathematik");
            await Assert.That(en.Title).IsEqualTo("Grade changed in Mathematik");
        }

        [Test]
        public async Task Absence_added_title_is_localized()
        {
            var row = NewRow(NotificationType.AbsenceAdded, summary: "Krank");

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Title).IsEqualTo("Neue Absenz");
            await Assert.That(en.Title).IsEqualTo("New absence");
        }

        [Test]
        public async Task Agenda_added_title_is_localized()
        {
            var row = NewRow(NotificationType.AgendaAdded, summary: "Ausflug");

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Title).IsEqualTo("Neuer Termin");
            await Assert.That(en.Title).IsEqualTo("New agenda entry");
        }

        [Test]
        public async Task Agenda_changed_title_is_localized()
        {
            var row = NewRow(NotificationType.AgendaChanged, summary: "Ausflug");

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Title).IsEqualTo("Termin geändert");
            await Assert.That(en.Title).IsEqualTo("Agenda entry changed");
        }

        [Test]
        public async Task Unknown_locale_falls_back_to_german()
        {
            var row = NewRow(NotificationType.AbsenceAdded, summary: "Krank");

            var message = NotificationMessageFactory.Create(row, "fr", includeGradeValue: false, includeDetails: true);

            await Assert.That(message.Title).IsEqualTo("Neue Absenz");
        }

        [Test]
        public async Task Grade_body_is_present_only_when_include_grade_value_is_true()
        {
            var row = NewRow(NotificationType.GradeAdded, subjectName: "Mathematik");

            var withValue = NotificationMessageFactory.Create(row, "de", includeGradeValue: true, score: 5.5m, includeDetails: true);
            var withoutValue = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, score: 5.5m, includeDetails: true);

            await Assert.That(withValue.Body).IsEqualTo("Note: 5.50");
            await Assert.That(withoutValue.Body).IsNull();
        }

        [Test]
        public async Task Grade_body_is_null_when_score_is_unset_even_with_include_grade_value()
        {
            var row = NewRow(NotificationType.GradeAdded, subjectName: "Mathematik");

            var message = NotificationMessageFactory.Create(row, "en", includeGradeValue: true, includeDetails: true);

            await Assert.That(message.Body).IsNull();
        }

        [Test]
        public async Task Grade_with_blank_subject_name_drops_the_suffix()
        {
            var row = NewRow(NotificationType.GradeAdded, subjectName: "   ");

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Title).IsEqualTo("Neue Note");
            await Assert.That(en.Title).IsEqualTo("New grade");
        }

        [Test]
        public async Task Absence_body_uses_occurs_at_date_when_set()
        {
            var row = NewRow(NotificationType.AbsenceAdded, summary: "Krank", occursAt: new DateTime(2026, 3, 4));

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Body).IsEqualTo("04.03.2026");
            await Assert.That(en.Body).IsEqualTo("03/04/2026");
        }

        [Test]
        public async Task Absence_body_falls_back_to_summary_when_occurs_at_is_unset()
        {
            var row = NewRow(NotificationType.AbsenceAdded, summary: "Krank");

            var message = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);

            await Assert.That(message.Body).IsEqualTo("Krank");
        }

        [Test]
        public async Task Agenda_body_appends_occurs_at_date_when_set()
        {
            var row = NewRow(NotificationType.AgendaAdded, summary: "Ausflug", occursAt: new DateTime(2026, 3, 4));

            var de = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);
            var en = NotificationMessageFactory.Create(row, "en", includeGradeValue: false, includeDetails: true);

            await Assert.That(de.Body).IsEqualTo("Ausflug - 04.03.2026");
            await Assert.That(en.Body).IsEqualTo("Ausflug - 03/04/2026");
        }

        [Test]
        public async Task Single_message_data_payload_carries_camel_case_type_and_entity_id()
        {
            var row = NewRow(NotificationType.GradeAdded, subjectName: "Mathematik");

            var message = NotificationMessageFactory.Create(row, "de", includeGradeValue: false, includeDetails: true);

            await Assert.That(message.Data["type"]).IsEqualTo("gradeAdded");
            await Assert.That(message.Data["entityId"]).IsEqualTo(row.EntityId.ToString());
        }

        [Test]
        public async Task Aggregate_wording_is_localized_per_type()
        {
            var de = NotificationMessageFactory.CreateAggregate(NotificationType.GradeAdded, "de", 3);
            var en = NotificationMessageFactory.CreateAggregate(NotificationType.GradeAdded, "en", 3);

            await Assert.That(de.Title).IsEqualTo("3 neue Noten");
            await Assert.That(en.Title).IsEqualTo("3 new grades");
            await Assert.That(de.Body).IsNull();
        }

        [Test]
        public async Task Aggregate_data_payload_carries_camel_case_type_and_count()
        {
            var message = NotificationMessageFactory.CreateAggregate(NotificationType.AgendaChanged, "en", 4);

            await Assert.That(message.Data["type"]).IsEqualTo("agendaChanged");
            await Assert.That(message.Data["count"]).IsEqualTo("4");
        }
    }
}
