import { afterEach, describe, expect, it } from 'vitest';
import { HelplySettings, ToolActivity } from '../../core/helply-types';
import { dictionaryLookup, useLookup } from '../../core/i18n';
import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';
import rm from '../../../../public/i18n/rm.json';
import { buildTimeline, chainBlocks, chainSummary, runDetail, runSummary, stepIcon, stepLabel, toolIcon } from './helply-timeline';
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

describe('translated step labels', () => {
  const keyed = (id: string, key: string | null, change: Partial<ToolActivity> = {}): ToolActivity => ({ id, label: 'Read your profile', status: 'done', at: 0, key, ...change });

  afterEach(() => useLookup('en', dictionaryLookup(en)));

  it('follows the UI language, so a German UI has no English step', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    const timeline = buildTimeline('', [keyed('a', 'get_profile'), keyed('b', 'list_grades', { label: 'Looked up your grades' }), keyed('c', 'list_exams', { label: 'x' })]);
    const steps = timeline.chain.flatMap((e) => (e.kind === 'step' ? [e.label] : []));
    expect(steps).toEqual(['Dein Profil gelesen', 'Deine Noten nachgeschlagen', 'Deine Prüfungen angeschaut']);
    expect(chainSummary(timeline)).toBe('Dein Profil gelesen · Deine Noten nachgeschlagen · 3 Schritte');
  });

  it('uses the running sentence while running, failed or denied and the done sentence when done', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    expect(stepLabel(keyed('a', 'get_profile', { status: 'running' }))).toBe('Dein Profil wird gelesen');
    expect(stepLabel(keyed('a', 'get_profile', { status: 'failed' }))).toBe('Dein Profil wird gelesen');
    expect(stepLabel(keyed('a', 'get_profile', { status: 'done' }))).toBe('Dein Profil gelesen');
  });

  it('translates the new tools in every language', () => {
    for (const [lang, dict] of [['de', de], ['en', en], ['rm', rm]] as const) {
      useLookup(lang, dictionaryLookup(dict));
      for (const key of ['search', 'list_subjects', 'list_assessments'])
        expect(stepLabel(keyed('a', key, { label: 'ENGLISH-FALLBACK' }))).not.toBe('ENGLISH-FALLBACK');
    }
    useLookup('rm', dictionaryLookup(rm));
    expect(stepLabel(keyed('a', 'list_subjects', { status: 'running' }))).toBe('Tes materias vegnan tschertgadas');
  });

  it('keeps the English label for an unknown key or a step stored without one', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    expect(stepLabel(keyed('a', 'tool_from_a_newer_server', { label: 'Doing something new' }))).toBe('Doing something new');
    expect(stepLabel(keyed('a', null, { label: 'Read your profile' }))).toBe('Read your profile');
    expect(stepLabel({ label: 'Read your profile', status: 'done' })).toBe('Read your profile');
    expect(buildTimeline('', [keyed('a', null)]).chain[0]).toMatchObject({ label: 'Read your profile', icon: 'lucideUser' });
  });

  it('names a tool without a label of its own', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    expect(stepLabel(keyed('a', 'generic', { args: { name: 'Stundenplan' } }))).toBe('Stundenplan verwendet');
    expect(stepLabel(keyed('a', 'generic'))).toBe('Ein Tool verwendet');
  });

  it('translates the notes under a step and folds a run of pages', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    const mail = (id: string, page: string) => keyed(id, 'list_mail', { args: { page, unreadOnly: 'true', folder: 'sentitems' } });
    const single = buildTimeline('', [mail('a', '2')]).chain[0];
    expect(single).toMatchObject({ kind: 'step', detail: 'Seite 2 · nur ungelesene · gesendete Mails' });
    const folded = buildTimeline('', [mail('a', '2'), mail('b', '3'), mail('c', '4')]).chain[0];
    expect(folded).toMatchObject({ count: 3, detail: '3 Seiten · nur ungelesene · gesendete Mails' });
    const repeated = buildTimeline('', [keyed('a', 'get_profile'), keyed('b', 'get_profile')]).chain[0];
    expect(repeated).toMatchObject({ label: 'Dein Profil gelesen', detail: '2 Mal' });
  });

  it('translates search terms and sources', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    const step = buildTimeline('', [keyed('a', 'search', { args: { terms: '3', sources: 'files,mail' } })]).chain[0];
    expect(step).toMatchObject({ label: 'Dateien, Notizen, Mails und Chats durchsucht', detail: '3 Suchbegriffe · in Dateien, Mails' });
  });

  it('shows the English detail of a step stored without args, or whose args it cannot say', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    expect(buildTimeline('', [keyed('a', null, { detail: 'page 2 · unread only' })]).chain[0]).toMatchObject({ detail: 'page 2 · unread only' });
    expect(buildTimeline('', [keyed('a', 'list_mail', { detail: 'page 2', args: { somethingNew: 'x' } })]).chain[0]).toMatchObject({ detail: 'page 2' });
  });

  it('picks an icon by key', () => {
    expect(toolIcon({ key: 'list_mail', label: 'x' })).toBe('lucideMail');
    expect(toolIcon({ key: 'list_assessments', label: 'x' })).toBe('lucideNotebookPen');
    expect(toolIcon({ key: 'search', label: 'x' })).toBe('lucideSearch');
    expect(toolIcon({ key: 'generic', label: 'Used Something' })).toBe('lucideWrench');
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
