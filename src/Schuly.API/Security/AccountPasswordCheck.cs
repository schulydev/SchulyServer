using System.Security.Claims;
using Microsoft.Extensions.Options;
using Schuly.Infrastructure.Security;
using Toamaisutaa.Abstractions;

namespace Schuly.API.Security
{
    /// <summary>
    /// Asks for proof before an account is deleted, so a stolen access token alone can't delete it. An account with a password proves it with the password. One signed in
    /// only through single sign-on proves it with a sign-in within <c>ExternalLogin:LinkProofWindow</c>, read off the session's start the way Toamaisutaa reads it for
    /// linking a provider: a token refresh doesn't move it. Attempts are capped by the endpoint's rate limit; the library's own attempt counter isn't reachable from outside it.
    /// </summary>
    public sealed class AccountPasswordCheck(IPasswordCredentialStore credentials, IPasswordHasher hasher, IRefreshTokenStore refreshTokens, IOptions<ToamaisutaaLocalLoginOptions> options, IOptions<ToamaisutaaExternalLoginOptions> externalOptions, SecurityAuditLog audit, TimeProvider time)
    {
        public const string RefusedKind = "account-deletion-refused";

        /// <summary>Null when deletion may go ahead, otherwise the message for the caller.</summary>
        public async Task<string?> RefusalAsync(ClaimsPrincipal user, string? password, CancellationToken cancellationToken = default)
        {
            var subject = user.FindFirst("sub")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!Guid.TryParse(subject, out var loginId))
                return null;

            var credential = await credentials.FindByUserIdAsync(loginId, cancellationToken);
            if (credential is null)
            {
                if (await SignedInRecentlyAsync(user, cancellationToken))
                    return null;

                await audit.WriteAsync(RefusedKind, loginId, null, time.GetUtcNow(), cancellationToken);
                return "To delete your account, sign in again first, then try while that sign-in is fresh.";
            }

            if (string.IsNullOrEmpty(password))
                return "Enter your password to delete your account. If your app doesn't ask for it, update the app.";

            if (credential.LockedOutUntil is { } until && until > time.GetUtcNow())
                return "Too many wrong passwords. Try again later.";

            if (password.Length <= options.Value.MaximumPasswordLength && hasher.Verify(password, credential.PasswordHash) != PasswordVerificationResult.Failed)
                return null;

            await audit.WriteAsync(RefusedKind, loginId, null, time.GetUtcNow(), cancellationToken);
            return "Your password is not correct.";
        }

        private async Task<bool> SignedInRecentlyAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
        {
            DateTimeOffset? at = null;
            if (Guid.TryParse(user.FindFirst(ToamaisutaaDefaults.SessionIdClaim)?.Value, out var family) && await refreshTokens.FindLiveByFamilyAsync(family, cancellationToken) is { } live)
                at = live.FamilyStartedAt;

            foreach (var type in new[] { ToamaisutaaDefaults.SecondFactorAtClaim, "auth_time" })
            {
                if (long.TryParse(user.FindFirst(type)?.Value, out var seconds) && DateTimeOffset.FromUnixTimeSeconds(seconds) is var claimed && (at is null || claimed > at))
                    at = claimed;
            }

            var now = time.GetUtcNow();
            return at is { } signedIn && signedIn <= now && now - signedIn <= externalOptions.Value.LinkProofWindow;
        }
    }
}
