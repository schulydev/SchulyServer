# Development setup

Use this page to run the API, the web app, and their dependencies on your machine.

## Prerequisites

- .NET 10 SDK
- Docker
- Bun, for the web app
- Optional: the `dotnet-ef` tool for [migrations](../migrations.md)
  (`dotnet tool install --global dotnet-ef`)

## 1. Start the dependencies

```sh
docker compose -f compose.dev.yml up -d
```

| Service | Image | Host port | Notes |
|---|---|---|---|
| Postgres | `postgres:18.1` | `2406` | Database `schuly-dev` |
| SeaweedFS | `chrislusf/seaweedfs:latest` | `8333`, `9333`, `8888` | S3 API, master UI, filer |
| SchulwareAPI | `ghcr.io/pianonic/schulwareapi:latest` | `8000` | Schulnetz bridge for the Schulware plugin |

Sign-in mail, such as verification and password reset, goes to an SMTP catcher on `localhost:1025`, as
set in `appsettings.Development.json`. `compose.dev.yml` doesn't include one, so start it yourself:

```sh
docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
```

The inbox is at [http://localhost:8025](http://localhost:8025). Links in the mails point at
`http://localhost:4200`.

## 2. Point the API at them

The repo ships no connection string, so a fresh clone stops on startup with
`The ConnectionString property has not been initialized.` Store the local values in
[user secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets), which keeps them out of
git:

```sh
cd src/Schuly.API
dotnet user-secrets set "ConnectionStrings:SchulyDatabase" "Host=localhost;Port=2406;Database=schuly-dev;Username=postgres;Password=d4vpas8w0rd13!!!"
dotnet user-secrets set "LocalLogin:SigningKey" "$(openssl rand -base64 32)"
dotnet user-secrets set "TwoFactor:EncryptionKey" "$(openssl rand -base64 32)"
```

The connection string restates `compose.dev.yml`. The two keys sign access tokens and encrypt
two-factor secrets. Keep them once you set them: a new signing key signs everybody out, and a new
encryption key breaks two-factor. You can use environment variables instead. See
[Configuration](configuration.md).

To use documents and pictures, also set the `S3:` keys. The dev S3 credentials
are in `scripts/seaweedfs/s3-config.json`.

In Development, the server starts without `Vault:MasterKey` and `Documents:EncryptionKey`. It then uses
temporary keys, so stored plugin credentials, encrypted documents, absence reasons and document metadata don't survive a restart.

## 3. Run the API

```sh
cd src/Schuly.API
dotnet run --urls=http://localhost:5033
```

On startup, the API applies EF Core migrations and seeds the school-systems catalog, so the database is
ready on the first run. In Development, it also turns on request logging and the API reference UI.

## 4. Run the web app

```sh
cd src/Schuly.Frontend
bun install
bun start        # ng serve on http://localhost:4200
```

`proxy.conf.json` forwards `/api` and `/auth` to `http://127.0.0.1:5033`.

## Get a token

Register through the web app, or call the sign-in endpoints:

```sh
curl -X POST http://localhost:5033/auth/register -H "Content-Type: application/json" \
  -d '{"userName":"dev","email":"dev@example.com","password":"<password>"}'
curl -X POST http://localhost:5033/auth/login -H "Content-Type: application/json" \
  -d '{"identifier":"dev","password":"<password>"}'
```

`appsettings.json` sets `LocalLogin:RequireVerifiedEmailForSignIn` to `true`, so verify the address
through the mail in the inbox before you log in.

The login response carries the access token. Send it as `Authorization: Bearer` to `/api/*`, or paste it
into the Scalar UI. See [Configuration](configuration.md#sign-in).

## API reference

- **Scalar UI:** [http://localhost:5033/scalar](http://localhost:5033/scalar)
- **OpenAPI 3.0 document:**
  [http://localhost:5033/openapi/v1.json](http://localhost:5033/openapi/v1.json). The built-in
  `Microsoft.AspNetCore.OpenApi` produces it, and the Dart client is generated from it.

## Run the tests

```sh
dotnet test
```

The suite is [TUnit](https://tunit.dev/), which runs on Microsoft.Testing.Platform. The .NET 10 SDK no
longer runs these projects through VSTest, so `global.json` opts the repo into MTP mode. Without it,
`dotnet test` fails with `Testing with VSTest target is no longer supported`.

To run the project directly:

```sh
dotnet run --project src/Schuly.Tests
```

To test the web app:

```sh
cd src/Schuly.Frontend
bun run test --watch=false
bun run e2e                 # playwright test
```
