using Schuly.Domain.Enums;

namespace Schuly.Domain
{
    public class Absence : Base, ISyncedEntity
    {
        /// <summary>Enforced in code, because the column holds the encrypted value.</summary>
        public const int MaxReasonLength = 500;

        public string? Source { get; set; }
        public string? ExternalId { get; set; }

        public required string Reason { get; set; } = "Absent";
        public required AbsenceType Type { get; set; }
        public required DateTime From { get; set; }
        public required DateTime Until { get; set; }
        public bool? IsExcused { get; set; }

        /// <summary>Time of day as the school sent it (HH:mm). From and Until alone can be dates at midnight.</summary>
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
        public SchoolUser? SchoolUser { get; set; }
    }
}
