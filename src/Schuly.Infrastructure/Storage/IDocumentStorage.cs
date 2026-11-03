namespace Schuly.Infrastructure.Storage
{
    public record UploadedBlob(string Key, long SizeBytes);

    public record DocumentStream(Stream Content, string? ContentType, long? ContentLength) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync() => await Content.DisposeAsync();
    }

    public record StoredBlob(string Key, DateTime LastModifiedUtc);

    public interface IDocumentStorage
    {
        Task<UploadedBlob> UploadAsync(Stream content, string fileName, string? contentType, CancellationToken ct);

        Task<DocumentStream> OpenReadAsync(string key, CancellationToken ct);

        Task DeleteAsync(string key, CancellationToken ct);

        /// <summary>Every object in the store, to find the ones no row points at any more.</summary>
        IAsyncEnumerable<StoredBlob> ListAsync(CancellationToken ct);
    }
}
