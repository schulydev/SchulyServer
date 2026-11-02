import { Page, expect, test } from '@playwright/test';
import { FakeAccount, FakeServer } from './fake-server';

const ACCOUNT: FakeAccount = {
  providerId: 'microsoft',
  providerName: 'Microsoft',
  id: 'm1',
  title: 'Mia Microsoft',
  status: 'ok',
  capabilities: [
    { kind: 'drive', label: 'Files', basePath: '/api/plugins/microsoft/accounts' },
    { kind: 'notes', label: 'Notes', basePath: '/api/plugins/microsoft/accounts' },
  ],
  canReauth: true,
};

const base = '**/api/plugins/microsoft/accounts/m1';
const page1 = { id: 'p1', title: 'Weekly notes', level: 0, order: 1, createdDateTime: null, lastModifiedDateTime: null, webUrl: null, sectionId: 's1' };

test.beforeEach(async ({ page }) => {
  const server = new FakeServer();
  server.accounts = [ACCOUNT];
  await server.install(page);
  await page.route(`${base}/files?*`, (route) => route.fulfill({ json: [{ id: 'f1', name: 'Folder', folder: { childCount: 1 } }] }));
  await page.route(/\/m1\/onenote\/notebooks(\?.*)?$/, (route) =>
    route.fulfill({
      json: [{ id: 'n1', displayName: 'Notebook', createdDateTime: null, lastModifiedDateTime: null, isDefault: true, isShared: false, userRole: 'Owner', writable: true, webUrl: null, source: { kind: 'personal', id: null, name: null } }],
    }),
  );
  await page.route(/\/m1\/onenote\/notebooks\/n1\/sections(\?.*)?$/, (route) =>
    route.fulfill({ json: { notebookId: 'n1', children: [{ id: 's1', kind: 'section', displayName: 'Section', lastModifiedDateTime: null, isDefault: true, children: [] }] } }),
  );
  await page.route(/\/m1\/onenote\/sections\/s1\/pages(\?.*)?$/, (route) => route.fulfill({ json: { items: [page1], nextSkip: null } }));
  await page.route(`${base}/onenote/pages/p1`, (route) =>
    route.fulfill({
      json: { ...page1, section: { id: 's1', displayName: 'Section' }, notebook: { id: 'n1', displayName: 'Notebook' }, writable: true, html: '<p>Hello</p>', width: 0, height: 0, resources: [], outlines: [], hasInk: false },
    }),
  );
});

const fits = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight);

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('Notes fills the viewport and only its panes scroll', async ({ page }) => {
      await page.goto('/notes');
      await page.getByRole('treeitem', { name: /Section/ }).click();
      await page.getByRole('button', { name: /Weekly notes/ }).click();
      await expect(page.getByRole('region', { name: 'Page', exact: true })).toContainText('Weekly notes');
      expect(await fits(page)).toBe(true);
      const box = await page.getByRole('region', { name: 'Page', exact: true }).boundingBox();
      expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 2);
      // The white page frame takes the rest of the height.
      const frame = await page.locator('iframe[title^="Content of"]').boundingBox();
      expect(frame!.y + frame!.height).toBeGreaterThan(viewport.height - 40);
    });

    for (const path of ['/documents', '/ai/helply']) {
      test(`${path} does not scroll the page`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('main')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await fits(page)).toBe(true);
      });
    }

    for (const layout of ['schuly', 'explorer']) {
      test(`Drive (${layout}) does not scroll the page when it is short`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('schuly.drive.layout', value), layout);
        await page.goto('/drive');
        await expect(page.getByText('Folder').first()).toBeVisible();
        expect(await fits(page)).toBe(true);
      });
    }
  });
}
