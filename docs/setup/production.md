# Images and releases

The API ships as a multi-arch Docker image built from `src/Schuly.API/Dockerfile`.

## Container image

- **Build context is `./src`.** The Dockerfile's `COPY` paths are relative to that
  directory, not the repo root.
- Build stages: SDK build/publish on `mcr.microsoft.com/dotnet/sdk:10.0`, runtime on
  `mcr.microsoft.com/dotnet/aspnet:10.0`. Entry point is `dotnet Schuly.API.dll`.
- The repo-root `application.properties` (which `Directory.Build.props` normally reads
  for the version) is **not** in the build context, so the image is built with
  `-p:Version=$VERSION`. The release workflow passes the release tag as `VERSION`;
  this keeps the host assembly version aligned with what runtime-loaded plugins bind
  against.
- The image pre-creates `/app/plugins` and `/app/plugins-config` for runtime-loaded
  plugins and their per-plugin config.

## Versioning + release

Single source of truth: **`application.properties`** (`<version>`). `src/Directory.Build.props`
reads it via `XmlPeek`.

Publishing a GitHub Release triggers `docker-publish-release.yaml`:

1. **`sync-version`** - compares the release tag (`v` stripped) against
   `application.properties`. If they differ, it opens a `release-sync/<version>`
   branch updating the file and auto-merges (squash) the PR into `main`.
2. **`build-and-push-multiarch`** - builds `linux/amd64` + `linux/arm64` from `./src`
   and pushes tags:
   - `ghcr.io/schulydev/schuly:<semver>` plus `:<major>`, `:<major>.<minor>`, and
     `:latest` (latest only for non-prereleases).
   - `<DOCKERHUB_USERNAME>/schuly:<semver>` (Docker Hub, **best-effort** - the login
     step is `continue-on-error`).

## Migrations on startup

The container applies EF Core migrations automatically at startup
(`ApplyMigrations()` in `Program.cs` → `db.Database.Migrate()`) and seeds the
school-systems catalog. No separate migration step is required when deploying; ensure
the database is reachable via the `SchulyDatabase` connection string. See
[Migrations](../migrations.md) and [Configuration](configuration.md).
