namespace Schuly.Infrastructure.Services
{
    /// <summary>Tells the owner of an inactive account that it will be deleted.</summary>
    public interface IInactivityWarningSender
    {
        Task SendAsync(string email, DateTime deleteAfterUtc, CancellationToken cancellationToken);
    }
}
