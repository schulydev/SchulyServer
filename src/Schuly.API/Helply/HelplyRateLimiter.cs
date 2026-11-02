using System.Collections.Concurrent;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;

namespace Schuly.API.Helply
{
    /// <summary>Messages per user per minute and per day. One post (a message, an approval answer or a retry) is one permit. In memory: Schuly runs one instance.</summary>
    public sealed class HelplyRateLimiter(IOptions<HelplyLimits> limits) : IDisposable
    {
        private readonly PartitionedRateLimiter<Guid> _perMinute = PartitionedRateLimiter.Create<Guid, Guid>(user => RateLimitPartition.GetFixedWindowLimiter(user, _ => new FixedWindowRateLimiterOptions { PermitLimit = Math.Max(1, limits.Value.MessagesPerMinute), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        private readonly PartitionedRateLimiter<Guid> _perDay = PartitionedRateLimiter.Create<Guid, Guid>(user => RateLimitPartition.GetFixedWindowLimiter(user, _ => new FixedWindowRateLimiterOptions { PermitLimit = Math.Max(1, limits.Value.MessagesPerDay), Window = TimeSpan.FromDays(1), QueueLimit = 0 }));

        /// <summary>Takes one permit, or says how long to wait.</summary>
        public bool TryAcquire(Guid applicationUserId, out TimeSpan retryAfter)
        {
            retryAfter = TimeSpan.Zero;
            using var day = _perDay.AttemptAcquire(applicationUserId);
            if (!day.IsAcquired)
            {
                retryAfter = day.TryGetMetadata(MetadataName.RetryAfter, out var d) ? d : TimeSpan.FromHours(1);
                return false;
            }
            using var minute = _perMinute.AttemptAcquire(applicationUserId);
            if (!minute.IsAcquired)
            {
                retryAfter = minute.TryGetMetadata(MetadataName.RetryAfter, out var m) ? m : TimeSpan.FromMinutes(1);
                return false;
            }
            return true;
        }

        public const int UploadsPerHour = 60;

        private readonly PartitionedRateLimiter<Guid> _uploads = PartitionedRateLimiter.Create<Guid, Guid>(user => RateLimitPartition.GetFixedWindowLimiter(user, _ => new FixedWindowRateLimiterOptions { PermitLimit = UploadsPerHour, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));

        /// <summary>One upload. Separate from messages, so attaching files never eats into the message allowance.</summary>
        public bool TryAcquireUpload(Guid applicationUserId, out TimeSpan retryAfter)
        {
            using var lease = _uploads.AttemptAcquire(applicationUserId);
            retryAfter = lease.IsAcquired ? TimeSpan.Zero : lease.TryGetMetadata(MetadataName.RetryAfter, out var wait) ? wait : TimeSpan.FromMinutes(10);
            return lease.IsAcquired;
        }

        public void Dispose()
        {
            _perMinute.Dispose();
            _perDay.Dispose();
            _uploads.Dispose();
        }
    }

    /// <summary>One turn at a time per conversation. In memory, which is enough for a single instance.</summary>
    public sealed class HelplyTurnLocks
    {
        private readonly ConcurrentDictionary<Guid, byte> _running = new();

        public IDisposable? TryEnter(Guid conversationId) => _running.TryAdd(conversationId, 0) ? new Release(this, conversationId) : null;

        private sealed class Release(HelplyTurnLocks owner, Guid id) : IDisposable
        {
            public void Dispose() => owner._running.TryRemove(id, out _);
        }
    }
}
