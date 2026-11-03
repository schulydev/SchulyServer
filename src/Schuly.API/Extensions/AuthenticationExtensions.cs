using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using System.Security.Claims;
using Schuly.API.Email;
using Schuly.API.SignUp;
using Toamaisutaa.Abstractions;
using Toamaisutaa.Email.Smtp;
using Toamaisutaa.EntityFrameworkCore;

namespace Schuly.API.Extensions
{
    public static class AuthenticationExtensions
    {
        public static IServiceCollection AddSchulyAuthentication(this IServiceCollection services, IConfiguration configuration)
        {
            services.AddToamaisutaaBearer(configuration).AddUserSync();
            services.AddToamaisutaaEntityFrameworkStores<SchulyDbContext>();

            services.AddToamaisutaaSmtpEmail(configuration);
            services.AddSingleton<IEmailVerificationEmailTemplate, SchulyEmailVerificationEmailTemplate>();
            services.AddToamaisutaaSmtpEmailVerification();
            services.AddToamaisutaaPasswordLogin(configuration);
            services.AddToamaisutaaTwoFactor(configuration);
            services.AddToamaisutaaTrustedDevices(configuration);
            services.AddToamaisutaaExternalLogin(configuration);
            services.PostConfigure<ToamaisutaaExternalLoginOptions>(options =>
            {
                foreach (var provider in options.Providers.Values.Where(p => string.IsNullOrWhiteSpace(p.IconUrl)))
                    provider.IconUrl = BuiltInIcon(provider.Authority);
            });
            services.AddSwissExternalSignUpLimit(configuration);
            services.AddToamaisutaaTokenCleanup();

            return services;
        }

        public static IServiceCollection AddSchulyAuthorization(this IServiceCollection services, IConfiguration configuration)
        {
            services.AddToamaisutaaAuthorization(configuration);
            return services;
        }

        public static WebApplication MapSchulyAuthEndpoints(this WebApplication app)
        {
            app.MapToamaisutaaPasswordEndpoints();
            app.MapToamaisutaaTwoFactorEndpoints();
            app.MapToamaisutaaTrustedDeviceEndpoints();
            app.MapToamaisutaaExternalLoginEndpoints();
            return app;
        }

        private static string? BuiltInIcon(string? authority) => Uri.TryCreate(authority, UriKind.Absolute, out var uri)
            ? uri.Host.ToLowerInvariant() switch
            {
                "accounts.google.com" => "/sso-icons/google.png",
                "login.microsoftonline.com" or "login.live.com" => "/sso-icons/microsoft.png",
                _ => null,
            }
            : null;

        private static async Task<bool> SignInStillExistsAsync(HttpContext httpContext, string externalId) =>
            Guid.TryParse(externalId, out var loginId)
            && await httpContext.RequestServices.GetRequiredService<IUserStore>().ReadSecurityStampAsync(loginId, httpContext.RequestAborted) is not null;

        public static AuthenticationBuilder AddUserSync(this AuthenticationBuilder builder)
        {
            builder.Services.PostConfigure<JwtBearerOptions>(
                JwtBearerDefaults.AuthenticationScheme,
                options =>
                {
                    options.Events ??= new JwtBearerEvents();
                    var previous = options.Events.OnTokenValidated;

                    options.Events.OnTokenValidated = async context =>
                    {
                        if (previous is not null)
                            await previous(context);

                        if (context.Principal?.Identity is not ClaimsIdentity identity)
                            return;

                        var externalId = identity.FindFirst("sub")?.Value ?? identity.FindFirst(ClaimTypes.NameIdentifier)?.Value;

                        // A token outlives the deletion of its account by up to its lifetime. This runs before
                        // HttpContext.User is set: authorization would otherwise accept that principal after Fail.
                        if (!string.IsNullOrEmpty(externalId) && !await SignInStillExistsAsync(context.HttpContext, externalId))
                        {
                            context.Fail("The sign-in for this token no longer exists.");
                            return;
                        }

                        context.HttpContext.User = context.Principal;

                        if (string.IsNullOrEmpty(externalId))
                            return;

                        var userService = context.HttpContext.RequestServices.GetRequiredService<IUserService>();

                        if (await userService.ExistsAsync(externalId, context.HttpContext.RequestAborted))
                        {
                            await userService.TouchLastSeenAsync(externalId, identity.FindFirst("email")?.Value, context.HttpContext.RequestAborted);
                            return;
                        }

                        await userService.SyncCurrentUserAsync(context.HttpContext.RequestAborted);
                    };
                });

            return builder;
        }
    }
}
