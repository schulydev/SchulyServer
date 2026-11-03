using Schuly.Infrastructure.Storage;

namespace Schuly.Tests.TestHelpers
{
    /// <summary>
    /// In-memory <see cref="IDocumentStorage"/> fake for tests: reads uploads fully
    /// into a byte array (so it exercises the wrapping encrypting stream's read path
    /// the same way an HTTP upload would) and exposes the raw stored bytes so tests
    /// can inspect or tamper with the ciphertext.
    /// </summary>
    public sealed class InMemoryDocumentStorage : IDocumentStorage
    {
        public Dictionary<string, byte[]> Objects { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, string?> ContentTypes { get; } = new(StringComparer.Ordinal);

        public async Task<UploadedBlob> UploadAsync(Stream content, string fileName, string? contentType, CancellationToken ct)
        {
            using var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, ct);
            var bytes = buffer.ToArray();

            var key = $"{Guid.NewGuid():N}/{fileName}";
            Objects[key] = bytes;
            ContentTypes[key] = contentType;
            return new UploadedBlob(key, bytes.Length);
        }

        public IAsyncEnumerable<StoredBlob> ListAsync(CancellationToken ct) => Objects.Keys.Select(k => new StoredBlob(k, DateTime.UtcNow)).ToAsyncEnumerable();

        public Task<DocumentStream> OpenReadAsync(string key, CancellationToken ct)
        {
            var bytes = Objects[key];
            ContentTypes.TryGetValue(key, out var contentType);
            return Task.FromResult(new DocumentStream(new MemoryStream(bytes, writable: false), contentType, bytes.Length));
        }

        public Task DeleteAsync(string key, CancellationToken ct)
        {
            Objects.Remove(key);
            ContentTypes.Remove(key);
            return Task.CompletedTask;
        }
    }
}
