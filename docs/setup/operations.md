# Run and upgrade your server

Everyday tasks for a server set up with [Self-host Schuly](self-hosting.md). Run commands from the
`deploy` folder.

## Back up

All data is in `deploy/data`. Back up these items:

- `data/postgres`: accounts and school data
- `data/seaweedfs`: documents and profile pictures

Keep the keys apart from these backups:

- Store `.env` somewhere separate, such as a password manager or an offline encrypted drive. Never
  put it in the same backup, bucket, or server as the data. A stolen backup that includes the keys
  gives away the stored logins and documents that the keys protect.
- Encrypt the data backups too. School data, including absence reasons, isn't encrypted in the
  database.
- Without `.env`, parts of a backup can't be read, so test a restore at least once.

### How long to keep backups

Keep daily backups for 14 days and then delete them, unless you have a reason to keep them longer.
Automate the deletion, and state the period in your privacy policy.

Data that a user deleted stays in backups until they expire. If you restore a backup, delete again
any accounts that were deleted after it was made.

## Rotate keys

| Key | How to rotate |
|---|---|
| `VAULT_MASTER_KEY` | See [Rotate the vault key](#rotate-the-vault-key). |
| `DOCUMENTS_ENCRYPTION_KEY` | Set `Documents__KeyVersion` and list the old key under `Documents__PreviousKeys__<version>`. See [Configuration](configuration.md#document-storage-s3). |
| `LOCAL_LOGIN_SIGNING_KEY` | Change it. Current access tokens stop working, and clients sign in again or refresh. |
| `TWO_FACTOR_ENCRYPTION_KEY` | There's no rotation path. A new key breaks two-factor for every account. |

### Rotate the vault key

1. Back up `data/postgres`.
2. In `.env`, set `VAULT_PREVIOUS_MASTER_KEY` to the current key and `VAULT_MASTER_KEY` to the output
   of `openssl rand -base64 32`.
3. Run `docker compose -f compose.staging.yml up -d backend`. On start, the backend re-encrypts every
   vault entry and logs how many it moved.
4. Keep `VAULT_PREVIOUS_MASTER_KEY` for now. Helply data isn't re-encrypted: titles and attachments
   written before the rotation still need the old key.
5. Remove `VAULT_PREVIOUS_MASTER_KEY` and restart when this query returns 0. Replace the time with the
   time of step 3:

   ```sql
   SELECT count(*) FROM "HelplyConversations" WHERE "CreatedAt" < '2026-01-01T00:00:00Z';
   ```

   To remove it sooner, delete those conversations first, or accept that they can't be read.

If the old key leaked, also treat the stored logins as exposed. See the
[breach runbook](https://github.com/schulydev/SchulyServer/blob/main/deploy/breach-runbook.md).

## Logs

Docker keeps at most 30 MB of logs per container (3 files of 10 MB), set in `compose.staging.yml`.
Older lines are dropped, and recreating a container drops its logs.

Docker has no age limit, so the number of days depends on how much each service writes. To see how
far back the logs reach:

```sh
docker compose -f compose.staging.yml logs --timestamps --no-log-prefix backend | head -n 1
```

If you state a period in your privacy policy, check it against this. For a hard limit such as 14
days, use Docker's `journald` log driver and set `MaxRetentionSec=14day` in the host's `journald.conf`.

Container logs hold no access logs, search terms, school URLs, or file names. Caddy logs no requests
either, because the `Caddyfile` has no `log` directive.

## Security headers

Caddy adds HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` to every
response. The Content Security Policy is in report-only mode, so it blocks nothing yet: violations
appear in the browser console. It allows `https:` images and media because mail, Teams, and OneNote
content loads them.

Before you enforce it, rename the header to `Content-Security-Policy`, then test sign-in, single
sign-on, the file viewer, mail, chats, and OneNote. The app's two inline scripts (theme, stylesheet loading) need hashes in
`script-src` at that point.

## Sign-in and deletion audit trail

The `SecurityAuditEntries` table records sign-ins, failed sign-ins, lockouts, password changes, refused
deletion attempts, and account purges. Each entry holds the kind, the sign-in account's ID, the time,
and a reason code. It holds no password, token, email, or IP address.

Entries stay after an account is deleted, and are removed after 365 days. Change this with
`SecurityAudit__RetentionDays` in `config/backend.env`. The table is in the main database, so a
stolen database includes it.

## Upgrade

1. Back up `data/postgres`.
2. Set the new `SCHULY_VERSION` in `.env`.
3. Take the current `compose.staging.yml` from the repository. It pins the other images by digest, so
   they only change when you take a new copy.
4. Run `docker compose -f compose.staging.yml up -d`.

Schuly updates its database when it starts. To confirm the version, open
`https://<your domain>/api/app` and read the `version` field.

To move an image yourself, look up the digest of the new tag and change both in the `image:` line:

```sh
docker buildx imagetools inspect caddy:2.11.7 --format '{{json .Manifest.Digest}}'
```

## Delete all data

Stop the stack, then delete the `data` folder:

```sh
docker compose -f compose.staging.yml down
rm -rf data
```

## How long data is kept

Once a day, Schuly removes expired data:

| Data | Removed after | Setting |
|---|---|---|
| School data and school logins of a student who left | 6 months after the leave date | `Retention__MonthsAfterLeave` |
| An inactive account, including its sign-in | 12 months without a request | `Retention__MonthsInactive` |

Change these in `config/backend.env`, or turn the sweep off with `Retention__Enabled`. Owners of an
inactive account with a verified address get a warning mail 30 days ahead (`Retention__InactivityWarningDays`,
at least 14), so keep SMTP working: without the mail, those accounts aren't deleted. Failed deletions are
retried daily. Watch the logs for `Retention sweep is incomplete`.

When users delete their account, Schuly erases their school data, documents, and sign-in details
immediately. They must enter their password first, unless they only sign in through single sign-on.

## Move from Keycloak

Older servers used a separate Keycloak container. Passwords can't be moved, so existing users must
register again or reset their password.

1. Add the new keys from `.env.example` to `.env`.
2. Remove `AUTH_HOST`, `KEYCLOAK_VERSION`, and all `KC_*` variables.
3. Take the current `compose.staging.yml`, `Caddyfile`, and `config` folder from the repository.
