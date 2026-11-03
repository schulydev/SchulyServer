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
        public Guid SchoolUserId { get; set; }
        public SchoolUser? SchoolUser { get; set; }
    }
}
