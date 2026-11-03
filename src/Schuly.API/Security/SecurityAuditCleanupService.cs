using Schuly.Infrastructure;
using Schuly.Infrastructure.Security;

namespace Schuly.API.Security
{
    /// <summary>Daily removal of audit entries past <c>SecurityAudit:RetentionDays</c> (default 365).</summary>
    public sealed class SecurityAuditCleanupService(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<SecurityAuditCleanupService> logger) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var days = configuration.GetValue($"{SecurityAuditLog.SectionName}:RetentionDays", SecurityAuditLog.DefaultRetentionDays);
            if (days <= 0)
                days = SecurityAuditLog.DefaultRetentionDays;

            using var timer = new PeriodicTimer(TimeSpan.FromDays(1));
            try
            {
                do
                {
                    try
                    {
                        using var scope = scopes.CreateScope();
                        var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
                        var removed = await SecurityAuditLog.DeleteOlderThanAsync(db, DateTime.UtcNow.AddDays(-days), stoppingToken);
                        if (removed > 0)
                            logger.LogInformation("Removed {Count} expired security audit entries", removed);
                    }
                    catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                    {
                        logger.LogWarning("Security audit cleanup failed ({Error})", ex.GetType().Name);
                    }
                }
                while (await timer.WaitForNextTickAsync(stoppingToken));
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
            }
        }
    }
}
