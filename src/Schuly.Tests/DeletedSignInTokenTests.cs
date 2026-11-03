using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Schuly.API.Extensions;
using Schuly.Application.Commands.User;
using Schuly.Domain;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Tests.TestHelpers;
using Toamaisutaa.Abstractions;

namespace Schuly.Tests
{
    public class DeletedSignInTokenTests
    {
        private const string Key = "a-test-signing-key-that-is-long-enough-for-hmac-sha256";

        private static async Task<(WebApplication App, FakeUserStore SignIns, string Database)> StartAsync(Guid signedInAs, bool signInExists)
        {
            var database = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            var signIns = new FakeUserStore();
            if (signInExists)
                signIns.Existing.Add(signedInAs);
            builder.Services.AddSingleton<IUserStore>(signIns);
            builder.Services.AddDbContext<SchulyDbContext>(o => o.UseInMemoryDatabase(database));
            builder.Services.AddScoped<IOidcService>(_ => new FakeOidcService(signedInAs.ToString()));
            builder.Services.AddScoped<IUserService, UserService>();
            builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
            {
                o.MapInboundClaims = false;
                o.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = false, ValidateAudience = false, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key)) };
            }).AddUserSync();
            builder.Services.AddAuthorization(o => o.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapGet("/api/ping", () => "pong");
            await app.StartAsync();
            return (app, signIns, database);
        }

        private static async Task<HttpStatusCode> PingAsync(WebApplication app, Guid subject)
        {
            var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(claims: [new("sub", subject.ToString())], expires: DateTime.UtcNow.AddMinutes(15), signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key)), SecurityAlgorithms.HmacSha256)));
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/ping");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return (await app.GetTestClient().SendAsync(request)).StatusCode;
        }

        private static SchulyDbContext Db(WebApplication app) => app.Services.CreateScope().ServiceProvider.GetRequiredService<SchulyDbContext>();

        [Test]
        public async Task A_token_whose_sign_in_is_gone_is_refused_and_does_not_recreate_the_user()
        {
            var subject = Guid.CreateVersion7();
            var (app, _, _) = await StartAsync(subject, signInExists: false);
            await using var _app = app;

            await Assert.That(await PingAsync(app, subject)).IsEqualTo(HttpStatusCode.Unauthorized);
            await Assert.That(await Db(app).ApplicationUsers.AnyAsync()).IsFalse();
        }

        [Test]
        public async Task A_token_whose_sign_in_is_gone_is_refused_even_while_the_user_row_exists()
        {
            var subject = Guid.CreateVersion7();
            var (app, _, _) = await StartAsync(subject, signInExists: false);
            await using var _app = app;
            var db = Db(app);
            db.ApplicationUsers.Add(new ApplicationUser { Id = Guid.NewGuid(), ExternalId = subject.ToString(), Email = "u@example.com" });
            await db.SaveChangesAsync();

            await Assert.That(await PingAsync(app, subject)).IsEqualTo(HttpStatusCode.Unauthorized);
        }

        [Test]
        public async Task The_first_request_of_a_new_sign_in_still_creates_the_user()
        {
            var subject = Guid.CreateVersion7();
            var (app, _, _) = await StartAsync(subject, signInExists: true);
            await using var _app = app;

            await Assert.That(await PingAsync(app, subject)).IsEqualTo(HttpStatusCode.OK);
            await Assert.That(await Db(app).ApplicationUsers.CountAsync(u => u.ExternalId == subject.ToString())).IsEqualTo(1);
        }

        [Test]
        public async Task Deleting_the_account_removes_the_sign_in_before_the_purge()
        {
            using var db = TestDb.NewContext(Guid.NewGuid().ToString());
            var loginId = Guid.CreateVersion7();
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = loginId.ToString(), Email = "u@example.com" };
            db.ApplicationUsers.Add(user);
            await db.SaveChangesAsync();

            var store = new FakeUserStore();
            store.Existing.Add(loginId);
            var userRowDuringDelete = false;
            store.OnDelete = () => userRowDuringDelete = db.ApplicationUsers.Any(u => u.Id == user.Id);
            var purger = new AccountPurger(db, new FakeDocumentStorage(), TestVault.Factory(), NullPluginUserDataPurger.Instance, Microsoft.Extensions.Logging.Abstractions.NullLogger<AccountPurger>.Instance);

            var result = await new DeleteCurrentUserCommandHandler(db, new FakeUserService { CurrentUserId = user.Id }, purger, store).Handle(new DeleteCurrentUserCommand(), default);

            await Assert.That(result.IsSuccess).IsTrue();
            await Assert.That(userRowDuringDelete).IsTrue();
            await Assert.That(store.Deleted).Contains(loginId);
            await Assert.That(db.ApplicationUsers.Any(u => u.Id == user.Id)).IsFalse();
        }
    }
}
