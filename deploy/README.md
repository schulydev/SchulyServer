# Schuly staging stack

A single `docker compose` that runs the whole Schuly backend stack from published
GHCR images, fronted by Caddy with automatic HTTPS. Intended for a staging server
with a real domain.

## What's in it

| Service | Image | Exposed |
|---|---|---|
| `caddy` | `caddy:2` | **80 / 443** (the only public ports) |
| `backend` | `ghcr.io/schulydev/schuly` | via Caddy → `https://${API_HOST}` |
| `schulware` | `ghcr.io/pianonic/schulwareapi` | internal |
| `schulymicrosoft` | `ghcr.io/schulydev/schulymicrosoft` | internal (Microsoft 365 access for the Microsoft plugin; healthchecked on `/health/ready`, the backend starts only once it is ready) |
| `postgres` | `postgres:18.1` | internal (DBs: `schuly`, `schuly_plugin_*`) |
| `seaweedfs` | `chrislusf/seaweedfs` | internal (S3 document storage) |

Sign-in is built into the backend - there is no separate identity provider. The
backend issues and validates its own tokens, and loads the **Schulware**,
**OdaOrg** and **Microsoft** plugins declared in `config/plugins.yml` on startup (downloaded from the
registry - no DLL baked into the image).

## Setup

1. **DNS** - point `API_HOST` at this server (Caddy needs it to issue a Let's
   Encrypt cert).
2. **Secrets** - `cp .env.example .env` and fill it in. Set `S3_SECRET_KEY` to the
   same value in `config/seaweedfs/s3-config.json` (`S3_ACCESS_KEY` too).
   `LOCAL_LOGIN_SIGNING_KEY` and `TWO_FACTOR_ENCRYPTION_KEY` must be generated base64
   32-byte keys (`openssl rand -base64 32`) and must stay stable - a new signing key
   signs everybody out, a new encryption key breaks two-factor. The `SMTP_* block is the mail server for email verification and
   password reset.
   `VAULT_MASTER_KEY` must be a real generated base64 32-byte key
   (`openssl rand -base64 32`) and must never change afterwards - the backend
   refuses to start without it, and stored credentials become unreadable under
   a different key.
3. **Run**:
   ```sh
   docker compose -f compose.staging.yml up -d
   docker compose -f compose.staging.yml logs -f backend
   ```

## Verify end-to-end

- `https://${API_HOST}/api/app/school-systems` → anonymous catalog (proves the API
  is up).
- Register an account (`POST https://${API_HOST}/auth/register`, or through
  the web app at `https://${API_HOST}`), then sign in.
- Plugins are declared in `plugins.yml`; the backend log lists what was loaded.
- Point the Schuly app at `https://${API_HOST}`; it signs in against the backend's
  `/auth` endpoints.

## Notes

- Plugin changes made via the API are persisted back to `config/plugins.yml`.
- All state is **bind-mounted to host folders under `./data`** (recommended over
  named volumes - visible and easy to back up): `data/postgres`, `data/seaweedfs`,
  `data/plugins`, `data/caddy*`. They're created on first `up`; the one-shot
  `init-perms` service makes `data/plugins` writable by the backend automatically, so
  it works first run with no manual `chown`. To wipe, stop the stack and delete `./data`.
