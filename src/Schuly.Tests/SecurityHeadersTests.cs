using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Schuly.API.Extensions;

namespace Schuly.Tests
{
    public class SecurityHeadersTests
    {
        private static async Task<HttpResponseMessage> GetAsync(string baseAddress, string path)
        {
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            var app = builder.Build();
            app.UseMiddleware<SecurityHeaders>();
            app.MapGet("/plain", () => "ok");
            app.MapGet("/strict", (HttpContext context) =>
            {
                context.Response.Headers.XFrameOptions = "SAMEORIGIN";
                return "ok";
            });
            await app.StartAsync();
            var client = app.GetTestClient();
            client.BaseAddress = new Uri(baseAddress);
            return await client.GetAsync(path);
        }

        private static string Header(HttpResponseMessage response, string name) => response.Headers.TryGetValues(name, out var values) ? values.Single() : "";

        [Test]
        public async Task Every_response_gets_the_headers_and_chats_keep_the_camera_and_microphone()
        {
            var response = await GetAsync("https://schuly.test", "/plain");
            await Assert.That(Header(response, "Strict-Transport-Security")).IsEqualTo("max-age=31536000");
            await Assert.That(Header(response, "X-Content-Type-Options")).IsEqualTo("nosniff");
            await Assert.That(Header(response, "X-Frame-Options")).IsEqualTo("DENY");
            await Assert.That(Header(response, "Referrer-Policy")).IsEqualTo("same-origin");
            await Assert.That(Header(response, "Permissions-Policy")).IsEqualTo("camera=(self), microphone=(self), geolocation=()");
            await Assert.That(Header(response, "Content-Security-Policy-Report-Only")).Contains("frame-ancestors 'none'");
        }

        [Test]
        public async Task Plain_http_gets_no_HSTS()
        {
            var response = await GetAsync("http://schuly.test", "/plain");
            await Assert.That(Header(response, "Strict-Transport-Security")).IsEqualTo("");
            await Assert.That(Header(response, "X-Content-Type-Options")).IsEqualTo("nosniff");
        }

        [Test]
        public async Task A_header_the_response_set_itself_is_kept()
        {
            var response = await GetAsync("https://schuly.test", "/strict");
            await Assert.That(Header(response, "X-Frame-Options")).IsEqualTo("SAMEORIGIN");
        }
    }
}
