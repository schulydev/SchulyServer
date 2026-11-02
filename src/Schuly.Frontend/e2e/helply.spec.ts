import AxeBuilder from '@axe-core/playwright';
import { Page, Route, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FakeServer } from './fake-server';

const BASE = '/api/helply';
const SHOTS = process.env['SHOTS_DIR'];

interface MockOptions {
  workspace?: boolean;
  workspaceAvailable?: boolean;
  /** Body of the SSE reply to the next message. */
  stream?: string;
  conversation?: unknown;
}

interface Mock {
  uploads: string[];
  deleted: string[];
  sent: { text: string; attachmentIds: string[] }[];
  workspaceSaves: boolean[];
  settings: { permissions: unknown; workspace: boolean; workspaceAvailable: boolean };
}

const permissions = { areas: { Mail: 'Read', Grades: 'Read' }, allowDestructive: false, microsoftAccountIds: null };

const sse = (...events: [string, unknown][]) => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');

const CODE = { command: "python3 -c 'print(6*7)'", output: '42\n', exitCode: 0 };
const FILE = { id: 'f-chart', fileName: 'result.txt', mediaType: 'text/plain', sizeBytes: 2048 };

const RAN_CODE_STREAM = sse(
  ['start', { messageId: 'a1' }],
  ['tool_started', { id: 't1', label: 'Running code', code: { command: CODE.command, output: null, exitCode: null } }],
  ['tool_finished', { id: 't1', label: 'Ran code', status: 'done', code: CODE }],
  ['delta', { text: 'The answer is **42**.' }],
  ['file', { messageId: 'a1', ...FILE }],
  ['done', { messageId: 'a1', awaitingApproval: false, title: 'Math' }],
);

async function install(page: Page, options: MockOptions = {}): Promise<Mock> {
  const server = new FakeServer();
  await server.install(page);
  const mock: Mock = {
    uploads: [],
    deleted: [],
    sent: [],
    workspaceSaves: [],
    settings: { permissions, workspace: options.workspace ?? false, workspaceAvailable: options.workspaceAvailable ?? true },
  };
  const summary = { id: 'c1', title: options.conversation ? 'Old chat' : 'New chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  const conversations = options.conversation ? [summary] : [];

  await page.route(`**${BASE}/**`, (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(BASE.length);
    const method = route.request().method();
    if (path === '/status') return route.fulfill({ json: { enabled: true } });
    if (path === '/settings') return route.fulfill({ json: mock.settings });
    if (path === '/settings/permissions') return route.fulfill({ json: mock.settings });
    if (path === '/settings/workspace') {
      const enabled = (route.request().postDataJSON() as { enabled: boolean }).enabled;
      mock.workspaceSaves.push(enabled);
      mock.settings = { ...mock.settings, workspace: enabled };
      return route.fulfill({ json: mock.settings });
    }
    if (path === '/conversations' && method === 'GET') return route.fulfill({ json: conversations });
    if (path === '/conversations' && method === 'POST') return route.fulfill({ json: summary });
    if (path === '/conversations/c1' && method === 'GET') return route.fulfill({ json: options.conversation });
    if (path === '/conversations/c1/attachments' && method === 'POST') {
      const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const name = /filename="([^"]+)"/.exec(body)?.[1] ?? 'file';
      mock.uploads.push(name);
      return route.fulfill({ json: { id: `up-${mock.uploads.length}`, fileName: name, mediaType: 'text/plain', sizeBytes: 11 } });
    }
    if (path.startsWith('/conversations/c1/attachments/') && method === 'DELETE') {
      mock.deleted.push(path.split('/').pop()!);
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith('/conversations/c1/attachments/') && method === 'GET') {
      return route.fulfill({ contentType: 'text/plain', body: 'hello world' });
    }
    if (path === '/conversations/c1/messages') {
      mock.sent.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'text/event-stream', body: options.stream ?? sse(['start', { messageId: 'a1' }], ['delta', { text: 'Hi' }], ['done', { messageId: 'a1', awaitingApproval: false, title: 'Chat' }]) });
    }
    return route.fulfill({ json: [] });
  });
  return mock;
}

async function open(page: Page) {
  await page.goto('/ai/helply');
  await expect(page.getByRole('heading', { name: "Hi, I'm Helply" })).toBeVisible();
}

async function axe(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const textFile = (name: string, body = 'hello world') => ({ name, mimeType: 'text/plain', buffer: Buffer.from(body) });

test.describe('attachments', () => {
  test('attaching a file shows a chip, uploads it, and sending posts its id', async ({ page }) => {
    const mock = await install(page);
    await open(page);

    await page.locator('input[type=file]').setInputFiles(textFile('notes.txt'));
    const chips = page.getByRole('button', { name: 'Remove notes.txt' });
    await expect(chips).toBeVisible();
    expect(mock.uploads).toEqual(['notes.txt']);

    // Send works without text once the file is uploaded.
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => mock.sent.length).toBe(1);
    expect(mock.sent[0]).toEqual({ text: '', attachmentIds: ['up-1'] });
    await expect(page.getByRole('article', { name: 'You' }).getByRole('button', { name: 'Open notes.txt' })).toBeVisible();
    await axe(page, 'app-helply');
  });

  test('removing a chip deletes the upload; unsupported files show a friendly error', async ({ page }) => {
    const mock = await install(page);
    await open(page);

    await page.locator('input[type=file]').setInputFiles(textFile('notes.txt'));
    await page.getByRole('button', { name: 'Remove notes.txt' }).click();
    await expect.poll(() => mock.deleted).toEqual(['up-1']);

    await page.locator('input[type=file]').setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
    await expect(page.getByRole('alert').filter({ hasText: "tool.exe can't be attached" })).toBeVisible();
    expect(mock.uploads).toEqual(['notes.txt']);
  });
});

