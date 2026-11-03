using Microsoft.EntityFrameworkCore;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Seeding;
using Schuly.Infrastructure.Services;

namespace Schuly.API.Extensions
{
    public static class MigrationExtensions
    {
        public static WebApplication ApplyMigrations(this WebApplication app)
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            db.Database.Migrate();
            return app;
        }

        /// <summary>A failure here only leaves old rows in plain text, as they were before. The next start tries again.</summary>
        public static async Task<WebApplication> EncryptSensitiveTextAsync(this WebApplication app)
        {
            using var scope = app.Services.CreateScope();
            var backfill = ActivatorUtilities.CreateInstance<SensitiveTextBackfill>(scope.ServiceProvider);
            try
            {
                await backfill.RunAsync();
            }
            catch (Exception ex)
            {
                scope.ServiceProvider.GetRequiredService<ILogger<SensitiveTextBackfill>>().LogError("Encrypting stored absence reasons failed ({ExceptionType}); some stay in plain text until the next start.", ex.GetType().Name);
            }
            return app;
        }

        public static async Task<WebApplication> SeedSchoolSystemsAsync(this WebApplication app)
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchulyDbContext>();
            var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            await SchoolSystemSeeder.SeedAsync(db, configuration);
            return app;
        }
    }
}
