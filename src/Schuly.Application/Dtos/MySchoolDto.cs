namespace Schuly.Application.Dtos
{
    public class MySchoolDto
    {
        public Guid Id { get; set; }
        public required string Name { get; set; }
        public required string Email { get; set; }
        public required string FullName { get; set; }
        public string? LogoUrl { get; set; }
        public string? Website { get; set; }
        public string? SchoolSystemKey { get; set; }
        public string? ProfilePictureUrl { get; set; }
    }
}
