using Amazon.S3;
using Amazon.S3.Model;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Options;

namespace Schuly.Infrastructure.Storage
{
    public class S3DocumentStorage(IAmazonS3 client, IOptions<S3Options> options) : IDocumentStorage
    {
        private readonly S3Options _opts = options.Value;

        public async Task<UploadedBlob> UploadAsync(Stream content, string fileName, string? contentType, CancellationToken ct)
        {
            var key = $"{Guid.NewGuid():N}/{SanitizeFileName(fileName)}";

            var request = new PutObjectRequest
            {
                BucketName = _opts.Bucket,
                Key = key,
                InputStream = content,
                ContentType = contentType ?? "application/octet-stream",
                AutoCloseStream = false,
            };

            await client.PutObjectAsync(request, ct);

            return new UploadedBlob(key, content.Length);
        }

        public async Task<DocumentStream> OpenReadAsync(string key, CancellationToken ct)
        {
            var response = await client.GetObjectAsync(new GetObjectRequest
            {
                BucketName = _opts.Bucket,
                Key = key,
            }, ct);
            return new DocumentStream(
                response.ResponseStream,
                response.Headers.ContentType,
                response.Headers.ContentLength);
        }

        public async Task DeleteAsync(string key, CancellationToken ct) =>
            await client.DeleteObjectAsync(_opts.Bucket, key, ct);

        public async IAsyncEnumerable<StoredBlob> ListAsync([EnumeratorCancellation] CancellationToken ct)
        {
            var request = new ListObjectsV2Request { BucketName = _opts.Bucket };
            ListObjectsV2Response response;
            do
            {
                response = await client.ListObjectsV2Async(request, ct);
                foreach (var item in response.S3Objects ?? [])
                    yield return new StoredBlob(item.Key, (item.LastModified ?? DateTime.UtcNow).ToUniversalTime());
                request.ContinuationToken = response.NextContinuationToken;
            }
            while (response.IsTruncated == true);
        }

        private static string SanitizeFileName(string name)
        {
            var safe = name.Replace('\\', '/').Split('/').Last();
            return new string(safe.Select(c => char.IsControl(c) ? '_' : c).ToArray());
        }
    }
}
