import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { ALPHA_ACCOUNT, FakeAccount, FakeServer } from './fake-server';

// A browser in Switzerland: dd.MM.yyyy and 24-hour times.
test.use({ locale: 'de-CH', timezoneId: 'Europe/Zurich', viewport: { width: 1280, height: 800 } });

const DRIVE_ACCOUNT: FakeAccount = {
  providerId: 'gamma',
  providerName: 'Gamma Drive',
  id: 'g1',
  title: 'Mia Gamma',
  status: 'ok',
  capabilities: [{ kind: 'drive', label: 'Files', basePath: '/api/gamma/accounts' }],
  canReauth: true,
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

let server: FakeServer;
let thumbnails: string[];

test.beforeEach(async ({ page }) => {
  server = new FakeServer();
  server.accounts = [ALPHA_ACCOUNT, DRIVE_ACCOUNT];
  await server.install(page);
  thumbnails = [];
  await page.route(/\/api\/gamma\/accounts\/g1\/files\/[^/]+\/thumbnail/, (route) => {
    thumbnails.push(decodeURIComponent(new URL(route.request().url()).pathname.split('/')[6]));
    return route.fulfill({ contentType: 'image/png', body: PNG });
  });
  await page.route(/\/api\/gamma\/accounts\/g1\/files(\?.*)?$/, (route) =>
    route.fulfill({
      json: [
        { id: 'f0', name: 'Projects', folder: { childCount: 3 }, lastModifiedDateTime: hoursAgo(1) },
        { id: 'f1', name: 'grades.csv', size: 2048, file: { mimeType: 'text/csv' }, lastModifiedDateTime: new Date(2026, 9, 31, 18, 21).toISOString() },
        { id: 'f2', name: 'photo.jpg', size: 4096, file: { mimeType: 'image/jpeg' }, lastModifiedDateTime: hoursAgo(0.01) },
        { id: 'f3', name: 'report.pdf', size: 8192, file: { mimeType: 'application/pdf' }, lastModifiedDateTime: hoursAgo(26) },
        { id: 'f4', name: 'notes.md', size: 100, file: { mimeType: 'text/markdown' }, lastModifiedDateTime: hoursAgo(300) },
      ],
    }),
  );
});

async function expectNoViolations(page: Page) {
  // Every rule, `region` included; nothing is excluded.
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('Drive explorer shows Swiss dates, 24-hour times and precise type labels', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('schuly.drive.layout', 'explorer'));
  await page.goto('/drive');
  const csv = page.getByText('grades.csv').first();
  await expect(csv).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text).toContain('CSV file');
  expect(text).toContain('Markdown file');
  expect(text).toContain('31.10.2026');
  expect(text).toMatch(/Heute, \d{2}:\d{2}/);
  expect(text).toMatch(/Gestern, \d{2}:\d{2}/);
  expect(text).not.toMatch(/\b(AM|PM)\b/);
  expect(text).not.toContain('Excel workbook');
  await expectNoViolations(page);
});

test('classic Drive view loads thumbnails for images and PDFs only', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('schuly.drive.layout', 'schuly'));
  await page.goto('/drive');
  await expect(page.getByRole('option', { name: /photo\.jpg/ })).toBeVisible();
  await expect.poll(() => thumbnails.sort()).toEqual(['f2', 'f3']);
  await expect(page.locator('app-drive-thumb img')).toHaveCount(2);
  await expectNoViolations(page);
});

test('the dashboard has no accessibility violations, landmarks included', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expectNoViolations(page);
});
