# Run and upgrade your server

Everyday tasks for a server set up with [Self-host Schuly](self-hosting.md). Run commands from the
`deploy` folder.

## Back up

All data is in `deploy/data`. Back up these items:

- `data/postgres`: accounts and school data
- `data/seaweedfs`: documents and profile pictures
- `.env`: the keys. Without them, parts of the backup can't be read.

## Upgrade

1. Back up `data/postgres`.
2. Set the new `SCHULY_VERSION` in `.env`.
3. Run `docker compose -f compose.staging.yml up -d`.

Schuly updates its database when it starts. To confirm the version, open
`https://<your domain>/api/app` and read the `version` field.

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
immediately.

## Move from Keycloak

Older servers used a separate Keycloak container. Passwords can't be moved, so existing users must
register again or reset their password.

1. Add the new keys from `.env.example` to `.env`.
2. Remove `AUTH_HOST`, `KEYCLOAK_VERSION`, and all `KC_*` variables.
3. Take the current `compose.staging.yml`, `Caddyfile`, and `config` folder from the repository.
