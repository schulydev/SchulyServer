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
  /** Body of the SSE reply to a decision on pending approvals. */
  approvalStream?: string;
  /** Body of the SSE reply to a retry. */
  retryStream?: string;
  /** Areas Helply may use; Mail and Grades read by default. */
  areas?: Record<string, string>;
  conversation?: unknown;
}

interface Mock {
  uploads: string[];
  deleted: string[];
  sent: { text: string; attachmentIds: string[] }[];
  workspaceSaves: boolean[];
  decisions: unknown[];
  retries: number;
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
  await page.addInitScript(() => localStorage.setItem('schuly.helply.aiNoticeSeen', 'yes'));
  const server = new FakeServer();
  await server.install(page);
  const mock: Mock = {
    uploads: [],
    deleted: [],
    sent: [],
    workspaceSaves: [],
    decisions: [],
    retries: 0,
    settings: { permissions: options.areas ? { ...permissions, areas: options.areas } : permissions, workspace: options.workspace ?? false, workspaceAvailable: options.workspaceAvailable ?? true },
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
    if (path === '/conversations/c1/approvals') {
      mock.decisions.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'text/event-stream', body: options.approvalStream ?? '' });
    }
    if (path === '/conversations/c1/retry') {
      mock.retries++;
      return route.fulfill({ contentType: 'text/event-stream', body: options.retryStream ?? '' });
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

// ---- The kit's chat parts: suggestions, chain of thought, actions, code blocks ----

const done = (title = 'Chat') => ['done', { messageId: 'a1', awaitingApproval: false, title }] as [string, unknown];

/** The turn from the bug report: a lead-in, a mail list, more text, then three more pages, then the answer. */
const LEAD = "I'll check your unread emails.";
const MORE = '\n\nLet me check the remaining unread messages.';
const ANSWER = '\n\nYou have **5 unread emails**:\n\n1. Exam dates from Anna\n2. Room change for Physics';
const MAIL_STREAM = sse(
  ['start', { messageId: 'a1' }],
  ['delta', { text: LEAD }],
  ['tool_started', { id: 't1', label: 'Reading your mail list', at: LEAD.length, detail: 'unread only' }],
  ['tool_finished', { id: 't1', label: 'Read your mail list', status: 'done', at: LEAD.length, detail: 'unread only' }],
  ['delta', { text: MORE }],
  ...[2, 3, 4].flatMap((n): [string, unknown][] => [
    ['tool_started', { id: `t${n}`, label: 'Reading your mail list', at: LEAD.length + MORE.length, detail: `page ${n} · unread only` }],
    ['tool_finished', { id: `t${n}`, label: 'Read your mail list', status: 'done', at: LEAD.length + MORE.length, detail: `page ${n} · unread only` }],
  ]),
  ['delta', { text: ANSWER }],
  done('Unread mail'),
);

const CODE_STREAM = sse(['start', { messageId: 'a1' }], ['delta', { text: 'Here is the script:\n\n```python\nprint(6 * 7)\n```\n\nIt prints 42.' }], done());

const DRAFTED = 'I drafted the reply to Anna.';
const APPROVAL_STREAM = sse(
  ['start', { messageId: 'a1' }],
  ['delta', { text: DRAFTED }],
  [
    'approval_required',
    {
      approvalId: 'ap1',
      toolLabel: 'Reply to mail',
      summary: 'Reply to the email "Exam dates" from Anna',
      details: [{ label: 'Reply', value: 'Thanks, see you Monday.' }],
      destructive: true,
      arguments: [{ label: 'Reply', value: 'Thanks, see you Monday.' }],
      risk: 'normal',
      riskReasons: [],
    },
  ],
  ['done', { messageId: 'a1', awaitingApproval: true, title: 'Reply' }],
);
const APPROVED_STREAM = sse(
  ['start', { messageId: 'a1' }],
  ['tool_started', { id: 'r1', label: 'Replying to an email', at: DRAFTED.length }],
  ['tool_finished', { id: 'r1', label: 'Replied to an email', status: 'done' }],
  ['delta', { text: '\n\nThe reply is sent.' }],
  done('Reply'),
);

const FAILED = "Helply couldn't answer right now.";
const ERROR_STREAM = sse(['start', { messageId: 'a1' }], ['error', { message: FAILED, code: 'unavailable', retryable: true }]);

/** Replaces the SSE reply to the next message with one the test feeds piece by piece. */
async function holdStream(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const w = window as unknown as { __push?: (chunk: string | null) => void };
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/api\/helply\/conversations\/[^/]+\/messages$/.test(url) && init?.method === 'POST') {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
        w.__push = (chunk) => (chunk === null ? controller.close() : controller.enqueue(new TextEncoder().encode(chunk)));
        return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      }
      return original(input, init);
    };
  });
}

