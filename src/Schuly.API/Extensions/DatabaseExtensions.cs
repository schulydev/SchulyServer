using Microsoft.EntityFrameworkCore;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;

namespace Schuly.API.Extensions
{
    public static class DatabaseExtensions
    {
        public static IServiceCollection AddSchulyDatabase(this IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<INotificationOriginContext, NotificationOriginContext>();
            services.AddScoped<NotificationOutboxInterceptor>();

            services.AddDbContext<SchulyDbContext>((sp, options) =>
                options.UseNpgsql(
                    configuration.GetConnectionString("SchulyDatabase"),
                    npgsqlOptions => npgsqlOptions
                        .UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery)
                        .EnableRetryOnFailure(
                            maxRetryCount: 5,
                            maxRetryDelay: TimeSpan.FromSeconds(10),
                            errorCodesToAdd: null
                        )
                ).AddInterceptors(sp.GetRequiredService<NotificationOutboxInterceptor>()));
            return services;
        }
    }
}
