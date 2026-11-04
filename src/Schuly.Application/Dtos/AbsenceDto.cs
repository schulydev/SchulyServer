using Schuly.Domain.Enums;

namespace Schuly.Application.Dtos
{
    public class AbsenceDto
    {
        public Guid Id { get; set; }
        public required string Reason { get; set; }
        public required AbsenceType Type { get; set; }
        public required DateTime From { get; set; }
        public required DateTime Until { get; set; }
        public bool? IsExcused { get; set; }
        public string? StartTime { get; set; }
        public string? EndTime { get; set; }
        public string? ParentStatus { get; set; }
        public DateOnly? ParentStatusDate { get; set; }
        public string? TrainerStatus { get; set; }
        public DateOnly? TrainerStatusDate { get; set; }
        public string? TrainerComment { get; set; }
        public string? Comment { get; set; }
        public DateOnly? ExcuseDeadline { get; set; }
        public int? Lessons { get; set; }
        public Guid SchoolUserId { get; set; }
        public Guid? SchoolId { get; set; }
    }
}
