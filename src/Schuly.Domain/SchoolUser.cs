using Schuly.Domain.Enums;

namespace Schuly.Domain
{
    public class SchoolUser : Base
    {
        public string? Source { get; set; }
        public Guid ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        public Guid SchoolId { get; set; }
        public School? School { get; set; }

        public required string FirstName { get; set; }
        public required string LastName { get; set; }
        public required string Email { get; set; }
        public string? ProfilePictureUrl { get; set; }


        public required DateOnly EntryDate { get; set; }
        public DateOnly? LeaveDate { get; set; }
        public required Roles Role { get; set; }
        public UserState State { get; set; } = UserState.Active;

        public ICollection<Absence> Absences { get; set; } = [];
        public ICollection<Grade> Grades { get; set; } = [];
        public ICollection<Class> Classes { get; set; } = [];
        public ICollection<AgendaEntry> Agenda { get; set; } = [];
        public ICollection<StudentDocument> Documents { get; set; } = [];
        public ICollection<SemesterReport> SemesterReports { get; set; } = [];
    }
}
