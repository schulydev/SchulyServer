namespace Schuly.Infrastructure.Services
{
    public class RetentionOptions
    {
        public const string SectionName = "Retention";

        /// <summary>The floor for <see cref="InactivityWarningDays"/>; a lower setting is raised to this.</summary>
        public const int MinimumWarningDays = 14;

        public bool Enabled { get; set; } = true;
        public int MonthsAfterLeave { get; set; } = 6;
        public int MonthsInactive { get; set; } = 12;
        public int InactivityWarningDays { get; set; } = 30;
        public bool SweepOrphanBlobs { get; set; } = true;
        public int OrphanBlobGraceDays { get; set; } = 7;
    }
}
