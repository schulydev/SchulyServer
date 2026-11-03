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
| `sandbox` | `ghcr.io/schulydev/schuly-sandbox` | private network with the backend only; optional (`sandbox` profile), see below |

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

   `Mcp__PublicUrl` is set in `config/backend.env` to `https://${API_HOST}`. Keep it set to the
   public origin: it is the audience of every MCP token, including the internal ones Helply uses
   for its own tools. Without it the origin is taken from each request, which breaks as soon as
   the proxy's scheme or host do not reach the backend unchanged.

## Helply's workspace (optional sandbox)

Helply can run code (Python with pandas, numpy, openpyxl, pypdf, pdfplumber and matplotlib) on the
files a user attaches, in a microVM without network. It is off for every user until they turn on
"Workspace (run code)" in Helply's settings, and the server only offers it when the sidecar is
configured. Without it Helply works as before.

**Requirements:** `/dev/kvm` on the host (`ls -l /dev/kvm`; nested virtualisation on a VPS).

**Enable:** in `.env`

```sh
COMPOSE_PROFILES=sandbox
HELPLY_SANDBOX_URL=http://sandbox:8080
SANDBOX_API_KEY=$(openssl rand -hex 32)   # at least 32 characters; the sidecar refuses to start otherwise
```

then `docker compose up -d sandbox` and `docker compose up -d --force-recreate --no-deps backend`.
The backend logs `Helply's workspace sandbox is configured` once it sees both settings
(`Helply__Sandbox__BaseUrl`, `Helply__Sandbox__ApiKey`).

**How it is isolated**

- The sidecar drives [microsandbox](https://github.com/superradcompany/microsandbox) (`msb`),
  pinned to **0.7.4 by tag and digest**. microsandbox is **beta software**: upgrade it only
  deliberately, re-testing the flags in `src/Schuly.Sandbox/Msb.cs`, never by following `latest`.
- Every VM: `--no-net`, 256 MB memory, 1 CPU, 1 GB root disk, a 256 MB quota'd `/workspace`, idle
  timeout 10 minutes, maximum life 30 minutes. At most 2 VMs run at once (the third request gets
  "busy, try again"). Commands run as uid 1000 under `setpriv --no-new-privs`; at every boot setuid
  bits and `/dev/kvm` are stripped inside the guest and the result is checked.
- Network: with `--no-net` (verified on a real VM) every outbound connection is refused; only
  msb's own gateway DNS answers on port 53, with NXDOMAIN, so names never resolve.
- The container: only `/dev/kvm`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit: 1g`,
  `pids_limit: 256`, on the `sandbox` network, which is `internal` (no internet) and shared with the
  backend alone. It gets `SANDBOX_API_KEY` and nothing else.
- The sidecar answers only requests with the key (compared in constant time), checks every sandbox
  id and path, never uses a shell for its own commands, caps output and file sizes, and never
  follows a symlink the guest planted when copying files in or out.

**Retention:** a workspace belongs to one conversation and is wiped when Helply's reply ends (a
reply waiting for an approval keeps it until it goes on). Anything left over stops after 10 idle
minutes and the sidecar sweeps stopped VMs every 5 minutes, so nothing lives for hours.
`data/sandbox` only ever holds the disks of running VMs.

**Limits per user:** 15 minutes of command time per day (`Helply__Sandbox__SecondsPerUserPerDay`),
at most 60 seconds per command.

**Memory:** budget about 1 GB for the sidecar on the host; with the profile off it uses nothing.

## Helply's attachments

Files attached in Helply chats (images, PDF, text, CSV, Markdown, Word, Excel, PowerPoint; 20 MB
each, 5 per message) are stored in Postgres, encrypted with a key derived from `VAULT_MASTER_KEY`.
They go with their conversation (deleted, or expired after 30 days), and an upload that is never
sent is removed after 24 hours. No extra setting is needed.

## Verify end-to-end

- `https://${API_HOST}/api/app/school-systems` → anonymous catalog (proves the API
  is up).
- Register an account (`POST https://${API_HOST}/auth/register`, or through
  the web app at `https://${API_HOST}`), then sign in.
- Plugins are declared in `plugins.yml`; the backend log lists what was loaded.
- Point the Schuly app at `https://${API_HOST}`; it signs in against the backend's
  `/auth` endpoints.

## Notes

- To change the plugins, edit `config/plugins.yml` and restart the backend.
- All state is **bind-mounted to host folders under `./data`** (recommended over
  named volumes - visible and easy to back up): `data/postgres`, `data/seaweedfs`,
  `data/plugins`, `data/caddy*`. They're created on first `up`; the one-shot
  `init-perms` service makes `data/plugins` writable by the backend automatically, so
  it works first run with no manual `chown`. To wipe, stop the stack and delete `./data`.