test.describe('code and files in answers', () => {
  test('shows the Ran code chip with command and output, and a shared file that opens the viewer', async ({ page }) => {
    await install(page, { stream: RAN_CODE_STREAM });
    await open(page);

    await page.getByLabel('Message Helply').fill('What is 6 times 7?');
    await page.getByRole('button', { name: 'Send message' }).click();

    const answer = page.getByRole('article', { name: 'Helply' });
    await expect(answer.getByText('The answer is')).toBeVisible();
    const chip = answer.getByRole('button', { name: /Ran code/ });
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(answer.getByText("python3 -c 'print(6*7)'")).toBeVisible();
    await expect(answer.getByRole('region', { name: 'Output' })).toContainText('42');
    await expect(answer.getByText('exit code 0')).toBeVisible();

    const card = answer.getByRole('button', { name: 'Open result.txt' });
    await expect(card).toBeVisible();
    await expect(answer.getByRole('button', { name: 'Download result.txt' })).toBeVisible();
    await axe(page, 'app-helply');

    await card.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('hello world')).toBeVisible();
  });

  test('a loaded conversation shows attachments and code on past messages', async ({ page }) => {
    await install(page, {
      conversation: {
        id: 'c1',
        title: 'Old chat',
        createdAt: '',
        updatedAt: '',
        expiresAt: '',
        pendingApprovals: [],
        messages: [
          { id: 'm1', role: 'user', text: 'Look at this', createdAt: '', tools: [], failed: false, attachments: [{ id: 'f1', fileName: 'grades.csv', mediaType: 'text/csv', sizeBytes: 900 }] },
          { id: 'm2', role: 'assistant', text: 'Done.', createdAt: '', failed: false, attachments: [], tools: [{ id: 't1', label: 'Ran code', status: 'done', code: { command: 'ls', output: 'a.txt', exitCode: 2 } }] },
        ],
      },
    });
    await page.goto('/ai/helply');
    await page.getByRole('button', { name: /Old chat/ }).first().click();
    await expect(page.getByRole('button', { name: 'Open grades.csv' })).toBeVisible();
    await page.getByRole('button', { name: /Ran code/ }).click();
    await expect(page.getByText('exit code 2')).toHaveClass(/text-destructive/);
  });
});

