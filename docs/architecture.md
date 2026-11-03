# Architecture

Use this page to find where code belongs in SchulyServer and how to add to it. The server is a
clean-architecture solution with CQRS. Thin controllers send commands and queries through
[Mediator](https://github.com/martinothamar/Mediator) to handlers in the application layer.
Persistence and external integrations live in infrastructure.

## Projects

The solution file is `Schuly.API.slnx`.

| Project | Role |
|---|---|
| `Schuly.API` | Entry point. Controllers, sign-in wiring and `/auth` endpoints, OpenAPI and Scalar, startup migrations, plugin host, MCP server, Helply. Owns the API `Dockerfile`. |
| `Schuly.Application` | CQRS commands and queries, Mediator handlers, DTOs, mappers, authorization and pipeline behaviors. Must not reference Infrastructure. |
| `Schuly.Domain` | Pure entities (`School`, `Class`, `Exam`, `Grade`, `Absence`, `AgendaEntry`, `ApplicationUser`, `SchoolUser`, `Teacher`, `SchoolSystem`, `SemesterReport`, `StudentDocument`, and more). Each inherits `Base` (`Id`, `CreatedAt`, `UpdatedAt`). |
| `Schuly.Infrastructure` | `SchulyDbContext` (including the sign-in tables), user services, storage, the plugin secrets vault, the plugin contract services (`Plugins/`), repositories. |
| `Schuly.Sandbox` | Helply's sandbox sidecar, with its own image `ghcr.io/schulydev/schuly-sandbox`. |
| `Schuly.Frontend` | The Angular 22 web app, built with Bun. It isn't part of the solution file. The API image serves it from `wwwroot`. |
| `Schuly.Tests`, `Schuly.Tests.Plugin` | Test projects (TUnit). |

`Schuly.Plugin.Abstractions` is a NuGet `PackageReference`, not a project reference. The abstractions
and the plugins live in separate repositories.

## Layering rules

- Dependencies point inward: `API → Application → Domain`, and `Infrastructure → Application/Domain`.
- `Schuly.Application` must not reference `Schuly.Infrastructure`. Handlers depend on abstractions,
  and the API project registers the concrete services in `Program.cs`.
- `Schuly.Domain` has no project dependencies.

## Request pipeline

`Program.cs` registers three pipeline behaviors, which run in this order:

1. `AuthorizationBehavior`: throws if a request type has no `[AllowAuthenticated]` attribute.
2. `NotificationOriginBehavior`: marks the request as user-initiated, so the user's own actions never
   produce a push notification.
3. `PluginEventBehavior`: sends backend commands to plugin event handlers.

Mediator source generation registers handlers, so adding the classes is enough.

## Add an entity and endpoint

1. **Entity:** add it to `Schuly.Domain`, inheriting `Base`.
2. **DbSet and configuration:** add them to `Schuly.Infrastructure/SchulyDbContext.cs`.
3. **Migration:** see [Migrations](migrations.md).
4. **Command or query:** add it to `Schuly.Application/Commands/<Entity>/` or `Queries/<Entity>/`.
5. **Handler:** add it next to the command or query.
6. **Controller:** add a thin one to `Schuly.API/Controllers/` that delegates to Mediator.

## Document storage

Student documents and avatars live in an S3-compatible bucket. The bundled dev and self-hosting stacks
use SeaweedFS, and any S3 implementation works without a code change. See
[Configuration](setup/configuration.md#document-storage-s3) for the settings.

The backend proxies every byte. Clients never receive S3 URLs or connect to storage directly:

- Upload with `POST /api/students/{id}/documents` (multipart).
- Download from `GET /api/documents/{id}`, which returns a file response.

Avatars are the one exception. You upload them with `PUT /api/me/avatar`, and the database holds only
a bare blob key. The server creates a short-lived HMAC-signed URL under `/api/avatars/users/{id}` for
each access. See [Avatar URL signing](setup/configuration.md#avatar-url-signing).

## MCP server and Helply

`/mcp` is a stateless Streamable HTTP server. Its tools live in `Schuly.API/Mcp/Tools`, and its auth
lives in `Schuly.Infrastructure/Mcp`. MCP tokens and `/api` JWTs don't work on each other's endpoints.

Every tool needs `[McpAccess(area, level)]`, and deletes also need `[McpDestructive]`. A new tool
without `[McpAccess]` is visible to every connection.

Helply is in `Schuly.API/Helply`. See [Configuration](setup/configuration.md#helply) for Helply and
[MCP server](setup/configuration.md#mcp-server) for the MCP settings.

## Plugin host

The backend hosts plugins that implement `ISchulyPlugin` from `Schuly.Plugin.Abstractions`. The runtime
is in `Schuly.API/Plugins`:

- It downloads plugins from a registry into `/app/plugins` at runtime.
- It loads each plugin into its own collectible `AssemblyLoadContext`, with a child DI container.
- Plugins can register controllers, minimal-API endpoints, and recurring background tasks. The host's
  scheduler runs each task by name in the owning plugin's DI scope.
- `PluginScopeMiddleware` runs plugin requests in the owning plugin's DI scope.

See [Plugin management](plugin-management.md) for the registry, hot-swap, and background tasks.

### What a plugin can reach

Plugins never get `SchulyDbContext` or the backend's entities. The host registers these contract
services in each plugin's container:

| Service | Backed by |
|---|---|
| `ISchoolData` | `PluginSchoolData` over `SchulyDbContext`, stamped with the plugin's assembly name as `Source` |
| `IPluginVault` | The persistent vault, namespace `plugin:<Name>` |
| `IPluginFileStore` | `IDocumentStorage` (encrypted S3) |
| `IPluginUserContext` | The current request's user |

Synced rows (`AgendaEntry`, `Absence`, `Grade`, `StudentDocument`) carry `Source` and `ExternalId`,
unique per student. A null `Source` means someone entered the row by hand, and no plugin touches it.

A plugin may write only to students whose `SchoolUser.Source` is its own. The first plugin that
provisions or syncs a student with no source adopts that student.

### Hand-entered data

Schuly works without any plugin. Under `api/me`, a signed-in user can:

- Create their own school with `POST api/me/schools`, which makes them its student.
- Add, change, and remove their own grades with `api/me/grades`. The subject and exam are created as
  needed.

Absences and agenda entries use the regular endpoints. Hand-entered rows have a null `Source`, so no
sync touches them. The API refuses a manual change or delete of a synced row and names the plugin.

Times on manual writes must carry a UTC offset (`...Z` or `+02:00`). The API rejects times without one.

### Contract compatibility

Before it creates a plugin, `PluginContract` checks which `Schuly.Plugin.Abstractions` version the
plugin was built against:

- **Before 1.0:** the MAJOR.MINOR must match.
- **From 1.0:** the MAJOR must match, and the plugin's MINOR can't be newer than the host's.

`PluginContract` also refuses a plugin that references `Schuly.Domain`, `Schuly.Infrastructure`,
`Schuly.Application`, or `Schuly.API`. Refusal errors name both versions.
