import AxeBuilder from '@axe-core/playwright';
import { Locator, Page, expect, test } from '@playwright/test';
import { ALPHA_ACCOUNT, FakeAccount, FakeServer } from './fake-server';

test.use({ locale: 'de-CH', timezoneId: 'Europe/Zurich', viewport: { width: 1280, height: 800 } });

const ACCOUNT: FakeAccount = {
  providerId: 'microsoft',
  providerName: 'Microsoft',
  id: 'm1',
  title: 'Mia Microsoft',
  status: 'ok',
  capabilities: [{ kind: 'drive', label: 'Files', basePath: '/api/plugins/microsoft/accounts' }],
  canReauth: true,
};

// Ids are opaque to the app: long, random looking, with characters that need encoding in a path.
const TEAM_A = 'c4b1f6e2-9a0d-4d57-8f3e-5b2a7c9d1e60';
const TEAM_B = 'e7d20a91-31bc-49ae-b6f4-0c8d5a3f2b17';
const CHANNEL_GENERAL = '19:Zk3vQp9Xw_LrT2hN8bYcA5mEoUdJ7sFgI1tRxV4nKqM-6a@thread.tacv2';
const CHANNEL_DEUTSCH = '19:Hq8sLw2Tn_Vb7YcR4pXe9mUoAdJ3kFgI5tZxN1vKqM-0b@thread.tacv2';
const TEAM_DRIVE = 'b!Qm7vX2kLw9RtY_4pZe-8nUoAdJ3sFgI1hTcV5xKqN0bM6aWyE2rCdPlOjHzGfS';
const FOLDER_ID = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ234567abcdefghijkl';
const SUB_ID = '01ZYXWVUTSRQPONMLKJIHGFEDCBA765432lkjihgfedcba';
const FILE_ID = '01QRSTUVWXYZ234567ABCDEFGHIJKLMNOPabcdefghijkm';
const SEARCH_ID = '01MNOPQRSTUVWXYZ234567ABCDEFGHIJKLabcdefghijkn';
const SHARED_DRIVE = 'b!Sh4redDr1veIdWithLongOpaqueText_-0123456789abcdefghijklmnopqrstuvwx';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const file = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  size: 120,
  file: { mimeType: 'text/plain' },
  lastModifiedDateTime: hoursAgo(5),
  parentReference: { driveId: TEAM_DRIVE },
  ...extra,
});

let server: FakeServer;
let urls: string[];
let searchBodies: Record<string, unknown>[];
let teamsFail: boolean;

