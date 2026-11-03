# Contributing

Use this page for the rules and checks specific to the server. For issues, branches, pull requests,
and labels, follow the [shared workflow](/contribute/).

## Code rules

- Respect the [layering rules](architecture.md#layering-rules): `Schuly.Application` must not reference
  `Schuly.Infrastructure`.
- Keep controllers thin. They delegate to Mediator, and handlers hold the logic.
- Add tests to `Schuly.Tests` where it makes sense.
- Keep declaration signatures on one line, however long. Don't wrap the parameter list of a `record`,
  a primary-constructor `class` or `struct`, a method, or a constructor. Leave method chains, LINQ
  queries, and multi-line conditions wrapped.
- Use Bun for frontend tasks, not npm, npx, or node.
- Keep the commit body focused on what changed and why.

## Versioning

Don't bump `application.properties` by hand in feature pull requests. Publishing a release syncs it
from the tag. See [Images and releases](setup/production.md).

## Checks

CI runs these on every pull request. To run them yourself:

```sh
dotnet restore Schuly.API.slnx
dotnet build Schuly.API.slnx -c Release --no-restore -warnaserror
dotnet test Schuly.API.slnx -c Release --no-build
```

```sh
cd src/Schuly.Frontend
bun install --frozen-lockfile
bun run build
bun run test --watch=false
```

CI also builds the sandbox image when a pull request changes `src/Schuly.Sandbox/**`.
