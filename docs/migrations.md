# Migrations

Use this page to add and manage EF Core migrations. They live in `Schuly.Infrastructure`, with
`Schuly.API` as the startup project. The scripts in `scripts/` wrap the `dotnet ef` commands.

## Prerequisites

- Install the tool: `dotnet tool install --global dotnet-ef`.
- Run a Postgres that the `SchulyDatabase` connection string can reach. See
  [Configuration](setup/configuration.md). For local work, run
  `docker compose -f compose.dev.yml up -d`.

## Add and manage migrations

```sh
./scripts/migration.sh add <Name>      # add a new migration
./scripts/migration.sh remove          # remove the last migration
./scripts/migration.sh list            # list all migrations
./scripts/migration.sh update [Name]   # apply migrations, optionally up to <Name>
./scripts/migration.sh drop            # drop the database
```

Each subcommand uses `--project src/Schuly.Infrastructure --startup-project src/Schuly.API`.

On Windows, use `scripts/migration.ps1` or `scripts/migration.bat` with the same subcommands.

## Manage the dev database on Windows

`scripts/DbScript.ps1` controls the database in `compose.dev.yml`. Run it with `-help` for the command
list.

| Command | What it does |
|---|---|
| `-start-db` | Starts the compose stack |
| `-stop-db` | Stops the compose stack |
| `-recreate-db` | Stops the stack, runs `docker volume prune -f`, and starts it again |

Don't use its `-add-migration`, `-delete-migrations`, or `-full-reset` commands. They point at
`src\DockiUp.Infrastructure`, which doesn't exist in this repo. Use the migration scripts instead.

## Applied at startup

The API applies migrations when it starts: `ApplyMigrations()` in `Program.cs` calls
`db.Database.Migrate()`. It then seeds the school-systems catalog if entries are missing. You don't need
a manual apply step in development or production.
