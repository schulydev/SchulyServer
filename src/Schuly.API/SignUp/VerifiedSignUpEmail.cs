namespace Schuly.API.SignUp
{
    /// <summary>
    /// A Schuly account has to have a confirmed email before it can be used. An account made by signing up through a provider has no local address to confirm with a code, so
    /// the provider's <c>email_verified</c> is the proof: every configured provider gets <c>RequireVerifiedEmailForSignUp</c> unless the hoster set it. Set through
    /// configuration rather than the options type, so this compiles against a Toamaisutaa that predates the option and simply does nothing there.
    /// </summary>
    public static class VerifiedSignUpEmail
    {
        public const string Setting = "RequireVerifiedEmailForSignUp";

        /// <summary>The keys to add: one per provider that doesn't say for itself.</summary>
        public static Dictionary<string, string?> Defaults(IConfiguration configuration) =>
            configuration.GetSection("ExternalLogin:Providers").GetChildren()
                .Where(provider => provider[Setting] is null)
                .ToDictionary(provider => $"{provider.Path}:{Setting}", _ => (string?)"true");

        public static void Apply(IConfiguration configuration)
        {
            if (configuration is IConfigurationBuilder builder && Defaults(configuration) is { Count: > 0 } defaults)
                builder.AddInMemoryCollection(defaults);
        }
    }
}
