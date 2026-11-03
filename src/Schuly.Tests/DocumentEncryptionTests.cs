using System.Security.Cryptography;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Schuly.Infrastructure.Storage;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class DocumentEncryptionTests
    {
        private static readonly byte[] Magic = "SCHDOC1"u8.ToArray();
        private const int HeaderLength = 90;
        private const int FrameOverhead = 20;

        private static DocumentEncryptionKeyring Keyring(byte[] key, int version = 1, int chunkSize = 64, Dictionary<int, string>? previous = null) => new(Options.Create(new DocumentEncryptionOptions { EncryptionKey = Convert.ToBase64String(key), KeyVersion = version, ChunkSizeBytes = chunkSize, PreviousKeys = previous ?? new Dictionary<int, string>() }), NullLogger<DocumentEncryptionKeyring>.Instance);

        private static async Task<byte[]> ReadAllAsync(DocumentStream stream)
        {
            await using var ms = new MemoryStream();
            await stream.Content.CopyToAsync(ms);
            return ms.ToArray();
        }

        private static bool ContainsSequence(byte[] haystack, byte[] needle)
        {
            if (needle.Length == 0 || haystack.Length < needle.Length) return false;
            for (var i = 0; i <= haystack.Length - needle.Length; i++)
            {
                var match = true;
                for (var j = 0; j < needle.Length; j++)
                {
                    if (haystack[i + j] != needle[j]) { match = false; break; }
                }
                if (match) return true;
            }
            return false;
        }

        private sealed class RewindingStorage : IDocumentStorage
        {
            public IAsyncEnumerable<StoredBlob> ListAsync(CancellationToken ct) => throw new NotSupportedException();

            public long CapturedLength { get; private set; }
            public byte[] FirstRead { get; private set; } = [];
            public byte[] SecondRead { get; private set; } = [];

            public async Task<UploadedBlob> UploadAsync(Stream content, string fileName, string? contentType, CancellationToken ct)
            {
                CapturedLength = content.Length;

                using (var first = new MemoryStream())
                {
                    await content.CopyToAsync(first, ct);
                    FirstRead = first.ToArray();
                }

                content.Position = 0;

                using (var second = new MemoryStream())
                {
                    await content.CopyToAsync(second, ct);
                    SecondRead = second.ToArray();
                }

                return new UploadedBlob($"{Guid.NewGuid():N}/{fileName}", SecondRead.Length);
            }

            public Task<DocumentStream> OpenReadAsync(string key, CancellationToken ct) => throw new NotSupportedException();
            public Task DeleteAsync(string key, CancellationToken ct) => throw new NotSupportedException();
        }

        [Test]
        public async Task Empty_payload_round_trips_to_zero_bytes()
        {
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream([]), "empty.bin", "application/octet-stream", CancellationToken.None);

            await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.Length).IsEqualTo(0);
        }

        [Test]
        public async Task Small_payload_round_trips_byte_for_byte()
        {
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "small.bin", "application/octet-stream", CancellationToken.None);

            await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
        }

        [Test]
        public async Task Multi_chunk_payload_round_trips_byte_for_byte()
        {
            var payload = RandomNumberGenerator.GetBytes(64 * 3 + 17);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "multi.bin", "application/octet-stream", CancellationToken.None);

            await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
        }

        [Test]
        public async Task Payload_matching_exact_chunk_multiple_round_trips_byte_for_byte()
        {
            var payload = RandomNumberGenerator.GetBytes(128);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "exact.bin", "application/octet-stream", CancellationToken.None);

            await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
        }

        [Test]
        public async Task Stored_ciphertext_starts_with_magic_and_does_not_contain_plaintext()
        {
            var marker = "the secret plaintext marker 12345"u8.ToArray();
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(marker), "marker.bin", "application/octet-stream", CancellationToken.None);

            var stored = fake.Objects[uploaded.Key];

            await Assert.That(stored.Take(Magic.Length).SequenceEqual(Magic)).IsTrue();
            await Assert.That(ContainsSequence(stored, marker)).IsFalse();
        }

        [Test]
        public async Task Uploaded_size_and_stored_object_size_match_the_expected_frame_layout()
        {
            const int chunkSize = 64;
            var payload = RandomNumberGenerator.GetBytes(64 * 3 + 17);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32), chunkSize: chunkSize));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "sized.bin", "application/octet-stream", CancellationToken.None);

            var chunkCount = (payload.Length + chunkSize - 1) / chunkSize;

            await Assert.That(uploaded.SizeBytes).IsEqualTo((long)payload.Length);
            await Assert.That(fake.Objects[uploaded.Key].Length).IsEqualTo(HeaderLength + chunkCount * FrameOverhead + payload.Length);
        }

        [Test]
        public async Task Tampering_the_first_frames_ciphertext_throws()
        {
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "tamper-body.bin", "application/octet-stream", CancellationToken.None);

            fake.Objects[uploaded.Key][HeaderLength + 4] ^= 0x01;

            await Assert.That(async () =>
            {
                await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
                await ReadAllAsync(opened);
            }).Throws<CryptographicException>();
        }

        [Test]
        public async Task Tampering_the_final_auth_tag_throws()
        {
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "tamper-tag.bin", "application/octet-stream", CancellationToken.None);

            fake.Objects[uploaded.Key][^1] ^= 0x01;

            await Assert.That(async () =>
            {
                await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
                await ReadAllAsync(opened);
            }).Throws<CryptographicException>();
        }

        [Test]
        public async Task Tampering_the_wrapped_dek_throws()
        {
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "tamper-dek.bin", "application/octet-stream", CancellationToken.None);

            fake.Objects[uploaded.Key][20] ^= 0x01;

            await Assert.That(async () =>
            {
                await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
                await ReadAllAsync(opened);
            }).Throws<CryptographicException>();
        }

        [Test]
        public async Task Tampering_the_key_version_field_throws()
        {
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "tamper-version.bin", "application/octet-stream", CancellationToken.None);

            fake.Objects[uploaded.Key][8] ^= 0x01;

            await Assert.That(async () => await storage.OpenReadAsync(uploaded.Key, CancellationToken.None)).Throws<CryptographicException>();
        }

        [Test]
        public async Task Truncating_the_object_by_a_few_bytes_throws()
        {
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "trunc.bin", "application/octet-stream", CancellationToken.None);

            fake.Objects[uploaded.Key] = fake.Objects[uploaded.Key][..^5];

            await Assert.That(async () =>
            {
                await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
                await ReadAllAsync(opened);
            }).Throws<CryptographicException>();
        }

        [Test]
        public async Task Truncating_a_whole_final_frame_still_throws()
        {
            const int chunkSize = 64;
            var payload = RandomNumberGenerator.GetBytes(64 * 3 + 17);
            var fake = new InMemoryDocumentStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32), chunkSize: chunkSize));
            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "trunc-frame.bin", "application/octet-stream", CancellationToken.None);

            var lastChunkLength = payload.Length % chunkSize;
            fake.Objects[uploaded.Key] = fake.Objects[uploaded.Key][..^(FrameOverhead + lastChunkLength)];

            await Assert.That(async () =>
            {
                await using var opened = await storage.OpenReadAsync(uploaded.Key, CancellationToken.None);
                await ReadAllAsync(opened);
            }).Throws<CryptographicException>();
        }

        [Test]
        public async Task Legacy_plaintext_object_longer_than_magic_passes_through_unchanged()
        {
            var payload = "not an encrypted document, just plain bytes"u8.ToArray();
            var fake = new InMemoryDocumentStorage();
            fake.Objects["legacy/report.pdf"] = payload;
            fake.ContentTypes["legacy/report.pdf"] = "application/pdf";
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));

            await using var opened = await storage.OpenReadAsync("legacy/report.pdf", CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
            await Assert.That(opened.ContentType).IsEqualTo("application/pdf");
        }

        [Test]
        public async Task Legacy_plaintext_object_shorter_than_magic_passes_through_unchanged()
        {
            var payload = new byte[] { 1, 2, 3 };
            var fake = new InMemoryDocumentStorage();
            fake.Objects["legacy/short.bin"] = payload;
            fake.ContentTypes["legacy/short.bin"] = "application/octet-stream";
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));

            await using var opened = await storage.OpenReadAsync("legacy/short.bin", CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
        }

        [Test]
        public async Task Legacy_empty_object_passes_through_unchanged()
        {
            var fake = new InMemoryDocumentStorage();
            fake.Objects["legacy/empty.bin"] = [];
            fake.ContentTypes["legacy/empty.bin"] = "application/octet-stream";
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));

            await using var opened = await storage.OpenReadAsync("legacy/empty.bin", CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.Length).IsEqualTo(0);
        }

        [Test]
        public async Task Reading_with_a_different_key_throws()
        {
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();
            var storageA = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            var uploaded = await storageA.UploadAsync(new MemoryStream(payload), "wrongkey.bin", "application/octet-stream", CancellationToken.None);

            var storageB = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));

            await Assert.That(async () =>
            {
                await using var opened = await storageB.OpenReadAsync(uploaded.Key, CancellationToken.None);
                await ReadAllAsync(opened);
            }).Throws<CryptographicException>();
        }

        [Test]
        public async Task Rotating_keys_keeps_old_documents_readable_via_previous_keys()
        {
            var keyV1 = RandomNumberGenerator.GetBytes(32);
            var keyV2 = RandomNumberGenerator.GetBytes(32);
            var payload = RandomNumberGenerator.GetBytes(20);
            var fake = new InMemoryDocumentStorage();

            var storageV1 = new EncryptingDocumentStorage(fake, Keyring(keyV1, version: 1));
            var uploaded = await storageV1.UploadAsync(new MemoryStream(payload), "rotated.bin", "application/octet-stream", CancellationToken.None);

            var previous = new Dictionary<int, string> { [1] = Convert.ToBase64String(keyV1) };
            var storageV2WithPrevious = new EncryptingDocumentStorage(fake, Keyring(keyV2, version: 2, previous: previous));
            await using (var opened = await storageV2WithPrevious.OpenReadAsync(uploaded.Key, CancellationToken.None))
            {
                var bytes = await ReadAllAsync(opened);
                await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
            }

            var storageV2WithoutPrevious = new EncryptingDocumentStorage(fake, Keyring(keyV2, version: 2));
            await Assert.That(async () =>
            {
                await using var opened = await storageV2WithoutPrevious.OpenReadAsync(uploaded.Key, CancellationToken.None);
                await ReadAllAsync(opened);
            }).Throws<CryptographicException>();
        }

        [Test]
        public async Task Reencrypt_upgrades_a_legacy_plaintext_object_and_is_idempotent_afterwards()
        {
            var payload = "legacy plaintext content for reencryption"u8.ToArray();
            var fake = new InMemoryDocumentStorage();
            fake.Objects["legacy/doc.pdf"] = payload;
            fake.ContentTypes["legacy/doc.pdf"] = "application/pdf";
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));
            IDocumentEncryptionMaintenance maintenance = storage;

            var first = await maintenance.ReencryptAsync("legacy/doc.pdf", CancellationToken.None);
            await Assert.That(first.WasAlreadyEncrypted).IsFalse();
            await Assert.That(first.Key).IsNotEqualTo("legacy/doc.pdf");

            var newStored = fake.Objects[first.Key];
            await Assert.That(newStored.Take(Magic.Length).SequenceEqual(Magic)).IsTrue();

            await using (var opened = await storage.OpenReadAsync(first.Key, CancellationToken.None))
            {
                var bytes = await ReadAllAsync(opened);
                await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
            }

            await Assert.That(fake.Objects.ContainsKey("legacy/doc.pdf")).IsTrue();

            var second = await maintenance.ReencryptAsync(first.Key, CancellationToken.None);
            await Assert.That(second.WasAlreadyEncrypted).IsTrue();
            await Assert.That(second.Key).IsEqualTo(first.Key);
        }

        private static async Task AssertEncryptingReadStreamLengthMatchesStoredBytes(int payloadSize)
        {
            var payload = RandomNumberGenerator.GetBytes(payloadSize);
            var fake = new RewindingStorage();
            var storage = new EncryptingDocumentStorage(fake, Keyring(RandomNumberGenerator.GetBytes(32)));

            await storage.UploadAsync(new MemoryStream(payload), "length-check.bin", "application/octet-stream", CancellationToken.None);

            await Assert.That(fake.CapturedLength).IsEqualTo((long)fake.SecondRead.Length);
        }

        [Test]
        public async Task EncryptingReadStream_length_matches_stored_bytes_for_empty_payload() => await AssertEncryptingReadStreamLengthMatchesStoredBytes(0);

        [Test]
        public async Task EncryptingReadStream_length_matches_stored_bytes_for_partial_chunk_payload() => await AssertEncryptingReadStreamLengthMatchesStoredBytes(20);

        [Test]
        public async Task EncryptingReadStream_length_matches_stored_bytes_for_exact_multiple_payload() => await AssertEncryptingReadStreamLengthMatchesStoredBytes(128);

        [Test]
        public async Task Rewinding_the_encrypting_stream_reproduces_identical_ciphertext_that_still_decrypts()
        {
            var payload = RandomNumberGenerator.GetBytes(64 * 3 + 17);
            var key = RandomNumberGenerator.GetBytes(32);
            var rewinding = new RewindingStorage();
            var storage = new EncryptingDocumentStorage(rewinding, Keyring(key));

            var uploaded = await storage.UploadAsync(new MemoryStream(payload), "rewind.bin", "application/octet-stream", CancellationToken.None);

            await Assert.That(rewinding.FirstRead.SequenceEqual(rewinding.SecondRead)).IsTrue();

            var replay = new InMemoryDocumentStorage();
            replay.Objects[uploaded.Key] = rewinding.SecondRead;
            var replayStorage = new EncryptingDocumentStorage(replay, Keyring(key));
            await using var opened = await replayStorage.OpenReadAsync(uploaded.Key, CancellationToken.None);
            var bytes = await ReadAllAsync(opened);

            await Assert.That(bytes.SequenceEqual(payload)).IsTrue();
        }
    }
}
