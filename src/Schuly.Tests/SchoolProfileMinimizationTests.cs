using Microsoft.EntityFrameworkCore;
using Schuly.Application.Dtos;
using Schuly.Domain;
using Schuly.Infrastructure.Plugins;
using Schuly.Plugin.Abstractions;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class SchoolProfileMinimizationTests
    {
        private static readonly string[] Dropped = ["PrivateEmail", "PhoneNumber", "Street", "City", "Zip", "Birthday"];

        [Test]
        public async Task The_school_user_has_no_private_contact_fields()
        {
            using var ctx = TestDb.NewContext(nameof(The_school_user_has_no_private_contact_fields));
            var columns = ctx.Model.FindEntityType(typeof(SchoolUser))!.GetProperties().Select(p => p.Name).ToList();

            await Assert.That(columns.Intersect(Dropped)).IsEmpty();
            await Assert.That(typeof(SchoolUserDto).GetProperties().Select(p => p.Name).Intersect(Dropped)).IsEmpty();
        }
    }
}
