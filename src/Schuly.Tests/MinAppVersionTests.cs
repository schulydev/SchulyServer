using Microsoft.Extensions.Configuration;
using Schuly.Application.Queries.App;

namespace Schuly.Tests
{
    public class MinAppVersionTests
    {
        private static string? Min(string? value) =>
            AppQueryHandler.MinAppVersion(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["App:MinVersion"] = value }).Build());

        [Test]
        [Arguments("3.6.0", "3.6.0")]
        [Arguments(" 3.6.0 ", "3.6.0")]
        [Arguments(null, AppQueryHandler.DefaultMinAppVersion)]
        [Arguments("", AppQueryHandler.DefaultMinAppVersion)]
        [Arguments("latest", AppQueryHandler.DefaultMinAppVersion)]
        public async Task ReadsOnlyARealVersion(string? configured, string? expected) => await Assert.That(Min(configured)).IsEqualTo(expected);
    }
}

namespace Schuly.Tests
{
    using Microsoft.AspNetCore.Http;
    using Schuly.API.AppVersion;

    public class AppVersionGateTests
    {
        private static string? Gate(string path, string? sent, string? min = "3.6.0")
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["App:MinVersion"] = min }).Build();
            var context = new DefaultHttpContext();
            context.Request.Path = path;
            if (sent is not null) context.Request.Headers[AppVersionGate.Header] = sent;
            return AppVersionGate.IsTooOld(context.Request, config);
        }

        [Test]
        [Arguments("/api/grades", "3.5.0", "3.6.0")]
        [Arguments("/auth/login", "3.5.9", "3.6.0")]
        [Arguments("/api/app/school-systems", "3.5.0", "3.6.0")]
        [Arguments("/api/grades", "3.6.0", null)]
        [Arguments("/api/grades", "3.7.0-beta+3", null)]
        [Arguments("/api/grades", null, null)]
        [Arguments("/api/grades", "garbage", null)]
        [Arguments("/api/app", "1.0.0", null)]
        [Arguments("/index.html", "1.0.0", null)]
        public async Task BlocksOnlyOlderApps(string path, string? sent, string? expected) => await Assert.That(Gate(path, sent)).IsEqualTo(expected);

        [Test]
        public async Task ZeroBlocksNothing() => await Assert.That(Gate("/api/grades", "0.1.0", min: "0.0.0")).IsNull();

        [Test]
        public async Task UnsetUsesTheCodedMinimum() => await Assert.That(Gate("/api/grades", "3.4.0", min: null)).IsEqualTo(AppQueryHandler.DefaultMinAppVersion);
    }
}
