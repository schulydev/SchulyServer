// Takes the sign-in page screenshots (the Overview in light and dark) against the fake API.
// Usage: bun tools/screenshots/capture.ts [--now <ISO time>] [--out <dir>] [--browser <path>] [--port 4331] [--lang en-US] [--dry-run]
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';

const root = resolve(import.meta.dir, '../..');
const frontend = join(root, 'src/Schuly.Frontend');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const dryRun = process.argv.includes('--dry-run');
const out = resolve(arg('--out') ?? join(frontend, 'public/screens'));
const browserPath = [
  arg('--browser'),
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('No Chrome or Edge found. Pass --browser <path> or set CHROME_PATH.');
const cdpPort = 9339;
const port = Number(arg('--port') ?? 4331);
const lang = arg('--lang') ?? 'en-US'; // the web app follows the browser language
const apiPort = 5048; // must match proxy.json

// Default: today at 13:03 local time, 12 minutes before the end of the fifth lesson, as in the published shots.
const today = new Date(); today.setHours(13, 3, 0, 0);
const now = new Date(arg('--now') ?? today.toISOString());
if (Number.isNaN(now.getTime())) throw new Error('--now must be an ISO date and time, e.g. 2026-11-06T13:03:00+01:00');

const children: Subprocess[] = [];
const stopAll = () => {
  for (const p of children) {
    if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/pid', String(p.pid), '/t', '/f'], { stdout: 'ignore', stderr: 'ignore' });
    else p.kill();
  }
};
process.on('SIGINT', () => { stopAll(); process.exit(130); });

async function waitFor(url: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await Bun.sleep(1000);
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

// A minimal CDP client: send(method, params) resolves with the result of that call.
async function connect(url: string) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.fail(new Error(msg.error.message)); else p.ok(msg.result);
  };
  return (method: string, params: object = {}) => new Promise<unknown>((ok, fail) => { pending.set(++id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); });
}

try {
  children.push(Bun.spawn(['bun', join(import.meta.dir, 'fake-api.ts')], { env: { ...process.env, PORT: String(apiPort), SHOTS_NOW: now.toISOString() }, stdout: 'inherit', stderr: 'inherit' }));
  await waitFor(`http://127.0.0.1:${apiPort}/api/app`, 10_000);
  const agenda = (await (await fetch(`http://127.0.0.1:${apiPort}/api/agendas`)).json()) as unknown[];
  console.log(`fake API up, ${agenda.length} agenda entries for ${now.toString()}`);

  // --host: ng serve otherwise listens on ::1 only, which Bun's fetch of 127.0.0.1 doesn't reach.
  const serve = ['bun', 'run', 'ng', 'serve', '--host', '127.0.0.1', '--port', String(port), '--proxy-config', join(import.meta.dir, 'proxy.json')];
  if (dryRun) {
    console.log(`dry run: would run "${serve.join(' ')}" in ${frontend},`);
    console.log(`open http://127.0.0.1:${port}/ in ${browserPath} at 1440x900 in ${lang} with the clock at ${now.toISOString()}, and write overview-light.png and overview-dark.png to ${out}`);
  } else {
    children.push(Bun.spawn(serve, { cwd: frontend, stdout: 'ignore', stderr: 'inherit' }));
    await waitFor(`http://127.0.0.1:${port}/`, 240_000);

    // The installed browser in headless mode, driven over the Chrome DevTools Protocol with Bun's own WebSocket.
    // No Playwright: its launch and its CDP client both hang under Bun on Windows. Nothing is downloaded.
    const profile = mkdtempSync(join(tmpdir(), 'schuly-shots-'));
    children.push(Bun.spawn([browserPath, '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run', `--lang=${lang}`, `--accept-lang=${lang}`, '--window-size=1440,900', 'about:blank'], { stdout: 'ignore', stderr: 'ignore' }));
    await waitFor(`http://127.0.0.1:${cdpPort}/json/version`, 30_000);
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const cdp = await connect(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
      await cdp('Page.enable');
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp('Emulation.setLocaleOverride', { locale: lang });
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      // Freeze the page's clock at --now, like Playwright's clock.setFixedTime. Timers keep running.
      await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const T = ${now.getTime()}; const D = Date; class F extends D { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } } window.Date = F; })();` });
      await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });
      await Bun.sleep(4000);
      const evaluate = async (expression: string) => ((await cdp('Runtime.evaluate', { expression, returnByValue: true })) as { result: { value: unknown } }).result.value;
      for (let i = 0; i < 2; i++) {
        const dark = await evaluate("document.documentElement.classList.contains('dark')");
        const file = join(out, dark ? 'overview-dark.png' : 'overview-light.png');
        const { data } = (await cdp('Page.captureScreenshot', { format: 'png' })) as { data: string };
        await Bun.write(file, Buffer.from(data, 'base64'));
        console.log(`wrote ${file}`);
        if (i === 0) {
          await evaluate("[...document.querySelectorAll('header button')].at(-1).click()"); // the theme toggle
          await Bun.sleep(800);
        }
      }
    } finally {
      stopAll();
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { console.warn(`could not remove ${profile}; delete it later`); }
    }
  }
} finally {
  stopAll();
}