test.beforeEach(async ({ page }) => {
  server = new FakeServer();
  server.accounts = [ALPHA_ACCOUNT, ACCOUNT];
  await server.install(page);
  urls = [];
  searchBodies = [];
  teamsFail = false;
  page.on('request', (request) => urls.push(request.url()));
  const base = '**/api/plugins/microsoft/accounts/m1';
  await page.route(`${base}/files?*`, (route) =>
    route.fulfill({
      json: [
        { id: 'own1', name: 'My homework.txt', size: 12, file: { mimeType: 'text/plain' }, lastModifiedDateTime: hoursAgo(2), '@microsoft.graph.downloadUrl': 'https://download.example/own1' },
        { id: 'own2', name: 'Private folder', folder: { childCount: 1 }, lastModifiedDateTime: hoursAgo(3) },
      ],
    }),
  );
  await page.route(`${base}/teams`, (route) =>
    teamsFail
      ? route.fulfill({ status: 500, json: { detail: 'boom' } })
      : route.fulfill({
          json: [
            { id: TEAM_A, displayName: 'BM23d ab 2025' },
            { id: TEAM_B, displayName: 'Informatik Berufsmaturitaet Vollzeit Sommersemester Klasse 2027 mit sehr langem Namen' },
          ],
        }),
  );
  await page.route(`${base}/teams/*/channels`, (route) =>
    route.fulfill({
      json: [
        { id: CHANNEL_GENERAL, displayName: 'General' },
        { id: CHANNEL_DEUTSCH, displayName: 'Deutsch und Kommunikation Vertiefung Gruppenarbeit' },
      ],
    }),
  );
  await page.route(`${base}/teams/*/files*`, (route) => {
    const channel = new URL(route.request().url()).searchParams.get('channelId');
    return route.fulfill({
      json: {
        driveId: TEAM_DRIVE,
        folder: { id: FOLDER_ID, name: channel ? 'Deutsch' : 'Team' },
        items: [file(FOLDER_ID, 'Pruefungen', { folder: { childCount: 1 }, file: undefined }), file(FILE_ID, 'Stundenplan.txt')],
      },
    });
  });
  await page.route(`${base}/files/shared*`, (route) =>
    route.fulfill({
      json: [
        file('sh1', 'Klassenliste.txt', { parentReference: { driveId: SHARED_DRIVE }, shared: { sharedBy: { displayName: 'Frau Muster', email: 'muster@school.example' } } }),
      ],
    }),
  );
  await page.route(`${base}/files/recent*`, (route) => route.fulfill({ json: [file('rc1', 'Zuletzt geoeffnet.txt', { parentReference: { driveId: SHARED_DRIVE } })] }));
  await page.route(`${base}/drives/*/items/*/children*`, (route) => route.fulfill({ json: [file(SUB_ID, 'Mathe Pruefung.txt')] }));
  await page.route(`${base}/drives/*/items/*/content`, (route) => route.fulfill({ contentType: 'text/plain', body: 'Hello from the team drive' }));
  await page.route(`${base}/files/search`, (route) => {
    searchBodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        query: 'Masterplan',
        hits: [
          {
            type: 'file',
            id: SEARCH_ID,
            driveId: TEAM_DRIVE,
            title: 'Masterplan BM23d.xlsx',
            date: hoursAgo(30),
            size: 20155,
            isFolder: false,
            mimeType: 'text/plain',
            location: { kind: 'team', teamName: 'BM23d ab 2025', label: 'Team BM23d ab 2025 > General' },
          },
        ],
        moreAvailable: false,
        nextFrom: null,
      },
    });
  });
});

const useLayout = (page: Page, layout: 'schuly' | 'explorer') => page.addInitScript((value) => localStorage.setItem('schuly.drive.layout', value), layout);

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const location = (page: Page) => page.getByRole('combobox', { name: 'Location' });
const pick = async (page: Page, trigger: Locator, option: string) => {
  await trigger.click();
  await page.getByRole('option', { name: option }).click();
};
const nav = (page: Page) => page.getByRole('navigation', { name: 'Drive locations' });

