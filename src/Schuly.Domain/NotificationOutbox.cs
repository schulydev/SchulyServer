using Schuly.Domain.Enums;

namespace Schuly.Domain
{
    public class NotificationOutbox : Base
    {
        public Guid ApplicationUserId { get; set; }
        public NotificationType Type { get; set; }
        public Guid EntityId { get; set; }
        public string? SubjectName { get; set; }
        public string? Summary { get; set; }
        public DateTime? OccursAt { get; set; }
        public NotificationOutboxStatus Status { get; set; }
        public int RetryCount { get; set; }
        public string? LastError { get; set; }
        public DateTime NextAttemptAt { get; set; }
    }
}
