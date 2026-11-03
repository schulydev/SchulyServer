using System.Net;
using Microsoft.Extensions.Options;
using Toamaisutaa.Abstractions;
using Toamaisutaa.Email.Smtp;

namespace Schuly.API.Email
{
    /// <summary>
    /// Schuly's verification mails, in the design the Keycloak theme used (themes/schuly/email in SchulyKeycloak): the
    /// code mail and the link mail. The address-in-use notice keeps the library's default.
    /// </summary>
    public sealed class SchulyEmailVerificationEmailTemplate(IOptions<ToamaisutaaSmtpEmailOptions> options) : IEmailVerificationEmailTemplate
    {
        public EmailVerificationEmailContent Build(ToamaisutaaUser user, string email, string verificationToken) =>
            Build(user, email, verificationToken, new EmailVerificationContext());

        public EmailVerificationEmailContent Build(ToamaisutaaUser user, string email, string verificationToken, EmailVerificationContext context)
        {
            var template = options.Value.EmailVerificationLinkTemplate ?? throw new InvalidOperationException("Email:Smtp:EmailVerificationLinkTemplate is not configured.");
            var link = template.Replace("{token}", Uri.EscapeDataString(verificationToken), StringComparison.Ordinal);

            // No name anywhere: it is whatever the registrant typed, and this goes to an address nobody has proven yet.
            if (context.TakesFromAnotherAccount)
            {
                return new EmailVerificationEmailContent
                {
                    Subject = "Someone wants to move your email address to their account",
                    PlainTextBody = Text(
                        "Someone wants your email address",
                        $"Someone asked to use {email} on their Schuly account. It is currently on another account, which may be yours. Opening the link below moves it away from that account to theirs. Only open it if you asked for this yourself:",
                        link,
                        "Didn't ask for this? Don't open the link. Nothing changes until it is used."),
                    HtmlBody = Html(
                        LogoUrl(),
                        "Someone asked to use this email address on their Schuly account.",
                        "Someone wants your email address",
                        $"Someone asked to use {WebUtility.HtmlEncode(email)} on their Schuly account. It is currently on another account, which may be yours. The button below moves it away from that account to theirs. Only use it if you asked for this yourself.",
                        Button(link, "Move email address"),
                        "Didn&rsquo;t ask for this? Don&rsquo;t use the button. Nothing changes until it is used."),
                };
            }

            return new EmailVerificationEmailContent
            {
                Subject = "Confirm your Schuly account",
                PlainTextBody = Text(
                    "Confirm your account",
                    "Please open the link below to confirm your email address and finish setting up your Schuly account:",
                    link,
                    "Didn't sign up for Schuly? You can safely ignore this email."),
                HtmlBody = Html(
                    LogoUrl(),
                    "Confirm your email to finish setting up your Schuly account.",
                    "Confirm your account",
                    "Please click the button below to confirm your email address and finish setting up your Schuly account.",
                    Button(link, "Confirm email"),
                    "Didn&rsquo;t sign up for Schuly? You can safely ignore this email."),
            };
        }

        public EmailVerificationEmailContent BuildCode(ToamaisutaaUser user, string email, string code, TimeSpan validFor) => new()
        {
            Subject = $"Your Schuly verification code is {code}",
            PlainTextBody = Text(
                "Confirm your account",
                "Enter this code in the app to confirm your email address and finish setting up your Schuly account:",
                code,
                $"This code is valid for {Duration(validFor)}.\n\nDidn't sign up for Schuly? You can safely ignore this email."),
            HtmlBody = Html(
                LogoUrl(),
                $"Your Schuly verification code is {WebUtility.HtmlEncode(code)}.",
                "Confirm your account",
                $"Enter this code in the app to confirm your email address and finish setting up your Schuly account. It is valid for {Duration(validFor)}.",
                $"<span class=\"code\">{WebUtility.HtmlEncode(code)}</span>",
                "Didn&rsquo;t sign up for Schuly? You can safely ignore this email."),
        };