async function push(page: Page, chunk: string | null) {
  await page.waitForFunction(() => typeof (window as unknown as { __push?: unknown }).__push === 'function');
  await page.evaluate((c) => (window as unknown as { __push: (chunk: string | null) => void }).__push(c), chunk);
}

/** Lets the chain finish folding or opening, so axe and screenshots see it at rest. */
const settle = (page: Page) => page.waitForTimeout(450);

async function send(page: Page, text: string) {
  await page.getByLabel('Message Helply').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

const VIEWS = [
  { scheme: 'light', width: 1280 },
  { scheme: 'dark', width: 1280 },
  { scheme: 'light', width: 390 },
  { scheme: 'dark', width: 390 },
] as const;

for (const { scheme, width } of VIEWS) {
  test.describe(`kit chat ${scheme} ${width}px`, () => {
    const shot = async (page: Page, name: string) => {
      if (!SHOTS) return;
      mkdirSync(SHOTS, { recursive: true });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(SHOTS, `helply-${name}-${width}-${scheme}.png`) });
    };

    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 860 });
    });

    test('the empty chat suggests only what Helply may use, with one workspace question', async ({ page }) => {
      const mock = await install(page, { areas: { Exams: 'Read', Grades: 'Read', Mail: 'Off' }, workspace: true });
      await open(page);
      const suggestions = page.getByRole('list', { name: 'Suggested questions' });
      await expect(suggestions.getByRole('button')).toHaveText(['What exams do I have this week?', 'How are my grades this semester?', 'Make a chart of my grades']);
      await expect(suggestions).not.toContainText(/mail/i);
      for (const button of await suggestions.getByRole('button').all()) {
        const box = (await button.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await axe(page, 'app-helply');
      await shot(page, 'empty');

      await suggestions.getByRole('button', { name: 'Make a chart of my grades' }).click();
      await expect.poll(() => mock.sent[0]?.text).toBe('Make a chart of my grades');
    });

    test('a multi-tool turn is one ordered chain of thought, folded once the answer is in', async ({ page }) => {
      await install(page, { stream: MAIL_STREAM });
      await open(page);
      await send(page, 'Summarize my unread mail');

      const answer = page.getByRole('article', { name: 'Helply' });
      await expect(answer.getByText('5 unread emails')).toBeVisible();
      const header = answer.getByRole('button', { name: /Read your mail list · 4 steps/ });
      await expect(header).toHaveAttribute('aria-expanded', 'false');
      await expect(answer.getByText(LEAD)).toBeHidden();
      await expect(answer.getByRole('button', { name: 'Copy' })).toBeVisible();
      await axe(page, 'app-helply');
      await shot(page, 'chain-folded');

      await header.click();
      await expect(header).toHaveAttribute('aria-expanded', 'true');
      const chain = answer.getByRole('list', { name: 'What Helply did' });
      await expect(chain.getByRole('listitem')).toHaveText([
        /^I'll check your unread emails\.\s*$/,
        /^\s*Read your mail list\s+· unread only, Done$/,
        /^Let me check the remaining unread messages\.\s*$/,
        /^\s*Read your mail list\s+· 3 pages · unread only, Done$/,
      ]);
      // The answer sits below the chain and holds none of the text written on the way.
      await expect(answer.locator('pk-markdown').last()).not.toContainText(LEAD);
      await settle(page);
      await axe(page, 'app-helply');
      await shot(page, 'chain-open');
    });

    test('while streaming the chain stays open and earlier text moves into it as steps arrive', async ({ page }) => {
      await holdStream(page);
      await install(page);
      await open(page);
      await send(page, 'Summarize my unread mail');

      const answer = page.getByRole('article', { name: 'Helply' });
      await expect(answer.getByText('Thinking...')).toBeVisible();
      await shot(page, 'thinking');
      await push(page, sse(['start', { messageId: 'a1' }], ['delta', { text: LEAD }]));
      await expect(answer.getByText(LEAD)).toBeVisible();
      await expect(answer.getByRole('list', { name: 'What Helply did' })).toHaveCount(0);

      await push(page, sse(['tool_started', { id: 't1', label: 'Reading your mail list', at: LEAD.length, detail: 'unread only' }]));
      const chain = answer.getByRole('list', { name: 'What Helply did' });
      await expect(chain.getByRole('listitem')).toHaveText([/I'll check your unread emails\./, /Reading your mail list\s+· unread only, In progress/]);
      await expect(answer.getByRole('button', { name: /steps/ })).toHaveCount(0);
      await axe(page, 'app-helply');
      await shot(page, 'streaming');

      await push(page, sse(['tool_finished', { id: 't1', label: 'Read your mail list', status: 'done' }], ['delta', { text: ANSWER }], done()));
      await push(page, null);
      await expect(answer.getByText('5 unread emails')).toBeVisible();
      await expect(answer.getByRole('button', { name: /Read your mail list/ })).toHaveAttribute('aria-expanded', 'false');
    });

    test('an approval waits at the end of the turn and approving continues it in the chain', async ({ page }) => {
      const mock = await install(page, { stream: APPROVAL_STREAM, approvalStream: APPROVED_STREAM });
      await open(page);
      await send(page, 'Reply to Anna');

      const card = page.getByLabel('Approval needed: Reply to mail');
      await expect(card).toBeVisible();
      await expect(page.getByRole('article', { name: 'Helply' }).getByText(DRAFTED)).toBeVisible();
      await axe(page, 'app-helply');
      await shot(page, 'approval');

      await card.getByRole('button', { name: 'Approve' }).click();
      await expect.poll(() => mock.decisions).toEqual([{ decisions: [{ approvalId: 'ap1', approved: true }] }]);
      const answer = page.getByRole('article', { name: 'Helply' });
      await expect(answer.getByText('The reply is sent.')).toBeVisible();
      await expect(card).toHaveCount(0);
      await answer.getByRole('button', { name: /Replied to an email/ }).click();
      await expect(answer.getByRole('list', { name: 'What Helply did' }).getByRole('listitem')).toHaveText([/I drafted the reply to Anna\./, /Replied to an email/]);
      await settle(page);
      await axe(page, 'app-helply');
    });

    test('an error is an alert and the last answer can be retried from its actions', async ({ page }) => {
      const mock = await install(page, { stream: ERROR_STREAM, retryStream: sse(['start', { messageId: 'a1' }], ['delta', { text: 'Back again.' }], done()) });
      await open(page);
      await send(page, 'Hello');

      const answer = page.getByRole('article', { name: 'Helply' });
      await expect(answer.getByRole('alert')).toHaveText(FAILED);
      const retry = answer.getByRole('button', { name: 'Retry' });
      await expect(retry).toBeVisible();
      await axe(page, 'app-helply');
      await shot(page, 'error');

      await retry.click();
      await expect(answer.getByText('Back again.')).toBeVisible();
      expect(mock.retries).toBe(1);
      await expect(answer.getByRole('alert')).toHaveCount(0);
      await expect(answer.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    });

    test('code in an answer is the kit code block with a copy button', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-write']);
      await install(page, { stream: CODE_STREAM });
      await open(page);
      await send(page, 'Write a script');

      const answer = page.getByRole('article', { name: 'Helply' });
      const block = answer.locator('.pk-code-block');
      await expect(block).toBeVisible();
      await expect(block).toContainText('print(6 * 7)');
      await block.getByRole('button', { name: 'Copy' }).click();
      await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible();
      await axe(page, 'app-helply');
      await shot(page, 'code');
    });
  });
}
