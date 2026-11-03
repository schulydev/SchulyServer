namespace Schuly.Domain
{
    public enum PendingPurgeKind
    {
        Blob = 0,
        PluginUserData = 1,
        LinkedAccountSecrets = 2,
    }

    /// <summary>A deletion step outside the database transaction. It is written with the transaction, so a failed or interrupted step is retried by the daily sweep until it succeeds.</summary>
    public class PendingPurge : Base
    {
        public PendingPurgeKind Kind { get; set; }

        /// <summary>The blob key, application user id or linked account id, depending on <see cref="Kind"/>.</summary>
        public required string Target { get; set; }

        /// <summary>For <see cref="PendingPurgeKind.PluginUserData"/>: the one plugin to ask again.</summary>
        public string? PluginSource { get; set; }

        public int Attempts { get; set; }
    }
}
