using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;

namespace Schuly.Tests.TestHelpers
{
    public static class TestDb
    {
        public static SchulyDbContext NewContext(string name) =>
            new(new DbContextOptionsBuilder<SchulyDbContext>()
                .UseInMemoryDatabase(name)
                .Options);

        public static SchulyDbContext NewNotifyingContext(string name, bool userInitiated = false)
        {
            var origin = new FakeNotificationOriginContext(userInitiated);
            var interceptor = new NotificationOutboxInterceptor(origin, NullLogger<NotificationOutboxInterceptor>.Instance);

            return new SchulyDbContext(new DbContextOptionsBuilder<SchulyDbContext>()
                .UseInMemoryDatabase(name)
                .AddInterceptors(interceptor)
                .Options);
        }

        public static SchoolUser NewSchoolUser(Guid schoolId, string last = "Doe") => new()
        {
            Id = Guid.NewGuid(),
            ApplicationUserId = Guid.NewGuid(),
            SchoolId = schoolId,
            FirstName = "Test",
            LastName = last,
            Email = $"{last}@example.com",
            EntryDate = new DateOnly(2020, 1, 1),
            Role = Roles.Student,
        };
    }
}
