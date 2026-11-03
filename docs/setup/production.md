# Images and releases

Use this page to see how the server's Docker images are built and published. The API ships as a
multi-arch image built from `src/Schuly.API/Dockerfile`.

## Container image

- **Build context:** `./src`. The Dockerfile's `COPY` paths are relative to it, not to the repo root.
- **Build stages:** the frontend builds with `oven/bun:1.3.5` and `node:24-slim`, and its output goes
  into `wwwroot`. The API builds and publishes on `mcr.microsoft.com/dotnet/sdk:10.0`.
- **Runtime:** `mcr.microsoft.com/dotnet/aspnet:10.0`. The entry point is `dotnet Schuly.API.dll`.
- **Version:** `Directory.Build.props` normally reads the version from the repo-root
  `application.properties`, but that file isn't in the build context. The image is built with
  `-p:Version=$VERSION` instead, and the release workflow passes the release version. This keeps the
  host assembly version aligned with what runtime-loaded plugins bind against.
- **Plugin folders:** the image creates `/app/plugins` and `/app/plugins-config` for runtime-loaded
  plugins and their config.

## Versioning and releases

`application.properties` (`<version>`) is the single source of truth. `src/Directory.Build.props` reads
it.

Publishing a GitHub release starts `docker-publish-release.yaml`:

1. **`sync-version`:** compares the release tag, without its `v`, to `application.properties`. If they
   differ, it updates the file and squash-merges a `release-sync/<version>` pull request into `main`.
2. **`build-and-push-multiarch`:** builds `linux/amd64` and `linux/arm64` from `./src` and pushes to
   `ghcr.io/schulydev/schuly` and `<DOCKERHUB_USERNAME>/schuly`. The Docker Hub login step is
   `continue-on-error`.
3. **`build-and-push-sandbox`:** builds the sandbox sidecar for `linux/amd64` from
   `src/Schuly.Sandbox/Dockerfile` and pushes it to `ghcr.io/schulydev/schuly-sandbox`.

Each image gets the tags `<semver>`, `<major>.<minor>`, and `<major>`, plus `latest` for
non-prereleases.

## Migrations on startup

The container applies EF Core migrations at startup (`ApplyMigrations()` in `Program.cs` calls
`db.Database.Migrate()`) and seeds the school-systems catalog. You don't need a separate migration step
when you deploy. Make sure the `SchulyDatabase` connection string can reach the database. See
[Migrations](../migrations.md) and [Configuration](configuration.md).
