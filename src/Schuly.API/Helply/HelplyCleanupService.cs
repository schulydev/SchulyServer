using Schuly.Infrastructure.Helply;

namespace Schuly.API.Helply
{
    /// <summary>Hourly removal of Helply conversations that have passed their 30-day expiry.</summary>
    public sealed class HelplyCleanupService(IServiceScopeFactory scopes, ILogger<HelplyCleanupService> logger) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
            try
            {
                await RunAsync(timer, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
            }
        }

        private async Task RunAsync(PeriodicTimer timer, CancellationToken stoppingToken)
        {
            do
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    var removed = await scope.ServiceProvider.GetRequiredService<HelplyConversationStore>().SweepAsync(stoppingToken);
                    if (removed > 0)
                        logger.LogInformation("Removed {Count} expired Helply conversations", removed);
                }
                catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Helply conversation cleanup failed ({Error})", ex.GetType().Name);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
    }
}
