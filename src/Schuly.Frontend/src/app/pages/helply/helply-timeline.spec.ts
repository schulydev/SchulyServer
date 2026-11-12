import { describe, expect, it } from 'vitest';
import { HelplySettings, ToolActivity } from '../../core/helply-types';
import { buildTimeline, chainBlocks, chainSummary, runDetail, runSummary, stepIcon } from './helply-timeline';
import { starterPrompts } from './helply-suggestions';

const tool = (id: string, at: number | null, change: Partial<ToolActivity> = {}): ToolActivity => ({
  id,
  label: 'Read your mail list',
  status: 'done',
  at,
  ...change,
});

describe('buildTimeline', () => {
  it('keeps text and steps in the order they happened, the answer after the last step', () => {
    const text = "I'll check your unread emails.\n\nLet me check the remaining unread messages.\n\nYou have 5 unread emails.";
    const first = text.indexOf("I'll") + "I'll check your unread emails.".length;
    const second = text.indexOf('Let me') + 'Let me check the remaining unread messages.'.length;
    const timeline = buildTimeline(text, [
      tool('t1', first),
      tool('t2', second, { detail: 'page 2' }),
      tool('t3', second, { detail: 'page 3' }),
      tool('t4', second, { detail: 'page 4' }),
    ]);

    expect(timeline.chain.map((e) => (e.kind === 'text' ? e.text : `${e.label} (${e.detail ?? ''})`))).toEqual([
      "I'll check your unread emails.",
      'Read your mail list ()',
      'Let me check the remaining unread messages.',
      'Read your mail list (3 pages)',
    ]);
    expect(timeline.answer).toBe('You have 5 unread emails.');
    expect(timeline.steps).toBe(4);
    expect(chainSummary(timeline)).toBe('Read your mail list · 4 steps');
  });

  it('folds identical steps only when nothing was written between them and they ended the same way', () => {
    const timeline = buildTimeline('Done.', [tool('a', 0), tool('b', 0), tool('c', 0, { status: 'failed' }), tool('d', 0, { label: 'Read an email' })]);
    expect(timeline.chain.map((e) => (e.kind === 'step' ? [e.label, e.status, e.count] : e.text))).toEqual([
      ['Read your mail list', 'done', 2],
      ['Read your mail list', 'failed', 1],
      ['Read an email', 'done', 1],
    ]);
    expect(chainSummary(timeline)).toBe('Read your mail list · Read an email · 4 steps');
  });

  it('never folds workspace commands, so each keeps its own output', () => {
    const code = { command: 'ls', output: 'a', exitCode: 0 };
    const timeline = buildTimeline('', [tool('a', 0, { label: 'Ran code', code }), tool('b', 0, { label: 'Ran code', code })]);
    expect(timeline.chain).toHaveLength(2);
  });

  it('puts steps without a place (older replies) first and leaves the text as the answer', () => {
    const timeline = buildTimeline('Your grades look good', [tool('a', null, { label: 'Looked up your grades' })]);
    expect(timeline.chain).toHaveLength(1);
    expect(timeline.answer).toBe('Your grades look good');
  });

  it('a reply without steps is all answer', () => {
    expect(buildTimeline(' Hi ', [])).toEqual({ chain: [], answer: 'Hi', steps: 0 });
  });

  it('while text is still arriving a step never sits beyond it', () => {
    const timeline = buildTimeline('Let me', [tool('a', 40)]);
    expect(timeline.chain[0]).toMatchObject({ kind: 'text', text: 'Let me' });
    expect(timeline.answer).toBe('');
  });
});

describe('chainBlocks and runSummary', () => {
  it('groups consecutive steps into runs between the text', () => {
    const text = 'First.\n\nSecond.\n\nAnswer.';
    const first = text.indexOf('First.') + 'First.'.length;
    const second = text.indexOf('Second.') + 'Second.'.length;
    const timeline = buildTimeline(text, [tool('a', first), tool('b', first, { label: 'Read an email' }), tool('c', second)]);
    const blocks = chainBlocks(timeline.chain);
    expect(blocks.map((b) => (b.kind === 'text' ? b.text : b.steps.map((s) => s.label)))).toEqual([
      'First.',
      ['Read your mail list', 'Read an email'],
      'Second.',
      ['Read your mail list'],
    ]);
  });

  it('sums folded runs in the one-line summary', () => {
    const timeline = buildTimeline('', [tool('a', 0), tool('b', 0), tool('c', 0, { label: 'Read an email' })]);
    const steps = chainBlocks(timeline.chain).flatMap((b) => (b.kind === 'steps' ? b.steps : []));
    expect(runSummary(steps)).toBe('Read your mail list · Read an email · 3 steps');
    expect(runSummary([])).toBe('Worked it out');
  });
});

describe('runDetail and stepIcon', () => {
  it('says how a run of steps went', () => {
    expect(runDetail([null])).toBeNull();
    expect(runDetail(['unread only'])).toBe('unread only');
    expect(runDetail([null, 'page 2 · unread only', 'page 3 · unread only'])).toBe('3 pages · unread only');
    expect(runDetail([null, null])).toBe('2 times');
  });

  it('picks an icon from the label', () => {
    expect(stepIcon('Read your mail list')).toBe('lucideMail');
    expect(stepIcon('Ran code')).toBe('lucideSquareTerminal');
    expect(stepIcon('Looked up your grades')).toBe('lucideGraduationCap');
    expect(stepIcon('Used Something')).toBe('lucideWrench');
  });
});

describe('starterPrompts', () => {
  const settings = (areas: HelplySettings['permissions']['areas'], workspace = false): HelplySettings => ({
    permissions: { areas, allowDestructive: false, microsoftAccountIds: null },
    workspace,
    workspaceAvailable: true,
    reasoningEffort: 'High',
  });

  it('offers nothing until the settings are known', () => {
    expect(starterPrompts(null)).toEqual([]);
  });

  it('hides mail questions when Mail is off', () => {
    const prompts = starterPrompts(settings({ Exams: 'Read', Grades: 'Read', Mail: 'Off' }));
    expect(prompts).toEqual(['What exams do I have this week?', 'How are my grades this semester?']);
    expect(prompts.join(' ')).not.toMatch(/mail/i);
  });

  it('adds one workspace question when the workspace is on, and never more than four', () => {
    const all = { Exams: 'Read', Mail: 'Read', Grades: 'Read', Calendar: 'Read', Absences: 'Read' } as const;
    expect(starterPrompts(settings(all))).toHaveLength(4);
    const withWorkspace = starterPrompts(settings(all, true));
    expect(withWorkspace).toHaveLength(4);
    expect(withWorkspace.at(-1)).toBe('Make a chart of my grades');
  });

  it('ignores the workspace switch when the server has no sandbox', () => {
    expect(starterPrompts({ ...settings({ Grades: 'Read' }, true), workspaceAvailable: false })).toEqual(['How are my grades this semester?']);
  });
});
