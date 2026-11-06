# Sign-in screenshots

Makes the two Overview screenshots on the web app's sign-in page: `src/Schuly.Frontend/public/screens/overview-light.png` and `overview-dark.png` (1440×900). SchulyWebsite also uses the dark one, cropped, in its hero and social image (see its `tools/hero-images`).

The web app runs against a fake API with made-up data (Mia Muster, `mia@example.org`), so no backend, database or real account is needed.

| File | What it does |
|---|---|
| `fake-api.ts` | Bun server on port 5048 that answers the `/auth` and `/api` calls the Overview makes. The school day starts at 07:30 on the current day; the time decides which lesson is running. |
| `pfp.svg` | Mia's made-up profile picture. The API sends it as a data URL. |
| `proxy.json` | `ng serve` proxy config that sends `/api` and `/auth` to the fake API. |
| `capture.ts` | Starts the fake API and `ng serve`, opens the app in your installed Chrome or Edge (headless), takes the light shot, clicks the theme button and takes the dark shot. |

## Prerequisites

- Bun.
- `bun install` in `src/Schuly.Frontend`, for `ng serve`.
- Google Chrome or Microsoft Edge. The script looks in the usual install folders; otherwise pass `--browser <path>` or set `CHROME_PATH`. Nothing is downloaded.

`capture.ts` drives the browser itself over the Chrome DevTools Protocol, with Bun's built-in WebSocket. It doesn't use Playwright, because both Playwright's launch and its CDP connection hang under Bun on Windows. The page's clock is frozen at `--now` the same way Playwright's `clock.setFixedTime` would freeze it.

## Regenerate

From the repo root:

```sh
bun tools/screenshots/capture.ts
```

This writes both PNGs to `src/Schuly.Frontend/public/screens/`. It takes a minute or two, mostly while `ng serve` compiles.

| Option | Default | |
|---|---|---|
| `--now <ISO time>` | today at 13:03 local time | The browser's clock and the fake API's "now". 13:03 puts the screenshot 12 minutes before the end of the fifth lesson. To get the published shots exactly, use `2026-11-06T13:03:00+01:00`. |
| `--out <dir>` | `src/Schuly.Frontend/public/screens` | |
| `--browser <path>` | Chrome, then Edge | The browser executable. |
| `--lang <tag>` | `en-US` | The browser language, which picks the web app's language. |
| `--port <n>` | `4331` | The port for `ng serve`, which listens on `127.0.0.1`. |
| `--dry-run` | | Starts the fake API, checks that it answers, prints the plan and stops. It doesn't build the app or open a browser. |

The fake API port is fixed at 5048 in `proxy.json` and `capture.ts`. If you change it, change both.

On Windows the headless browser can still hold its temporary profile when the script ends. The script then prints the folder's path, and you can delete it later.

The published shots came from an earlier build of the web app. A run on the current `main` matches them, except for the date formats: they now say `Tue, 10 Nov` where the published shots have `Di., 10. Nov.`.

To look around by hand instead, run `bun tools/screenshots/fake-api.ts`, then run `bun run ng serve --port 4331 --proxy-config ../../tools/screenshots/proxy.json` in `src/Schuly.Frontend`. Open <http://localhost:4331/> in a 1440×900 viewport. `GET /__scene/notimetable` or `/__scene/calm` on the fake API switches to an empty timetable or a quiet week; `/__scene/morning` switches back.

## Licences

All data is made up. The school website in `fake-api.ts` only selects which school's rules the web app applies, such as the absence fee shown on the Overview.
