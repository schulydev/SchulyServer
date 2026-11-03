using Schuly.Domain.Enums;

namespace Schuly.Application.Dtos
{
    public class SchoolUserDto
    {
        public Guid Id { get; set; }
        public Guid? ApplicationUserId { get; set; }
        public Guid SchoolId { get; set; }
        public string? SchoolName { get; set; }
        public required string FirstName { get; set; }
        public required string LastName { get; set; }
        public required string Email { get; set; }
        public string? ProfilePictureUrl { get; set; }
        public DateOnly? EntryDate { get; set; }
        public DateOnly? LeaveDate { get; set; }
        public required Roles Role { get; set; }
        public UserState State { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public List<AbsenceDto> Absences { get; set; } = new List<AbsenceDto>();
        public List<GradeDto> Grades { get; set; } = new List<GradeDto>();
        public List<UserClassDto> Classes { get; set; } = new List<UserClassDto>();
    }
}
