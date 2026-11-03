using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Vault;

namespace Schuly.Tests.TestHelpers
{
    public static class SensitiveTextSetup
    {
        [Before(Assembly)]
        public static void UseEphemeralKey() => SensitiveText.UseKeyring(VaultKeyring.Ephemeral());
    }
}
