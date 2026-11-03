using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Schuly.API.Controllers;
using Schuly.API.Services;
using Schuly.Application.Mappers;
using Schuly.Application.Queries.School;
using Schuly.Domain;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class SchoolLogoTests
    {
        private const string Upstream = "https://icons.duckduckgo.com/ip3/schulnetz.example.ch.ico";

        private sealed class FakeLogoHost(Func<HttpResponseMessage> respond) : HttpMessageHandler, IHttpClientFactory
        {
            public int Requests { get; private set; }

            public HttpClient CreateClient(string name) => new(this, disposeHandler: false);

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                Requests++;
                return Task.FromResult(respond());
            }
        }

        private static HttpResponseMessage Image(string contentType, int size = 10)
        {
            var content = new ByteArrayContent(new byte[size]);
            content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        }

        private static (SchoolLogoProxy Proxy, FakeLogoHost Host) Proxy(Func<HttpResponseMessage> respond)
        {
            var host = new FakeLogoHost(respond);
            return (new SchoolLogoProxy(host, new MemoryCache(Options.Create(new MemoryCacheOptions()))), host);
        }

        [Test]
        public async Task Clients_get_the_server_address_and_never_the_logo_host()
        {
            var id = Guid.NewGuid();
            var dto = new School { Id = id, Name = "S", LogoUrl = Upstream }.ToDto();

            await Assert.That(dto.LogoUrl).IsEqualTo($"/api/schools/{id}/logo");
            await Assert.That(new School { Id = id, Name = "S" }.ToDto().LogoUrl).IsNull();
        }

        [Test]
        public async Task My_schools_list_the_server_address()
        {
            var db = nameof(My_schools_list_the_server_address);
            var schoolId = Guid.NewGuid();
            var student = TestDb.NewSchoolUser(schoolId);
            using (var ctx = TestDb.NewContext(db))
            {
                ctx.Schools.Add(new School { Id = schoolId, Name = "S", LogoUrl = Upstream });
                ctx.SchoolUsers.Add(student);
                await ctx.SaveChangesAsync();
            }

            using var read = TestDb.NewContext(db);
            var result = await new GetMySchoolsQueryHandler(read, new FakeUserService { CurrentUserId = student.ApplicationUserId }, new FakeAvatarUrlSigner()).Handle(new GetMySchoolsQuery(), CancellationToken.None);

            await Assert.That(result.Value!.Single().LogoUrl).IsEqualTo($"/api/schools/{schoolId}/logo");
        }

        [Test]
        public async Task The_logo_route_needs_no_token_because_an_image_request_cannot_send_one()
        {
            var method = typeof(SchoolsController).GetMethod(nameof(SchoolsController.GetSchoolLogo))!;
            await Assert.That(method.GetCustomAttribute<AllowAnonymousAttribute>()).IsNotNull();
        }

        [Test]
        public async Task The_upstream_is_asked_once_and_the_answer_is_cached()
        {
            var (proxy, host) = Proxy(() => Image("image/x-icon"));

            var first = await proxy.GetAsync(Upstream, CancellationToken.None);
            var second = await proxy.GetAsync(Upstream, CancellationToken.None);

            await Assert.That(first!.ContentType).IsEqualTo("image/x-icon");
            await Assert.That(second).IsEqualTo(first);
            await Assert.That(host.Requests).IsEqualTo(1);
        }

        [Test]
        public async Task A_failure_is_cached_too()
        {
            var (proxy, host) = Proxy(() => new HttpResponseMessage(HttpStatusCode.NotFound));

            await Assert.That(await proxy.GetAsync(Upstream, CancellationToken.None)).IsNull();
            await Assert.That(await proxy.GetAsync(Upstream, CancellationToken.None)).IsNull();
            await Assert.That(host.Requests).IsEqualTo(1);
        }

        [Test]
        public async Task Svg_html_oversized_and_non_https_logos_are_refused()
        {
            await Assert.That(await Proxy(() => Image("image/svg+xml")).Proxy.GetAsync(Upstream, CancellationToken.None)).IsNull();
            await Assert.That(await Proxy(() => Image("text/html")).Proxy.GetAsync(Upstream, CancellationToken.None)).IsNull();
            await Assert.That(await Proxy(() => Image("image/png", SchoolLogoProxy.MaxBytes + 1)).Proxy.GetAsync(Upstream, CancellationToken.None)).IsNull();

            var (proxy, host) = Proxy(() => Image("image/png"));
            await Assert.That(await proxy.GetAsync("http://internal/logo.png", CancellationToken.None)).IsNull();
            await Assert.That(host.Requests).IsEqualTo(0);
        }

        [Test]
        [Arguments("127.0.0.1", true)]
        [Arguments("10.1.2.3", true)]
        [Arguments("172.20.0.5", true)]
        [Arguments("192.168.1.1", true)]
        [Arguments("169.254.169.254", true)]
        [Arguments("100.64.0.1", true)]
        [Arguments("::1", true)]
        [Arguments("fd00::1", true)]
        [Arguments("::ffff:10.0.0.1", true)]
        [Arguments("8.8.8.8", false)]
        [Arguments("2606:4700::1111", false)]
        public async Task Private_addresses_are_recognised(string address, bool isPrivate)
        {
            await Assert.That(NetworkAddresses.IsPrivate(IPAddress.Parse(address))).IsEqualTo(isPrivate);
        }
    }
}
