# Configuration

Use this page to look up the server's settings. Settings come from these sources, and each one
overrides the ones after it:

1. Environment variables
2. User secrets
3. `appsettings.{Environment}.json`
4. `appsettings.json`

The tracked `appsettings*.json` files hold only logging levels and non-secret defaults, such as the
sign-in issuer and local mail settings. Set secrets elsewhere:

- **Locally:** use `dotnet user-secrets set`. See [Development setup](development.md).
- **In a container:** use environment variables, with `__` as the section separator, such as
  `ConnectionStrings__SchulyDatabase`.

## Database connection string

`SchulyDbContext` reads the connection string named `SchulyDatabase`
(`ConnectionStrings:SchulyDatabase`), wired up in `DatabaseExtensions`. Retry on failure is on for
transient Postgres errors.

```sh
export ConnectionStrings__SchulyDatabase="Host=localhost;Port=2406;Database=schuly-dev;Username=postgres;Password=..."
```

## Sign-in

Sign-in is built into the server with the
[Toamaisutaa](https://www.nuget.org/packages/Toamaisutaa.AspNetCore) library
(`AddSchulyAuthentication`). There is no separate identity provider. Its tables are in the Schuly
database (migration `AddToamaisutaa`).

**Enabled:** password sign-in with self-registration, email verification, password reset by email, TOTP
two-factor with recovery codes, "remember this device" (trusted devices), optional single sign-on
through OIDC providers, and expired-token cleanup.

**Not enabled:** passkeys, magic links, invitations, and admin-created accounts.

**Endpoints:** these live under `/auth`, such as `POST /auth/register`, `/auth/login`, `/auth/refresh`,
`/auth/logout`, `/auth/password`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/email`,
`/auth/email/verify`, `/auth/2fa/*`, `/auth/devices`, `/auth/providers`, and `/auth/external/*`.

**Tokens:** the API under `/api/*` takes the access token as `Authorization: Bearer`. Access tokens live
15 minutes. Refresh tokens rotate on every use.

**Clients:** the web app, which the server itself serves, sends the header `X-Schuly-Client: web`. It
gets the refresh token and the remembered-device token in `HttpOnly`, `SameSite=Strict` cookies scoped
to `/auth`. Other clients, such as the mobile app, get the tokens in the JSON body.

| Key | Purpose |
|---|---|
| `LocalLogin:SigningKey` | Signs access tokens. Base64, exactly 32 bytes. |
| `TwoFactor:EncryptionKey` | Encrypts the two-factor secrets. Base64, exactly 32 bytes. |
| `LocalLogin:Issuer`, `LocalLogin:Audience` | Token issuer and audience. `appsettings.json` sets both to `schuly`. |
| `LocalLogin:AllowSelfRegistration` | Whether anyone can register (`true` in `appsettings.json`). |
| `LocalLogin:RequireVerifiedEmailForSignIn` | Whether sign-in needs a verified address (`true` in `appsettings.json`). |
| `LocalLogin:RequireVerifiedEmailForPasswordReset` | Send reset mails only to verified addresses (`true` in `appsettings.json`). |
| `TwoFactor:Issuer` | Name shown in authenticator apps (`Schuly`). |

Generate both keys with `openssl rand -base64 32` and keep them stable. A new signing key signs
everybody out. A new encryption key breaks two-factor for every account that has it set up.

There is no admin role. On the first valid token for an unknown user, the API creates the matching
Schuly user (`AddUserSync`, `IUserService`).

### Single sign-on (OIDC providers)

Single sign-on is optional. Configure zero, one, or several OIDC providers: Google, Microsoft, Authentik,
Pocket ID, Keycloak, or any issuer with a discovery document. With none, the web app and the mobile app
show only the password form. Each provider appears as a "Continue with ..." button. Signed-in users link
or unlink providers under **Settings → Security** in the web app.

| Key | Purpose |
|---|---|
| `ExternalLogin:Providers:<key>:DisplayName` | Button label. Defaults to the key. |
| `ExternalLogin:Providers:<key>:IconUrl` | Button icon: any image URL, or a path the server serves. When empty, Google (`https://accounts.google.com`) and Microsoft (`login.microsoftonline.com`, `login.live.com`) authorities get their logo. |
| `ExternalLogin:Providers:<key>:Authority` | The issuer, such as `https://accounts.google.com`. Must be `https://` outside Development. |
| `ExternalLogin:Providers:<key>:ClientId`, `ClientSecret` | The client the provider issued. Leave out the secret for a public client. |
| `ExternalLogin:Providers:<key>:Scopes` | Defaults to `openid profile email`. |
| `ExternalLogin:Providers:<key>:AllowSignUp` | Whether a first sign-in may create an account. `false` by default, so only accounts that linked the provider can use it. |
| `ExternalLogin:Providers:<key>:TrustEmailVerified` | Whether an address this provider marks `email_verified` counts as the account's email when the account has no verified address. Without it, accounts created through the provider have no email. Turn this on only for providers that really verify addresses. |
| `ExternalLogin:Providers:<key>:LinkByVerifiedEmail` | Whether a first sign-in joins the account that already has the provider's verified address. Turn this on only for providers that really verify addresses. |
| `ExternalLogin:AllowedReturnUrls` | Exact URLs a finished sign-in may return to (`ExternalLogin__AllowedReturnUrls__0`, `__1`, and so on). |
| `ExternalLogin:CallbackBaseUrl` | Public scheme and host of the server, when a proxy doesn't forward them. |

`AllowedReturnUrls` needs these entries:

- `https://<API_HOST>/login`: sign-in in the web app
- `https://<API_HOST>/settings`: linking a provider in the web app
- `schuly://auth/callback`: sign-in in the mobile app (`schuly-dev://auth/callback` for the dev build)

At each provider, register `https://<API_HOST>/auth/external/<key>/callback` as the redirect URI. Every
link stores the key, so don't rename it later.

### Email (SMTP)

Verification and password-reset mails go out over SMTP:

| Key | Purpose |
|---|---|
| `Email:Smtp:Host`, `Email:Smtp:Port` | Mail server. |
| `Email:Smtp:Security` | Connection security. `appsettings.Development.json` sets `None`. |
| `Email:Smtp:User`, `Email:Smtp:Password` | Mail server credentials. |
| `Email:Smtp:From` | Sender address. |
| `Email:Smtp:FromDisplayName` | Sender name (`Schuly` in `appsettings.json`). |
| `Email:Smtp:PasswordResetLinkTemplate` | Link in the reset mail, such as `https://<API_HOST>/reset-password?token={token}`. |
| `Email:Smtp:EmailVerificationLinkTemplate` | Link in the verification mail, such as `https://<API_HOST>/verify-email?token={token}`. |

In Development, `appsettings.Development.json` sends mail to a local SMTP catcher on `localhost:1025` and
builds links to `http://localhost:4200`. See [Development setup](development.md).

## OpenAPI document

The OpenAPI document uses an HTTP bearer security scheme. In the Scalar UI, you paste an access token.
There is no OAuth2 flow.

## Document storage (S3)

Document and avatar blobs go to an S3-compatible bucket, which is SeaweedFS in the bundled stacks.

| Key | Purpose |
|---|---|
| `S3:Endpoint` | S3 endpoint, such as `http://localhost:8333`. |
| `S3:Bucket` | Bucket name. |
| `S3:AccessKey`, `S3:SecretKey` | Credentials. Must match the SeaweedFS `s3-config.json`. |
| `S3:UsePathStyle` | `true` by default. Use `true` for SeaweedFS and most self-hosted S3 implementations. |
| `Documents:EncryptionKey` | Encrypts documents before they reach the bucket. Generate with `openssl rand -base64 32`. Required outside Development. Losing it makes stored documents unreadable. |
| `Documents:KeyVersion`, `Documents:PreviousKeys:<version>` | Current key version (default `1`) and earlier keys, so documents encrypted with them stay readable. |

## Avatar URL signing

| Key | Purpose |
|---|---|
| `Avatar:SigningKey` | HMAC key for short-lived signed avatar URLs. Generate with `openssl rand -hex 32`. |

Users upload a profile picture with `PUT /api/me/avatar` (multipart; PNG, JPEG, or WebP; 2 MB at most)
and remove it with `DELETE /api/me/avatar`. The file goes to document storage and is served through
short-lived signed URLs under `/api/avatars/users/{id}`.

The database stores only a bare blob key, and the server creates a signed URL for each access. The server
reads the key lazily. If it's missing, you see `Avatar:SigningKey is not configured.` the first time an
avatar URL is signed, not at startup.

## Plugin vault

| Key | Purpose |
|---|---|
| `Vault:MasterKey` | Encrypts stored plugin credentials, absence reasons and document metadata (title, comment, category, author, file name, follow-up action). Base64, exactly 32 bytes. Generate with `openssl rand -base64 32`. |

Outside Development, the server refuses to start without a valid key. Keep the key stable: under a new
key, stored credentials become unreadable, and so do absence reasons and document metadata, until a sync rewrites them. Entries typed in by hand stay unreadable. In Development, a missing or invalid key logs a warning and the
server uses a temporary key, so stored credentials don't survive a restart.

`Vault:PreviousMasterKey` is set only while rotating the key. See
[Rotate the vault key](operations.md#rotate-the-vault-key).

## Retention

A hosted service sweeps expired data five minutes after startup and every 24 hours after that. It uses the
same purge code as `DELETE /api/auth/me`, so a swept row leaves nothing behind in Postgres or S3. It also removes classes with no student and no grade, with their exams and class agenda, and unlinked teachers with no class.

| Key | Purpose |
|---|---|
| `Retention:Enabled` | Whether the sweep runs at all (default `true`). |
| `Retention:MonthsAfterLeave` | Drops cached school data and notification rows of school users whose `LeaveDate` is older than this, and the owning plugin's accounts and secrets (default `6`). |
| `Retention:MonthsInactive` | Deletes accounts with no authenticated request for this long, including the sign-in account (default `12`). |
| `Retention:InactivityWarningDays` | How long before that deletion a verified address is warned (default `30`, minimum `14`; a lower value is raised to `14`). |
| `Retention:SweepOrphanBlobs` | Whether objects no row points at are deleted (default `true`). |
| `Retention:OrphanBlobGraceDays` | How old such an object must be first, so uploads on their way to a row are safe (default `7`). |

`ApplicationUser.LastSeenAt` measures inactivity. JWT validation and MCP authentication stamp it at most once
per hour, so a busy client doesn't write on every request. An account that was never stamped falls back to its
`CreatedAt`.

**Warnings.** An account with a verified address gets one mail, and is never deleted before the date in it. An
account already overdue when the warning goes out gets the full warning period. If the mail can't be sent, the
sweep logs an error, keeps the account, and tries again the next day, so a broken mail server delays deletions.
Accounts without a verified address are deleted on schedule, without mail.

**Leavers.** The plugin that synced the student loses all of that user's data, unless the user is still at
another school through the same plugin. In that case the Schulnetz plugin removes the one account itself on
its next sync. An account whose sign-in has expired can't reach that step, so it stays until the inactivity
deletion.

**Failures.** A deletion step that fails (a blob, linked account secrets, a plugin's purge) doesn't stop the
deletion. It stays in the `PendingPurges` table and is retried on every sweep until it works. While any step
fails, the sweep logs at Error level.

**Orphans.** Every sweep also cleans up what earlier deletions left, so the first sweep after an upgrade may
remove a lot, and later ones little:

- **Plugin data.** The host reads each loaded plugin's database, read-only, for uuid columns named
  `ApplicationUserId`. For each id with no `ApplicationUsers` row, it sends the plugin's purge event. Skipped
  while the host has no users at all.
- **Accounts without a sign-in.** Removes `ApplicationUsers` rows whose version 7 `ExternalId` has no sign-in
  row. Accounts from before the built-in sign-in have other ids and only age out. Skipped while there are no
  sign-in rows at all.
- **Blobs.** Deletes objects with a Schuly key, older than the grace period, that no document or picture row
  points at. Skipped while no row points at any object. If a custom plugin keeps object keys only in its own
  database, set `Retention:SweepOrphanBlobs` to `false`.

## Push notifications (Firebase)

A background service drains the notification outbox (grades, absences, agenda changes) and delivers it
through Firebase Cloud Messaging. By default the text is generic, such as "New grade". A user can turn on details in the notification settings, and only then the subject, agenda title and date go through Firebase.

| Key | Purpose |
|---|---|
| `Firebase:ServiceAccountJson` | Base64 of the Firebase service-account JSON. |
| `Firebase:ServiceAccountPath` | Path to the service-account JSON file, as an alternative to the inline value. |

With neither set, the backend logs once at startup that push notifications are off and sends nothing, so
deployments without Firebase keep working. It still drains the outbox, so the table stays bounded. Handled rows are deleted, and rows never hold a grade value or an absence reason: a grade value is read from the grade when the push goes out.

## Helply

Helply is the optional AI assistant. It needs an OpenAI-compatible chat-completions gateway.

| Key | Purpose |
|---|---|
| `Helply:BaseUrl` | Gateway URL. Absolute `http` or `https`. |
| `Helply:ApiKey` | Gateway API key. |
| `Helply:Model` | Optional. Without it, the server probes the models the gateway lists and uses the first that answers tool calls. |

`BaseUrl` and `ApiKey` together turn Helply on. These three settings have no default. Set them only as
environment variables (`Helply__BaseUrl`, `Helply__ApiKey`, `Helply__Model`), never in appsettings.
Without them, the server logs that Helply is disabled and users see it turned off.

### Limits

These keys live under `Helply:Limits`.

| Key | Default | Purpose |
|---|---|---|
| `MessagesPerMinute` | `10` | Messages per user per minute. |
| `MessagesPerDay` | `200` | Messages per user per day. |
| `MaxInputChars` | `4000` | Longest message. |
| `RunTimeoutSeconds` | `120` | Time budget for a turn. |
| `RunTimeoutSecondsWithWorkspace` | `300` | Time budget for a turn with the workspace. |
| `MaxToolIterations` | `8` | Tool round trips in a turn. |
| `MaxToolIterationsWithWorkspace` | `16` | Tool round trips in a turn with the workspace. |
| `MaxHistoryMessages` | `40` | Earlier messages sent to the model. |
| `MaxHistoryChars` | `60000` | Earlier text sent to the model. |
| `MaxOutputTokens` | `2048` | Longest answer. |
| `MaxToolResultChars` | `16000` | Longest tool result in the prompt. Longer results are cut with a note. |
| `MaxToolArgumentChars` | `20000` | Longest serialized tool arguments. Larger calls are refused. |
| `MaxAttachmentTextChars` | `30000` | Most text from one attachment in the prompt. |
| `MaxAttachmentTextTotalChars` | `60000` | Most attachment text in one model request. |
| `MaxNativeBytesPerRequest` | `12000000` | Most file bytes (images, PDFs) sent as files in one model request. |

### Workspace

The workspace lets Helply run code in a sandbox. It needs `Helply:Sandbox:BaseUrl` and
`Helply:Sandbox:ApiKey`, which must have at least 32 characters. Set them as environment variables
(`Helply__Sandbox__BaseUrl`, `Helply__Sandbox__ApiKey`). See the
[deploy README](https://github.com/schulydev/SchulyServer/blob/main/deploy/README.md) for setup.

## MCP server

The server exposes MCP at `/mcp`, so users can connect AI apps.

| Key | Purpose |
|---|---|
| `Mcp:PublicUrl` | The public origin and the audience of every MCP token. Set it in deployments. Without it, the server takes the origin from each request. |
| `Mcp:AllowedOrigins` | Browser origins allowed CORS, besides the server's own (`Mcp__AllowedOrigins__0`, `__1`, and so on). Wildcards aren't supported. |

You normally set only these two. Token lifetimes and limits also live under `Mcp:` and have working defaults (`McpOAuthOptions`).

## Privacy notice

| Key | Purpose |
|---|---|
| `Privacy:PolicyVersion` | Version of the current privacy policy (default `2026-11-03`). Change it to ask every user once more. |
| `Privacy:PolicyUrl` | Where the notice links to (default `https://schuly.dev/privacy`). Point it at your own policy if you self-host. |

The web app and the mobile app show the sign-up notice, including that absence reasons can reveal health information. After sign-in, a user who hasn't confirmed the current version sees it once more, and the server stores the version and time on the account. Older app versions don't show the prompt and keep working.

## Limit sign-ups to Switzerland

Set `SignUp:SwitzerlandOnly` to `true` (`SignUp__SwitzerlandOnly=true` in `config/backend.env`) to accept new accounts only from Swiss networks. It's off by default.

- Password sign-ups from other networks get an error. The server only compares the address with a built-in list, and doesn't store or log it.
- OIDC providers can't create accounts, whatever `AllowSignUp` says. Accounts that already linked a provider keep using it.
- Existing accounts keep working from anywhere. Private mode has no account, so this doesn't affect it.
- Users also confirm "I attend a school in Switzerland." The server stores the time on the account, and private mode stores it on the device. With the setting off, nobody is asked. The confirmation doesn't replace the network check.
- A Swiss address must reach the server. Set `ForwardedHeaders:KnownNetworks` correctly behind a proxy, or every sign-up is refused.

The list comes from RIPE registry data, which shows where a network is registered, so it isn't exact. A VPN can get around it. To refresh the list before a release, run `scripts/update-swiss-networks.sh`.

## Authorization policy

The fallback policy requires an authenticated user for every endpoint (`AddSchulyAuthorization`).
Endpoints opt out with `[AllowAnonymous]`. These need no token:

- The anonymous `/api/app` surface, such as the school-systems catalog and the static logo assets under
  `wwwroot`, so the app can load its login catalog.
- School logos at `/api/schools/{id}/logo`. The server fetches each logo itself, so the logo host never sees a user.
- Register, login, and the other public sign-in endpoints under `/auth`.

## Plugins

See [Plugin management](../plugin-management.md) for the registry URL, the desired-plugin file, and the
directories.

## Logging

Set log levels under `Logging:LogLevel` in `appsettings.json`. The Development override raises HTTP logging
to `Information` for request tracing.