for (const layout of ['schuly', 'explorer'] as const) {
  test.describe(`${layout} view`, () => {
    test.beforeEach(async ({ page }) => {
      await useLayout(page, layout);
      await page.goto('/drive');
      await expect(page.getByText('My homework.txt').first()).toBeVisible();
    });

    test('switches between Shared, Recent, a team and a channel', async ({ page }) => {
      await nav(page).getByRole('button', { name: 'Shared with me' }).click();
      await expect(page.getByText('Klassenliste.txt').first()).toBeVisible();
      await nav(page).getByRole('button', { name: 'Recent' }).click();
      await expect(page.getByText('Zuletzt geoeffnet.txt').first()).toBeVisible();
      await nav(page).getByRole('button', { name: /BM23d ab 2025/ }).click();
      await expect(page.getByText('Stundenplan.txt').first()).toBeVisible();
      const channelRequest = page.waitForRequest((r) => new URL(r.url()).searchParams.get('channelId') === CHANNEL_GENERAL);
      await nav(page).getByRole('button', { name: 'General' }).click();
      await channelRequest;
      await expect(page.getByText('Stundenplan.txt').first()).toBeVisible();
      await nav(page).getByRole('button', { name: 'My files' }).click();
      await expect(page.getByText('My homework.txt').first()).toBeVisible();
    });

    test('opens a team folder and goes back through the breadcrumb', async ({ page }) => {
      await nav(page).getByRole('button', { name: /BM23d ab 2025/ }).click();
      await expect(page.getByText('Pruefungen').first()).toBeVisible();
      await page.getByText('Pruefungen').first().dblclick();
      await expect(page.getByText('Mathe Pruefung.txt').first()).toBeVisible();
      expect(urls.some((u) => u.includes(`/drives/${encodeURIComponent(TEAM_DRIVE)}/items/${encodeURIComponent(FOLDER_ID)}/children`))).toBe(true);
      await page.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: /BM23d ab 2025/ }).click();
      await expect(page.getByText('Stundenplan.txt').first()).toBeVisible();
    });

    test('Everywhere search shows the location and opens the file; the query only travels in a POST body', async ({ page }) => {
      await page.getByRole('searchbox', { name: 'Search all files' }).fill('Masterplan');
      const hit = page.getByRole('region', { name: 'Everywhere' });
      await expect(hit).toContainText('Masterplan BM23d.xlsx');
      await expect(hit).toContainText('Team BM23d ab 2025 > General');
      expect(searchBodies).toHaveLength(1);
      expect(searchBodies[0]).toMatchObject({ q: 'Masterplan' });
      await hit.getByText('Masterplan BM23d.xlsx').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(urls.filter((u) => u.toLowerCase().includes('masterplan'))).toEqual([]);
      expect(urls.some((u) => u.includes(`/drives/${encodeURIComponent(TEAM_DRIVE)}/items/${encodeURIComponent(SEARCH_ID)}/content`))).toBe(true);
    });
  });
}

test('a failing teams request keeps My files working', async ({ page }) => {
  teamsFail = true;
  await page.goto('/drive');
  await expect(page.getByText('My homework.txt').first()).toBeVisible();
  await nav(page).getByRole('button', { name: 'Recent' }).click();
  await expect(page.getByText('Zuletzt geoeffnet.txt').first()).toBeVisible();
  await nav(page).getByRole('button', { name: 'My files' }).click();
  await expect(page.getByText('My homework.txt').first()).toBeVisible();
});

test.describe('narrow viewport', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('shows selects instead of the sidebar and fits the screen', async ({ page }) => {
    await page.goto('/drive');
    await expect(page.getByText('My homework.txt').first()).toBeVisible();
    await expect(nav(page)).toBeHidden();
    await expect(location(page)).toBeVisible();
    await pick(page, location(page), 'Shared with me');
    await expect(page.getByText('Klassenliste.txt').first()).toBeVisible();
    await pick(page, location(page), 'BM23d ab 2025');
    await expect(page.getByText('Stundenplan.txt').first()).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Channel of BM23d/ })).toBeVisible();
    await pick(page, page.getByRole('combobox', { name: /Channel of BM23d/ }), 'General');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 800 },
];
for (const scheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    test(`accessibility and screenshots: ${scheme} ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/drive');
      await expect(page.getByText('My homework.txt').first()).toBeVisible();
      if (size.width >= 1024) {
        await nav(page).getByRole('button', { name: /BM23d ab 2025/ }).click();
        await expect(nav(page).getByRole('button', { name: 'General' })).toBeVisible();
      } else {
        await pick(page, location(page), 'BM23d ab 2025');
      }
      await expect(page.getByText('Pruefungen').first()).toBeVisible();
      await expectNoViolations(page);
      const shots = process.env['DRIVE_SHOTS'];
      if (shots) await page.screenshot({ path: `${shots}/teams-switcher-${scheme}-${size.width}.png`, fullPage: true });

      await page.getByRole('searchbox', { name: 'Search all files' }).fill('Masterplan');
      await expect(page.getByRole('region', { name: 'Everywhere' })).toContainText('Masterplan BM23d.xlsx');
      await expectNoViolations(page);
      if (shots) await page.screenshot({ path: `${shots}/teams-search-${scheme}-${size.width}.png`, fullPage: true });
    });
  }
}
