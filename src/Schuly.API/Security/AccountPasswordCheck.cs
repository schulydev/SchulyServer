using System.Security.Claims;
using Microsoft.Extensions.Options;
using Schuly.Infrastructure.Security;
using Toamaisutaa.Abstractions;

namespace Schuly.API.Security
{
    /// <summary>
    /// Asks for the password again before an account is deleted, so a stolen access token alone can't delete it. An account signed in only through single sign-on has no
    /// password to ask for and passes. Attempts are capped by the endpoint's rate limit; the library's own attempt counter isn't reachable from outside it.
    /// </summary>
    public sealed class AccountPasswordCheck(IPasswordCredentialStore credentials, IPasswordHasher hasher, IOptions<ToamaisutaaLocalLoginOptions> options, SecurityAuditLog audit)
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
                return null;

            if (string.IsNullOrEmpty(password))
                return "Enter your password to delete your account. If your app doesn't ask for it, update the app.";

            if (credential.LockedOutUntil is { } until && until > DateTimeOffset.UtcNow)
                return "Too many wrong passwords. Try again later.";

            if (password.Length <= options.Value.MaximumPasswordLength && hasher.Verify(password, credential.PasswordHash) != PasswordVerificationResult.Failed)
                return null;

            await audit.WriteAsync(RefusedKind, loginId, null, DateTimeOffset.UtcNow, cancellationToken);
            return "Your password is not correct.";
        }
    }
}
