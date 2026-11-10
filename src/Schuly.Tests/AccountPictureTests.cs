using System.Net;
using Schuly.Application.Queries.Avatar;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Schuly.Domain;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Plugins;
using Schuly.Infrastructure.Services;
using Schuly.Plugin.Abstractions;
using Schuly.Plugin.Abstractions.Linking;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class AccountPictureTests
    {
        private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 16];
        private static readonly LinkedAccountRecord Alex = new(LinkedProviders.Microsoft, "oid-1", "alex@school.ch", "Alex");

        private static Guid NewUser(SchulyDbContext ctx)
        {
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = Guid.NewGuid().ToString(), Email = "user@schuly.dev" };
            ctx.ApplicationUsers.Add(user);
            ctx.SaveChanges();
            return user.Id;
        }

        private static (LinkedAccountStore Store, InMemoryDocumentStorage Storage) NewStore(SchulyDbContext ctx)
        {
            var storage = new InMemoryDocumentStorage();
            return (new LinkedAccountStore(ctx, TestVault.Factory(), storage), storage);
        }

        [Test]
        public async Task A_picture_is_stored_typed_by_its_bytes_and_replacing_it_deletes_the_old_one()
        {
            using var ctx = TestDb.NewContext(nameof(A_picture_is_stored_typed_by_its_bytes_and_replacing_it_deletes_the_old_one));
            var (store, storage) = NewStore(ctx);
            var user = NewUser(ctx);
            var account = await store.SaveAsync(user, Alex);

            await Assert.That(await store.SetPictureAsync(user, account.Id, new MemoryStream(Png), "image/jpeg")).IsTrue();
            var first = ctx.LinkedAccounts.Single().PictureKey!;
            await Assert.That(storage.ContentTypes[first]).IsEqualTo("image/png");

            await Assert.That(await store.SetPictureAsync(user, account.Id, new MemoryStream(Jpeg), null)).IsTrue();
            var second = ctx.LinkedAccounts.Single().PictureKey!;
            await Assert.That(second).IsNotEqualTo(first);
            await Assert.That(storage.ContentTypes[second]).IsEqualTo("image/jpeg");
            await Assert.That(storage.Objects.ContainsKey(first)).IsFalse();
        }

        [Test]
        public async Task Anything_but_a_small_picture_is_refused()
        {
            using var ctx = TestDb.NewContext(nameof(Anything_but_a_small_picture_is_refused));
            var (store, storage) = NewStore(ctx);
            var user = NewUser(ctx);
            var account = await store.SaveAsync(user, Alex);

            await Assert.That(await store.SetPictureAsync(user, account.Id, new MemoryStream("<svg onload=alert(1)>"u8.ToArray()), "image/png")).IsFalse();
            await Assert.That(await store.SetPictureAsync(user, account.Id, new MemoryStream([]), "image/png")).IsFalse();
            var huge = new byte[LinkedAccountStore.MaxPictureBytes + 1];
            Png.CopyTo(huge, 0);
            await Assert.That(await store.SetPictureAsync(user, account.Id, new MemoryStream(huge), "image/png")).IsFalse();

            await Assert.That(ctx.LinkedAccounts.Single().PictureKey).IsNull();
            await Assert.That(storage.Objects.Count).IsEqualTo(0);
        }

        [Test]
        public async Task Another_user_cannot_set_the_picture_and_a_host_without_storage_refuses()
        {
            using var ctx = TestDb.NewContext(nameof(Another_user_cannot_set_the_picture_and_a_host_without_storage_refuses));
            var (store, storage) = NewStore(ctx);
            var owner = NewUser(ctx);
            var other = NewUser(ctx);
            var account = await store.SaveAsync(owner, Alex);

            await Assert.That(await store.SetPictureAsync(other, account.Id, new MemoryStream(Png), "image/png")).IsFalse();
            await Assert.That(await new LinkedAccountStore(ctx, TestVault.Factory()).SetPictureAsync(owner, account.Id, new MemoryStream(Png), "image/png")).IsFalse();
            await Assert.That(storage.Objects.Count).IsEqualTo(0);
        }

        [Test]
        public async Task Clearing_the_picture_or_unlinking_the_account_deletes_it()
        {
            using var ctx = TestDb.NewContext(nameof(Clearing_the_picture_or_unlinking_the_account_deletes_it));
            var (store, storage) = NewStore(ctx);
            var user = NewUser(ctx);
            var account = await store.SaveAsync(user, Alex);

            await store.SetPictureAsync(user, account.Id, new MemoryStream(Png), "image/png");
            await Assert.That(await store.SetPictureAsync(user, account.Id, null, null)).IsTrue();
            await Assert.That(ctx.LinkedAccounts.Single().PictureKey).IsNull();
            await Assert.That(storage.Objects.Count).IsEqualTo(0);

            await store.SetPictureAsync(user, account.Id, new MemoryStream(Png), "image/png");
            await Assert.That(storage.Objects.Count).IsEqualTo(1);
            await Assert.That(await store.RemoveAsync(user, account.Id)).IsTrue();
            await Assert.That(storage.Objects.Count).IsEqualTo(0);
        }

        [Test]
        public async Task Account_picture_urls_never_point_outside_the_api()
        {
            var urls = new AvatarUrlSigner();
            var id = Guid.NewGuid();

            await Assert.That(urls.ToPublicAccountUrl(id, null)).IsNull();
            await Assert.That(urls.ToPublicAccountUrl(id, "https://example.com/a.png")).IsNull();
            await Assert.That(urls.ToPublicAccountUrl(id, "0123456789abcdef0123456789abcdef/account-picture.png")!).StartsWith($"/api/avatars/accounts/{id}?v=");
        }

        [Test]
        public async Task Every_picture_is_served_only_to_its_owner()
        {
            using var ctx = TestDb.NewContext(nameof(Every_picture_is_served_only_to_its_owner));
            var (store, storage) = NewStore(ctx);
            var owner = NewUser(ctx);
            var other = NewUser(ctx);
            var account = await store.SaveAsync(owner, Alex);
            await store.SetPictureAsync(owner, account.Id, new MemoryStream(Png), "image/png");
            var picture = ctx.LinkedAccounts.Single().PictureKey!;
            var student = TestDb.NewSchoolUser(Guid.NewGuid());
            student.ApplicationUserId = owner;
            student.ProfilePictureUrl = picture;
            ctx.SchoolUsers.Add(student);
            ctx.ApplicationUsers.Single(u => u.Id == owner).ProfilePictureUrl = picture;
            await ctx.SaveChangesAsync();

            async Task<(bool Account, bool Student, bool User)> As(Guid caller)
            {
                var users = new FakeUserService { CurrentUserId = caller };
                return (
                    (await new GetLinkedAccountAvatarQueryHandler(ctx, storage, users).Handle(new GetLinkedAccountAvatarQuery(account.Id), default)).IsSuccess,
                    (await new GetAvatarQueryHandler(ctx, storage, users).Handle(new GetAvatarQuery(student.Id), default)).IsSuccess,
                    (await new GetUserAvatarQueryHandler(ctx, storage, users).Handle(new GetUserAvatarQuery(owner), default)).IsSuccess);
            }

            await Assert.That(await As(owner)).IsEqualTo((true, true, true));
            await Assert.That(await As(other)).IsEqualTo((false, false, false));
        }

        [Test]
        public async Task The_avatar_routes_are_not_anonymous()
        {
            var anonymous = typeof(API.Controllers.AvatarsController).GetMethods()
                .Where(m => m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true).Length > 0)
                .Select(m => m.Name)
                .ToList();

            await Assert.That(anonymous).IsEmpty();
            await Assert.That(typeof(API.Controllers.AvatarsController).GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true)).IsEmpty();
        }

        [Test]
        public async Task Avatar_routes_answer_401_without_a_sign_in()
        {
            await using var host = await LinkingTestHost.StartAsync();
            var id = Guid.NewGuid();

            foreach (var path in new[] { $"/api/avatars/{id}", $"/api/avatars/users/{id}", $"/api/avatars/accounts/{id}", $"/api/avatars/{id}?exp=9999999999&sig=abc" })
                await Assert.That((await host.Send(HttpMethod.Get, path, null)).StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
        }

        [Test]
        public async Task The_accounts_list_shows_only_the_owners_own_pictures()
        {
            var dbName = Guid.NewGuid().ToString();
            var provider = new ScriptedLinkProvider();
            await using var host = await LinkingTestHost.StartAsync(services =>
            {
                services.AddScoped(_ => TestDb.NewContext(dbName));
                services.AddSingleton<IAvatarUrlSigner, FakeAvatarUrlSigner>();
                services.AddScoped<AccountPictureUrls>();
            }, provider);

            var school = Guid.NewGuid();
            using var ctx = TestDb.NewContext(dbName);
            var mine = TestDb.NewSchoolUser(school, "Mine");
            mine.ApplicationUserId = host.UserA;
            mine.ProfilePictureUrl = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/avatar.png";
            var theirs = TestDb.NewSchoolUser(school, "Theirs");
            theirs.ApplicationUserId = host.UserB;
            theirs.ProfilePictureUrl = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/avatar.png";
            ctx.SchoolUsers.AddRange(mine, theirs);
            var microsoft = new Domain.LinkedAccount { Id = Guid.NewGuid(), ApplicationUserId = host.UserA, Provider = LinkedProviders.Microsoft, ExternalId = "oid", Email = "a@school.ch", PictureKey = "cccccccccccccccccccccccccccccccc/account-picture.jpg" };
            var foreign = new Domain.LinkedAccount { Id = Guid.NewGuid(), ApplicationUserId = host.UserB, Provider = LinkedProviders.Microsoft, ExternalId = "oid2", Email = "b@school.ch", PictureKey = "dddddddddddddddddddddddddddddddd/account-picture.jpg" };
            ctx.LinkedAccounts.AddRange(microsoft, foreign);
            await ctx.SaveChangesAsync();

            provider.OnList = _ =>
            [
                new LinkedAccountSummary("school", "School", null, LinkedAccountStatus.Ok, null, null) { SchoolUserId = mine.Id },
                new LinkedAccountSummary("ms", "Microsoft", null, LinkedAccountStatus.Ok, null, null) { LinkedAccountId = microsoft.Id },
                new LinkedAccountSummary("stolen-school", "X", null, LinkedAccountStatus.Ok, null, null) { SchoolUserId = theirs.Id },
                new LinkedAccountSummary("stolen-ms", "Y", null, LinkedAccountStatus.Ok, null, null) { LinkedAccountId = foreign.Id },
                new LinkedAccountSummary("plain", "Z", null, LinkedAccountStatus.Ok, null, null),
            ];

            var (response, json) = await host.Json(HttpMethod.Get, "/api/linking/accounts", host.UserA);
            await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.OK);
            var pictures = json.EnumerateArray().ToDictionary(a => a.GetProperty("id").GetString()!, a => a.TryGetProperty("pictureUrl", out var p) ? p.GetString() : null);

            await Assert.That(pictures["school"]).IsEqualTo(mine.ProfilePictureUrl);
            await Assert.That(pictures["ms"]).IsEqualTo($"/api/avatars/accounts/{microsoft.Id}");
            await Assert.That(pictures["stolen-school"]).IsNull();
            await Assert.That(pictures["stolen-ms"]).IsNull();
            await Assert.That(pictures["plain"]).IsNull();
        }

        [Test]
        public async Task Purging_the_user_deletes_the_linked_account_pictures()
        {
            using var ctx = TestDb.NewContext(nameof(Purging_the_user_deletes_the_linked_account_pictures));
            var (store, storage) = NewStore(ctx);
            var user = NewUser(ctx);
            var account = await store.SaveAsync(user, Alex);
            await store.SetPictureAsync(user, account.Id, new MemoryStream(Png), "image/png");

            var purger = new AccountPurger(ctx, storage, TestVault.Factory(), NullPluginUserDataPurger.Instance, NullLogger<AccountPurger>.Instance);
            await purger.PurgeApplicationUserAsync(user);

            await Assert.That(storage.Objects.Count).IsEqualTo(0);
            await Assert.That(ctx.LinkedAccounts.Count()).IsEqualTo(0);
        }
    }
}
