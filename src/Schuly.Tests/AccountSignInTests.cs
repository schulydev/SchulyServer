using Schuly.Application.Commands.User;
using Schuly.Domain;
using Schuly.Infrastructure.Services;
using Schuly.Tests.TestHelpers;
using Toamaisutaa.Abstractions;

namespace Schuly.Tests
{
    public class AccountSignInTests
    {
        [Test]
        public async Task Avatar_upload_replaces_the_previous_picture()
        {
            var db = TestDb.NewContext(Guid.NewGuid().ToString());
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext", Email = "u@example.com" };
            db.ApplicationUsers.Add(user);
            await db.SaveChangesAsync();
            var storage = new InMemoryDocumentStorage();
            var handler = new SetMyAvatarCommandHandler(db, new FakeUserService() { CurrentUserId = user.Id }, storage);

            await handler.Handle(new SetMyAvatarCommand(new MemoryStream([1, 2, 3]), "image/png", 3), default);
            var first = user.ProfilePictureUrl;
            var result = await handler.Handle(new SetMyAvatarCommand(new MemoryStream([4, 5]), "image/jpeg", 2), default);

            await Assert.That(result.IsSuccess).IsTrue();
            await Assert.That(user.ProfilePictureUrl).IsNotEqualTo(first);
            await Assert.That(storage.Objects.Keys).DoesNotContain(first!);
            await Assert.That(storage.Objects[user.ProfilePictureUrl!]).IsEquivalentTo(new byte[] { 4, 5 });
        }

        [Test]
        public async Task Avatar_upload_refuses_large_files_and_other_types()
        {
            var db = TestDb.NewContext(Guid.NewGuid().ToString());
            var user = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext", Email = "u@example.com" };
            db.ApplicationUsers.Add(user);
            await db.SaveChangesAsync();
            var storage = new InMemoryDocumentStorage();
            var handler = new SetMyAvatarCommandHandler(db, new FakeUserService() { CurrentUserId = user.Id }, storage);

            var tooLarge = await handler.Handle(new SetMyAvatarCommand(new MemoryStream([1]), "image/png", SetMyAvatarCommandHandler.MaxBytes + 1), default);
            var notAnImage = await handler.Handle(new SetMyAvatarCommand(new MemoryStream([1]), "image/svg+xml", 1), default);

            await Assert.That(tooLarge.IsSuccess).IsFalse();
            await Assert.That(notAnImage.IsSuccess).IsFalse();
            await Assert.That(storage.Objects).IsEmpty();
            await Assert.That(user.ProfilePictureUrl).IsNull();
        }

        [Test]
        public async Task Avatar_urls_are_plain_api_paths_that_change_with_the_picture()
        {
            var urls = new AvatarUrlSigner();
            var id = Guid.NewGuid();

            var first = urls.ToPublicUserUrl(id, "avatars/key")!;
            var second = urls.ToPublicUserUrl(id, "avatars/other")!;

            await Assert.That(first).StartsWith($"/api/avatars/users/{id}?v=");
            await Assert.That(first).DoesNotContain("sig=");
            await Assert.That(second).IsNotEqualTo(first);
            await Assert.That(urls.ToPublicUrl(id, "avatars/key")!).StartsWith($"/api/avatars/{id}?v=");
            await Assert.That(urls.ToPublicUserUrl(id, null)).IsNull();
        }
    }
}
