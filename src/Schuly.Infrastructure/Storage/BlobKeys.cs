using System.Text.RegularExpressions;

namespace Schuly.Infrastructure.Storage
{
    public static partial class BlobKeys
    {
        /// <summary>A picture value can be a remote URL; only anything else is an object in our store.</summary>
        public static bool IsStored(string? value) =>
            !string.IsNullOrWhiteSpace(value) &&
            !value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

        /// <summary>The shape <see cref="S3DocumentStorage"/> gives its keys. Anything else in the bucket isn't ours to delete.</summary>
        public static bool HasUploadShape(string key) => UploadShape().IsMatch(key);

        [GeneratedRegex("^[0-9a-f]{32}/")]
        private static partial Regex UploadShape();
    }
}
