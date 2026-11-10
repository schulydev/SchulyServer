namespace Schuly.Application.Dtos
{
    public record AppDto(string Version, bool RegistrationEnabled, string PolicyVersion, string PolicyUrl, bool SwissSchoolConfirmationRequired, string? MinAppVersion = null);
}
