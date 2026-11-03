using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Schuly.API.SignUp;
using Toamaisutaa.Abstractions;

namespace Schuly.Tests
{
    public class SwissSignUpGateTests
    {
        [Test]
        [Arguments("true", false)]
        [Arguments("false", true)]
        public async Task Provider_sign_up_is_off_only_when_limited(string switzerlandOnly, bool expected)
        {
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["SignUp:SwitzerlandOnly"] = switzerlandOnly }).Build();
            var services = new ServiceCollection();
            services.Configure<ToamaisutaaExternalLoginOptions>(options => options.Providers["google"] = new ToamaisutaaExternalProviderOptions { AllowSignUp = true });
            services.AddSwissExternalSignUpLimit(configuration);

            var options = services.BuildServiceProvider().GetRequiredService<IOptions<ToamaisutaaExternalLoginOptions>>().Value;

            await Assert.That(options.Providers["google"].AllowSignUp).IsEqualTo(expected);
        }

        private const string Swiss = "85.0.0.1";
        private const string SwissV6 = "2a02:1200::1";
        private const string German = "80.187.0.1";

        private static async Task<(bool Passed, int Status)> Run(string method, string path, string ip)
        {
            var passed = false;
            var gate = new SwissSignUpGate(_ => { passed = true; return Task.CompletedTask; });
            var context = new DefaultHttpContext();
            context.Request.Method = method;
            context.Request.Path = path;
            context.Connection.RemoteIpAddress = IPAddress.Parse(ip);
            context.Response.Body = new MemoryStream();
            await gate.InvokeAsync(context);
            return (passed, context.Response.StatusCode);
        }

        [Test]
        [Arguments(Swiss)]
        [Arguments(SwissV6)]
        public async Task Swiss_address_can_register(string ip)
        {
            var (passed, _) = await Run("POST", "/auth/register", ip);
            await Assert.That(passed).IsTrue();
        }

        [Test]
        public async Task Swiss_address_mapped_to_ipv6_can_register()
        {
            var (passed, _) = await Run("POST", "/auth/register", $"::ffff:{Swiss}");
            await Assert.That(passed).IsTrue();
        }

        [Test]
        [Arguments(German)]
        [Arguments("8.8.8.8")]
        [Arguments("2001:4860:4860::8888")]
        [Arguments("172.18.0.5")]
        public async Task Other_address_cannot_register(string ip)
        {
            var (passed, status) = await Run("POST", "/AUTH/register", ip);
            await Assert.That(passed).IsFalse();
            await Assert.That(status).IsEqualTo(StatusCodes.Status403Forbidden);
        }

        [Test]
        [Arguments("POST", "/auth/login")]
        [Arguments("POST", "/auth/refresh")]
        [Arguments("GET", "/api/me")]
        public async Task Existing_accounts_keep_working_abroad(string method, string path)
        {
            var (passed, _) = await Run(method, path, German);
            await Assert.That(passed).IsTrue();
        }
    }
}
