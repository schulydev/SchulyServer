using System.Globalization;
using System.Net;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;
using Schuly.Infrastructure.Services;
using Toamaisutaa.Email.Smtp;

namespace Schuly.API.Email
{
    /// <summary>The warning before an inactive account is deleted. The library keeps its SMTP sender internal, so this connects the same way: Auto is never MailKit's opportunistic STARTTLS.</summary>
    public sealed class SmtpInactivityWarningSender(IOptions<ToamaisutaaSmtpEmailOptions> options) : IInactivityWarningSender
    {
        public async Task SendAsync(string email, DateTime deleteAfterUtc, CancellationToken cancellationToken)
        {
            var settings = options.Value;
            var message = Build(settings, email, deleteAfterUtc);

            using var client = new SmtpClient { Timeout = (int)settings.Timeout.TotalMilliseconds };
            if (settings.SkipCertificateVerification)
                client.ServerCertificateValidationCallback = (_, _, _, _) => true;

            await client.ConnectAsync(settings.Host!, settings.Port, SocketOptions(settings.Security, settings.Port), cancellationToken);
            if (!string.IsNullOrWhiteSpace(settings.User))
                await client.AuthenticateAsync(settings.User, settings.Password ?? string.Empty, cancellationToken);
            await client.SendAsync(message, cancellationToken);
            await client.DisconnectAsync(true, cancellationToken);
        }

        public static MimeMessage Build(ToamaisutaaSmtpEmailOptions settings, string email, DateTime deleteAfterUtc)
        {
            var date = deleteAfterUtc.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
            var signIn = SignInLink(settings);
            const string title = "Your Schuly account will be deleted";
            var intro = $"You haven't used Schuly for a long time. After {date} we will delete your account with your school data, documents and the school logins stored for you. To keep it, sign in to Schuly before then.";
            const string footer = "Don't need it any more? You don't have to do anything.";

            var body = new BodyBuilder
            {
                TextBody = SchulyEmailVerificationEmailTemplate.Text(title, intro, signIn, footer),
                HtmlBody = SchulyEmailVerificationEmailTemplate.Html($"{new Uri(signIn).GetLeftPart(UriPartial.Authority)}/email-logo.png", $"Your account will be deleted after {date}.", title, WebUtility.HtmlEncode(intro), SchulyEmailVerificationEmailTemplate.Button(signIn, "Sign in"), "Don&rsquo;t need it any more? You don&rsquo;t have to do anything."),
            };

            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(settings.FromDisplayName ?? string.Empty, settings.From));
            message.To.Add(new MailboxAddress(string.Empty, email));
            message.Subject = title;
            message.Body = body.ToMessageBody();
            return message;
        }

        private static string SignInLink(ToamaisutaaSmtpEmailOptions settings)
        {
            if (Uri.TryCreate(settings.SignInUrl, UriKind.Absolute, out var signIn))
                return signIn.ToString();
            return Uri.TryCreate(settings.EmailVerificationLinkTemplate?.Replace("{token}", "x", StringComparison.Ordinal), UriKind.Absolute, out var link)
                ? link.GetLeftPart(UriPartial.Authority)
                : "https://app.schuly.dev";
        }

        private static SecureSocketOptions SocketOptions(SmtpSecurityMode mode, int port) => mode switch
        {
            SmtpSecurityMode.None => SecureSocketOptions.None,
            SmtpSecurityMode.StartTls => SecureSocketOptions.StartTls,
            SmtpSecurityMode.SslOnConnect => SecureSocketOptions.SslOnConnect,
            _ => port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls,
        };
    }
}
