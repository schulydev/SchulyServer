using Schuly.Application.Commands.Notification;
using Schuly.Application.Queries.Notification;
using Schuly.Domain;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class NotificationEndpointTests
    {
        [Test]
        public async Task Registering_the_same_token_twice_upserts_a_single_row_reassigned_to_the_caller()
        {
            var dbName = nameof(Registering_the_same_token_twice_upserts_a_single_row_reassigned_to_the_caller);
            var firstUser = new FakeUserService() { CurrentUserId = Guid.NewGuid() };
            var secondUser = new FakeUserService() { CurrentUserId = Guid.NewGuid() };

            using var ctx = TestDb.NewContext(dbName);

            var firstHandler = new RegisterDeviceTokenCommandHandler(ctx, firstUser);
            var firstResult = await firstHandler.Handle(new RegisterDeviceTokenCommand("token-1", "android", "de"), CancellationToken.None);
            await Assert.That(firstResult.IsSuccess).IsTrue();

            var secondHandler = new RegisterDeviceTokenCommandHandler(ctx, secondUser);
            var secondResult = await secondHandler.Handle(new RegisterDeviceTokenCommand("token-1", "IOS", "EN"), CancellationToken.None);
            await Assert.That(secondResult.IsSuccess).IsTrue();

            var tokens = ctx.DeviceTokens.Where(t => t.Token == "token-1").ToList();
            await Assert.That(tokens.Count).IsEqualTo(1);
            await Assert.That(tokens[0].ApplicationUserId).IsEqualTo(secondUser.CurrentUserId);
            await Assert.That(tokens[0].Platform).IsEqualTo("ios");
            await Assert.That(tokens[0].Locale).IsEqualTo("en");
        }

        [Test]
        public async Task Removing_another_users_token_leaves_it_in_place()
        {
            var dbName = nameof(Removing_another_users_token_leaves_it_in_place);
            var owner = new FakeUserService() { CurrentUserId = Guid.NewGuid() };
            var intruder = new FakeUserService() { CurrentUserId = Guid.NewGuid() };

            using var ctx = TestDb.NewContext(dbName);
            ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = owner.CurrentUserId, Token = "token-1", Platform = "android", Locale = "de", LastSeenAt = DateTime.UtcNow });
            ctx.SaveChanges();

            var handler = new RemoveDeviceTokenCommandHandler(ctx, intruder);
            var result = await handler.Handle(new RemoveDeviceTokenCommand("token-1"), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsTrue();
            await Assert.That(ctx.DeviceTokens.Any(t => t.Token == "token-1")).IsTrue();
        }

        [Test]
        public async Task Get_preferences_returns_defaults_when_the_user_has_no_row()
        {
            var dbName = nameof(Get_preferences_returns_defaults_when_the_user_has_no_row);
            using var ctx = TestDb.NewContext(dbName);
            var user = new FakeUserService() { CurrentUserId = Guid.NewGuid() };

            var handler = new GetNotificationPreferencesQueryHandler(ctx, user);
            var result = await handler.Handle(new GetNotificationPreferencesQuery(), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsTrue();
            await Assert.That(result.Value!.Grades).IsTrue();
            await Assert.That(result.Value!.Absences).IsTrue();
            await Assert.That(result.Value!.Agenda).IsTrue();
            await Assert.That(result.Value!.IncludeGradeValue).IsFalse();
            await Assert.That(result.Value!.IncludeDetails).IsFalse();
            await Assert.That(ctx.NotificationPreferences.Any()).IsFalse();
        }

        [Test]
        public async Task Updating_then_getting_preferences_round_trips()
        {
            var dbName = nameof(Updating_then_getting_preferences_round_trips);
            using var ctx = TestDb.NewContext(dbName);
            var user = new FakeUserService() { CurrentUserId = Guid.NewGuid() };

            var updateHandler = new UpdateNotificationPreferencesCommandHandler(ctx, user);
            var updateResult = await updateHandler.Handle(new UpdateNotificationPreferencesCommand(false, false, true, true, true), CancellationToken.None);
            await Assert.That(updateResult.IsSuccess).IsTrue();

            var getHandler = new GetNotificationPreferencesQueryHandler(ctx, user);
            var getResult = await getHandler.Handle(new GetNotificationPreferencesQuery(), CancellationToken.None);

            await Assert.That(getResult.Value!.Grades).IsFalse();
            await Assert.That(getResult.Value!.Absences).IsFalse();
            await Assert.That(getResult.Value!.Agenda).IsTrue();
            await Assert.That(getResult.Value!.IncludeGradeValue).IsTrue();
            await Assert.That(getResult.Value!.IncludeDetails).IsTrue();
        }

        [Test]
        public async Task Invalid_platform_is_rejected()
        {
            var dbName = nameof(Invalid_platform_is_rejected);
            using var ctx = TestDb.NewContext(dbName);
            var user = new FakeUserService() { CurrentUserId = Guid.NewGuid() };

            var handler = new RegisterDeviceTokenCommandHandler(ctx, user);
            var result = await handler.Handle(new RegisterDeviceTokenCommand("token-1", "windows-phone", "de"), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsFalse();
        }

        [Test]
        public async Task Invalid_locale_is_rejected()
        {
            var dbName = nameof(Invalid_locale_is_rejected);
            using var ctx = TestDb.NewContext(dbName);
            var user = new FakeUserService() { CurrentUserId = Guid.NewGuid() };

            var handler = new RegisterDeviceTokenCommandHandler(ctx, user);
            var result = await handler.Handle(new RegisterDeviceTokenCommand("token-1", "android", "fr"), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsFalse();
        }
    }
}
