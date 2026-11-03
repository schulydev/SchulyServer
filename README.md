<p align="center">
  <img src="./assets/app_icon.png" width="120" alt="Schuly Logo" />
</p>
<p align="center">
  <strong>SchulyServer</strong><br/>
  Your own Schuly: the API, the web app and the plugin host, behind one domain.
</p>
<p align="center">
  <a href="https://docs.schuly.dev/SchulyServer/setup/self-hosting"><img src="https://img.shields.io/badge/Self--Host-Instructions-3da8ff.svg" alt="Self-hosting" /></a>
  <img src="https://img.shields.io/badge/.NET-10-3da8ff.svg" alt=".NET 10" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm%20Noncommercial-3da8ff.svg" alt="PolyForm Noncommercial" /></a>
</p>

---

## Self-host

You need a Linux server with Docker, a domain pointing at it, ports 80 and 443 open, and an SMTP server.

```sh
curl -fsSL https://github.com/schulydev/SchulyServer/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 SchulyServer-main/deploy
cd deploy
cp .env.example .env
```

Fill in `.env` as the [self-hosting guide](https://docs.schuly.dev/SchulyServer/setup/self-hosting) explains. Some of those keys can't be changed later without their rotation steps, so read it first. Then:

```sh
docker compose -f compose.staging.yml up -d
```

Caddy gets the certificate, and the server sets up its database and downloads its plugins. No domain? [Run it on your local network](https://docs.schuly.dev/SchulyServer/setup/self-hosting-lan) instead.

## What runs

Caddy is the only part reachable from the internet. Behind it are the server, PostgreSQL, SeaweedFS for documents, [SchulwareAPI](https://github.com/PianoNic/SchulwareAPI) for Schulnetz and [SchulyMicrosoft](https://github.com/schulydev/SchulyMicrosoft) for Microsoft 365.

School systems come from plugins, not from the server. List one in `config/plugins.yml`, restart, and it shows up in the app.

## Documentation

- [Operations](https://docs.schuly.dev/SchulyServer/setup/operations): backups, upgrades and data retention
- [Configuration](https://docs.schuly.dev/SchulyServer/setup/configuration): every setting
- [Plugin management](https://docs.schuly.dev/SchulyServer/plugin-management): choose which school systems you offer
- [Development setup](https://docs.schuly.dev/SchulyServer/setup/development): run it from source, with the API reference at `/scalar`
- [Architecture](https://docs.schuly.dev/SchulyServer/architecture): how the code is layered

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Read it, change it and run it for any noncommercial purpose. Selling it or hosting it as a paid service isn't licensed. Source-available, not open source.