        /// <summary>The small logo the web app serves, on the host the verification links point at (works for self-hosters too).</summary>
        private string LogoUrl() =>
            Uri.TryCreate(options.Value.EmailVerificationLinkTemplate?.Replace("{token}", "x", StringComparison.Ordinal), UriKind.Absolute, out var link)
                ? $"{link.GetLeftPart(UriPartial.Authority)}/email-logo.png"
                : "https://app.schuly.dev/email-logo.png";

        internal static string Text(string title, string intro, string action, string footer) =>
            $"{title}\n\n{intro}\n\n{action}\n\n{footer}\n\nSchuly\n";

        internal static string Button(string link, string label) =>
            $"<a href=\"{WebUtility.HtmlEncode(link)}\" class=\"btn\" target=\"_blank\">{WebUtility.HtmlEncode(label)}</a>";

        private static string Duration(TimeSpan period) => period.TotalHours < 1
            ? Math.Ceiling(period.TotalMinutes) is 1 ? "1 minute" : $"{Math.Ceiling(period.TotalMinutes)} minutes"
            : Math.Ceiling(period.TotalHours) is 1 ? "1 hour" : $"{Math.Ceiling(period.TotalHours)} hours";

        internal static string Html(string logo, string preheader, string title, string intro, string action, string footer) => $$"""
            <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
            <html xmlns="http://www.w3.org/1999/xhtml">
              <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta name="x-apple-disable-message-reformatting" />
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <meta name="color-scheme" content="light dark" />
                <meta name="supported-color-schemes" content="light dark" />
                <title></title>
                <style type="text/css" rel="stylesheet" media="all">
                body { margin:0; padding:0; background-color:#ffffff; width:100% !important; -webkit-text-size-adjust:none; }
                body, td, th { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
                a { color:#18181b; }
                .preheader { display:none !important; visibility:hidden; mso-hide:all; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; }
                h1 { margin:0 0 16px; font-size:34px; line-height:1.15; font-weight:800; color:#18181b; letter-spacing:-0.02em; }
                p { margin:0 0 28px; font-size:16px; line-height:1.6; color:#52525b; }
                .code { display:inline-block; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size:40px; font-weight:800; letter-spacing:0.32em; color:#18181b; background-color:#f4f4f5; border-radius:14px; padding:20px 28px 20px 36px; }
                .btn { background-color:#18181b; border-top:14px solid #18181b; border-bottom:14px solid #18181b; border-left:30px solid #18181b; border-right:30px solid #18181b; display:inline-block; color:#ffffff !important; text-decoration:none; border-radius:9999px; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; box-sizing:border-box; }
                .footer { font-size:14px; line-height:1.6; color:#a1a1aa; margin:40px 0 0; }
                @media (prefers-color-scheme: dark) {
                  body, .wrapper { background-color:#0a0a0a !important; }
                  h1 { color:#fafafa !important; }
                  p { color:#a1a1aa !important; }
                  .brandname { color:#fafafa !important; }
                  .code { background-color:#18181b !important; color:#fafafa !important; }
                  .btn { background-color:#fafafa !important; border-color:#fafafa !important; color:#0a0a0a !important; }
                }
                </style>
                <!--[if mso]><style type="text/css">.btn { font-family: Arial, sans-serif; }</style><![endif]-->
              </head>
              <body>
                <span class="preheader">{{preheader}}</span>
                <table role="presentation" class="wrapper" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
                  <tr>
                    <td align="center" style="padding:56px 24px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
                        <tr>
                          <td style="padding-bottom:44px;">
                            <table role="presentation" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="vertical-align:middle;padding-right:10px;">
                                  <img src="{{WebUtility.HtmlEncode(logo)}}" width="40" height="40" alt="Schuly" style="display:block;width:40px;height:40px;border:0;border-radius:9px;" />
                                </td>
                                <td class="brandname" style="vertical-align:middle;font-size:20px;font-weight:800;color:#18181b;letter-spacing:-0.01em;">Schuly</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr><td><h1>{{title}}</h1></td></tr>
                        <tr><td><p>{{intro}}</p></td></tr>
                        <tr><td>{{action}}</td></tr>
                        <tr><td><p class="footer">{{footer}}</p></td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
            """;
    }
}
