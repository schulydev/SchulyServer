namespace Schuly.Application.Dtos
{
    public record NotificationPreferencesDto(bool Grades, bool Absences, bool Agenda, bool IncludeGradeValue, bool IncludeDetails);
}
