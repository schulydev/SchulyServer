# SchulyServer documentation

SchulyServer is the ASP.NET Core 10 API and web app behind Schuly. It follows clean architecture
with CQRS (via [Mediator](https://github.com/martinothamar/Mediator)), uses EF Core on PostgreSQL,
has sign-in built in, and loads plugins at runtime from a registry.

## Run a server

- [Self-host Schuly](setup/self-hosting.md)
- [Run without a domain](setup/self-hosting-lan.md)
- [Run and upgrade your server](setup/operations.md)
- [Configuration](setup/configuration.md)
- [Plugin management](plugin-management.md)

## Work on the code

- [Development setup](setup/development.md)
- [Architecture](architecture.md)
- [Migrations](migrations.md)
- [Images and releases](setup/production.md)
- [Contributing](contributing.md)
