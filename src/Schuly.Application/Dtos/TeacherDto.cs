namespace Schuly.Application.Dtos
{
    public class TeacherDto
    {
        public Guid Id { get; set; }
        public Guid SchoolId { get; set; }
        public string? SchoolName { get; set; }
        public required string FirstName { get; set; }
        public required string LastName { get; set; }
        public required string Code { get; set; }
    }
}
