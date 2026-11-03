using Schuly.Infrastructure.Storage;

namespace Schuly.Tests.TestHelpers
{
    public sealed class FakeDocumentStorage : IDocumentStorage
    {
        public List<string> Deleted { get; } = [];
        public bool ThrowOnDelete { get; set; }

        public Task DeleteAsync(string key, CancellationToken ct)
        {
            if (ThrowOnDelete)
                throw new InvalidOperationException("Simulated blob deletion failure");

            Deleted.Add(key);
            return Task.CompletedTask;
        }

        public List<StoredBlob> Stored { get; } = [];

        public async IAsyncEnumerable<StoredBlob> ListAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
        {
            foreach (var blob in Stored)
                yield return blob;
            await Task.CompletedTask;
        }

        public Task<UploadedBlob> UploadAsync(Stream content, string fileName, string? contentType, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<DocumentStream> OpenReadAsync(string key, CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
