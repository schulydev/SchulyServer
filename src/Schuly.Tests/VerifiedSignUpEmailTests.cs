using Microsoft.Extensions.Configuration;
using Schuly.API.SignUp;

namespace Schuly.Tests
{
    public class VerifiedSignUpEmailTests
    {
        private static ConfigurationManager Config(params (string Key, string Value)[] values)
        {
            var configuration = new ConfigurationManager();
            configuration.AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value));
            return configuration;
        }

        [Test]
        public async Task Every_provider_needs_a_verified_email_to_sign_up_unless_the_hoster_says_otherwise()
        {
            var configuration = Config(
                ("ExternalLogin:Providers:google:Authority", "https://accounts.google.com"),
                ("ExternalLogin:Providers:school:Authority", "https://idp.school.example"),
                ("ExternalLogin:Providers:school:RequireVerifiedEmailForSignUp", "false"));

            VerifiedSignUpEmail.Apply(configuration);

            await Assert.That(configuration["ExternalLogin:Providers:google:RequireVerifiedEmailForSignUp"]).IsEqualTo("true");
            await Assert.That(configuration["ExternalLogin:Providers:school:RequireVerifiedEmailForSignUp"]).IsEqualTo("false");
        }

        [Test]
        public async Task No_providers_adds_nothing()
        {
            await Assert.That(VerifiedSignUpEmail.Defaults(Config()).Count).IsEqualTo(0);
        }
    }
}