test.describe('settings', () => {
  test('the workspace switch is off by default and saves only when changed', async ({ page }) => {
    const mock = await install(page);
    await open(page);
    await page.getByRole('button', { name: 'Helply settings' }).click();
    const sheet = page.getByRole('dialog');
    const toggle = sheet.getByRole('switch', { name: 'Workspace (run code)' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(sheet.getByText(/Lets Helply run code in a sandbox without internet access/)).toBeVisible();

    await toggle.click();
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(sheet.getByText('Settings saved.')).toBeVisible();
    expect(mock.workspaceSaves).toEqual([true]);
    await axe(page, '[role="dialog"]');
  });

  test('the switch is disabled with a note when the server has no sandbox', async ({ page }) => {
    await install(page, { workspaceAvailable: false });
    await open(page);
    await page.getByRole('button', { name: 'Helply settings' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('switch', { name: 'Workspace (run code)' })).toBeDisabled();
    await expect(sheet.getByText('Not available on this server.')).toBeVisible();
  });

  for (const width of [360, 1280]) {
    test(`every permission area has a visible control without overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await install(page);
      await open(page);
      await page.getByRole('button', { name: 'Helply settings' }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('radiogroup').first()).toBeVisible();
      const groups = sheet.getByRole('radiogroup');
      const count = await groups.count();
      expect(count).toBeGreaterThanOrEqual(10);
      for (let i = 0; i < count; i++) {
        const group = groups.nth(i);
        await group.scrollIntoViewIfNeeded();
        await expect(group.getByText('Off', { exact: true })).toBeVisible();
        await expect(group.getByText('Read', { exact: true })).toBeVisible();
        const box = await group.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      const overflow = await sheet.evaluate((el) => {
        const scroller = Array.from(el.querySelectorAll<HTMLElement>('*')).find((n) => getComputedStyle(n).overflowY === 'auto')!;
        return scroller.scrollWidth - scroller.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
      await axe(page, '[role="dialog"]');
    });
  }

  test('arrow keys move a permission choice', async ({ page }) => {
    await install(page);
    await open(page);
    await page.getByRole('button', { name: 'Helply settings' }).click();
    const group = page.getByRole('dialog').getByRole('radiogroup', { name: 'Mail' });
    await group.getByRole('radio', { checked: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: 'Read & write' })).toBeChecked();
  });
});

test.describe('layout', () => {
  for (const width of [1260, 375, 320]) {
    test(`no horizontal overflow at ${width}px, content centred in a 768px column`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await install(page);
      await open(page);
      const result = await page.evaluate(() => {
        const doc = document.documentElement;
        const chat = document.querySelector('section[aria-label="Helply chat"]') as HTMLElement;
        const log = document.querySelector('[role="log"]') as HTMLElement;
        const heading = document.querySelector('app-message-list h2') as HTMLElement;
        const c = chat.getBoundingClientRect();
        const h = heading.getBoundingClientRect();
        return {
          docOverflow: doc.scrollWidth - doc.clientWidth,
          chatOverflow: chat.scrollWidth - chat.clientWidth,
          logOverflow: log.scrollWidth - log.clientWidth,
          centred: Math.abs(c.left + c.width / 2 - (h.left + h.width / 2)),
          column: Math.max(...Array.from(document.querySelectorAll<HTMLElement>('app-composer > div, pk-chat-container-content')).map((n) => n.getBoundingClientRect().width)),
        };
      });
      expect(result.docOverflow).toBeLessThanOrEqual(0);
      expect(result.chatOverflow).toBeLessThanOrEqual(0);
      expect(result.logOverflow).toBeLessThanOrEqual(0);
      expect(result.centred).toBeLessThanOrEqual(2);
      expect(result.column).toBeLessThanOrEqual(768);
      await page.getByRole('button', { name: 'Summarize my unread mail' }).scrollIntoViewIfNeeded();
      const prompt = await page.getByRole('button', { name: 'Summarize my unread mail' }).boundingBox();
      expect(prompt!.x + prompt!.width).toBeLessThanOrEqual(width);
    });
  }

  test('the divider resizes the conversation list by keyboard and remembers the width', async ({ page }) => {
    await page.setViewportSize({ width: 1260, height: 800 });
    await install(page);
    await open(page);
    const handle = page.getByRole('separator', { name: 'Resize conversation list' });
    await expect(handle).toHaveAttribute('aria-valuenow', '280');
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '296');
    await page.keyboard.press('End');
    await expect(handle).toHaveAttribute('aria-valuenow', '420');
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '200');
    expect(await page.evaluate(() => localStorage.getItem('schuly.helply.listWidth'))).toBe('200');
    await handle.dblclick();
    await expect(handle).toHaveAttribute('aria-valuenow', '280');

    await page.reload();
    await expect(page.getByRole('separator', { name: 'Resize conversation list' })).toHaveAttribute('aria-valuenow', '280');
  });

  test('the list is collapsed on small screens and opens from a toggle with aria-expanded', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await install(page);
    await open(page);
    const toggle = page.getByRole('button', { name: 'Conversations' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
  });
});

test.describe('screenshots', () => {
  test.skip(!SHOTS, 'set SHOTS_DIR to write screenshots');

  for (const scheme of ['light', 'dark'] as const) {
    test(`helply ${scheme}`, async ({ page }) => {
      mkdirSync(SHOTS!, { recursive: true });
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      await install(page, { stream: RAN_CODE_STREAM });
      await open(page);
      await page.screenshot({ path: join(SHOTS!, `helply-empty-${scheme}.png`) });

      await page.locator('input[type=file]').setInputFiles([textFile('notes.txt'), textFile('grades.csv', 'a,b')]);
      await expect(page.getByRole('button', { name: 'Remove grades.csv' })).toBeVisible();
      await page.getByLabel('Message Helply').fill('What is 6 times 7? Notes and grades attached.');
      await page.screenshot({ path: join(SHOTS!, `helply-composer-${scheme}.png`) });
      await page.getByRole('button', { name: 'Send message' }).click();
      const answer = page.getByRole('article', { name: 'Helply' });
      await expect(answer.getByRole('button', { name: 'Open result.txt' })).toBeVisible();
      await answer.getByRole('button', { name: /Ran code/ }).click();
      await expect(answer.getByText('exit code 0')).toBeVisible();
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS!, `helply-chat-${scheme}.png`) });

      await page.getByRole('button', { name: 'Helply settings' }).click();
      await expect(page.getByRole('dialog').getByRole('switch').first()).toBeVisible();
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(SHOTS!, `helply-settings-${scheme}.png`) });
    });

    for (const width of [360, 1280]) {
      test(`permission editor ${width} ${scheme}`, async ({ page }) => {
        mkdirSync(SHOTS!, { recursive: true });
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await install(page);
        await open(page);
        await page.getByRole('button', { name: 'Helply settings' }).click();
        await expect(page.getByRole('dialog').getByRole('radiogroup').first()).toBeVisible();
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(SHOTS!, `permission-${width === 360 ? '360' : 'desktop'}-${scheme}.png`) });
      });
    }
  }
});
