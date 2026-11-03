using System.Globalization;
using Schuly.Domain;
using Schuly.Domain.Enums;

namespace Schuly.API.Services.Notifications
{
    // Pure and static so it's trivially unit-testable, with no DI surface.
    public static class NotificationMessageFactory
    {
        private const string DateFormatDe = "dd.MM.yyyy";
        private const string DateFormatEn = "MM/dd/yyyy";

        public static PushMessage Create(NotificationOutbox row, string locale, bool includeGradeValue, decimal? score = null, bool includeDetails = false)
        {
            var isGerman = Normalize(locale) == "de";
            var data = new Dictionary<string, string> { ["type"] = CamelCase(row.Type), ["entityId"] = row.EntityId.ToString() };

            return row.Type switch
            {
                NotificationType.GradeAdded => new PushMessage(GradeTitle(isGerman, includeDetails ? row.SubjectName : null, changed: false), GradeBody(isGerman, score, includeGradeValue), data),
                NotificationType.GradeChanged => new PushMessage(GradeTitle(isGerman, includeDetails ? row.SubjectName : null, changed: true), GradeBody(isGerman, score, includeGradeValue), data),
                NotificationType.AbsenceAdded => new PushMessage(isGerman ? "Neue Absenz" : "New absence", includeDetails ? AbsenceBody(isGerman, row) : null, data),
                NotificationType.AgendaAdded => new PushMessage(isGerman ? "Neuer Termin" : "New agenda entry", includeDetails ? AgendaBody(isGerman, row) : null, data),
                NotificationType.AgendaChanged => new PushMessage(isGerman ? "Termin geändert" : "Agenda entry changed", includeDetails ? AgendaBody(isGerman, row) : null, data),
                _ => throw new ArgumentOutOfRangeException(nameof(row), row.Type, "Unknown notification type"),
            };
        }

        public static PushMessage CreateAggregate(NotificationType type, string locale, int count)
        {
            var isGerman = Normalize(locale) == "de";
            var data = new Dictionary<string, string> { ["type"] = CamelCase(type), ["count"] = count.ToString(CultureInfo.InvariantCulture) };

            var title = type switch
            {
                NotificationType.GradeAdded => isGerman ? $"{count} neue Noten" : $"{count} new grades",
                NotificationType.GradeChanged => isGerman ? $"{count} Notenänderungen" : $"{count} grade changes",
                NotificationType.AbsenceAdded => isGerman ? $"{count} neue Absenzen" : $"{count} new absences",
                NotificationType.AgendaAdded => isGerman ? $"{count} neue Termine" : $"{count} new agenda entries",
                NotificationType.AgendaChanged => isGerman ? $"{count} Terminänderungen" : $"{count} agenda changes",
                _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unknown notification type"),
            };

            return new PushMessage(title, null, data);
        }

        private static string GradeTitle(bool isGerman, string? subjectName, bool changed)
        {
            var hasSubject = !string.IsNullOrWhiteSpace(subjectName);

            if (isGerman)
                return changed
                    ? (hasSubject ? $"Note geändert in {subjectName}" : "Note geändert")
                    : (hasSubject ? $"Neue Note in {subjectName}" : "Neue Note");

            return changed
                ? (hasSubject ? $"Grade changed in {subjectName}" : "Grade changed")
                : (hasSubject ? $"New grade in {subjectName}" : "New grade");
        }

        private static string? GradeBody(bool isGerman, decimal? score, bool includeGradeValue)
        {
            if (!includeGradeValue || score is not decimal value)
                return null;

            var formatted = value.ToString("F2", CultureInfo.InvariantCulture);
            return isGerman ? $"Note: {formatted}" : $"Grade: {formatted}";
        }

        private static string? AbsenceBody(bool isGerman, NotificationOutbox row)
        {
            if (row.OccursAt is DateTime occursAt)
                return occursAt.ToString(isGerman ? DateFormatDe : DateFormatEn, CultureInfo.InvariantCulture);

            return row.Summary;
        }

        private static string? AgendaBody(bool isGerman, NotificationOutbox row)
        {
            if (row.OccursAt is not DateTime occursAt)
                return row.Summary;

            var date = occursAt.ToString(isGerman ? DateFormatDe : DateFormatEn, CultureInfo.InvariantCulture);
            return $"{row.Summary} - {date}";
        }

        private static string Normalize(string locale) => locale is "de" or "en" ? locale : "de";

        private static string CamelCase(NotificationType type)
        {
            var name = type.ToString();
            return char.ToLowerInvariant(name[0]) + name[1..];
        }
    }
}
