import { t } from '../../core/i18n';
import { ToolActivity, ToolCode, ToolStatus } from '../../core/helply-types';

/** A stretch of text Helply wrote between tool calls ("Let me check your mail."). */
export interface ChainText {
  kind: 'text';
  key: string;
  text: string;
}

/** One step, or a run of identical steps folded into one ("Read your mail list", 4 pages). */
export interface ChainStep {
  kind: 'step';
  key: string;
  label: string;
  status: ToolStatus;
  /** Short note under the label: the server's harmless detail, how often the step ran. */
  detail: string | null;
  count: number;
  icon: string;
  /** A workspace command, shown with its output when the step is opened. */
  code: ToolCode | null;
}

export type ChainEntry = ChainText | ChainStep;

/** A reply split into what Helply did on the way (an ordered chain) and the answer after the last step. */
export interface ReplyTimeline {
  chain: ChainEntry[];
  answer: string;
  /** How many tool calls the chain holds, folded runs counted in full. */
  steps: number;
}

const ICONS: [RegExp, string][] = [
  [/profile|school account/i, 'lucideUser'],
  [/\bcode\b/i, 'lucideSquareTerminal'],
  [/workspace file|shared a file|sharing a file/i, 'lucideFileCode'],
  [/mail|email/i, 'lucideMail'],
  [/teams|chat/i, 'lucideMessagesSquare'],
  [/onenote/i, 'lucideNotebookText'],
  [/grade|semester report/i, 'lucideGraduationCap'],
  [/exam/i, 'lucideNotebookPen'],
  [/absence/i, 'lucideCalendarX'],
  [/agenda|calendar/i, 'lucideCalendar'],
  [/onedrive|document|file|folder/i, 'lucideFileText'],
  [/search/i, 'lucideSearch'],
];

/** The lucide icon for a step, from its friendly label; a wrench for anything else. */
export function stepIcon(label: string): string {
  return ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? 'lucideWrench';
}

const KEY_ICONS: [RegExp, string][] = [
  [/^bash$/, 'lucideSquareTerminal'],
  [/^(write|share)_file$/, 'lucideFileCode'],
  [/mail/, 'lucideMail'],
  [/chat|channel|^list_teams$/, 'lucideMessagesSquare'],
  [/notebook|section|page/, 'lucideNotebookText'],
  [/grade|semester_report|subject/, 'lucideGraduationCap'],
  [/exam|assessment/, 'lucideNotebookPen'],
  [/absence/, 'lucideCalendarX'],
  [/agenda|calendar/, 'lucideCalendar'],
  [/^search$/, 'lucideSearch'],
  [/drive|document|file|folder|shared/, 'lucideFileText'],
  [/profile|school_account/, 'lucideUser'],
];

/** The icon for a step: by its key when it has one, else from its (English) label. */
export function toolIcon(tool: Pick<ToolActivity, 'key' | 'label'>): string {
  if (tool.key && tool.key !== 'generic') return KEY_ICONS.find(([pattern]) => pattern.test(tool.key!))?.[1] ?? 'lucideWrench';
  return stepIcon(tool.label);
}

/** What the language file knows under a key, or null when it does not (the lookup answers with the key itself then). */
function known(key: string, params?: Record<string, unknown>): string | null {
  const text = t(key, params);
  return text === key ? null : text;
}

const PHASES: Record<ToolStatus, 'running' | 'done'> = { running: 'running', done: 'done', failed: 'running', denied: 'running' };

/**
 * A step's label in the UI language: the server's stable key ("list_grades", or "generic" for a tool
 * without a label of its own) plus its args pick the sentence from the language file. A step without a
 * key (stored before labels followed the language) or with a key this app has no sentence for keeps the
 * server's English label.
 */
export function stepLabel(tool: Pick<ToolActivity, 'key' | 'label' | 'status' | 'args'>): string {
  if (!tool.key) return tool.label;
  const phase = PHASES[tool.status];
  if (tool.key === 'generic') {
    const name = tool.args?.['name'];
    return (name ? known(`helply.tool.generic.${phase}Named`, { name }) : known(`helply.tool.generic.${phase}`)) ?? tool.label;
  }
  return known(`helply.tool.${tool.key}.${phase}`) ?? tool.label;
}

/** One small fact under a step ("page 2", "unread only"). */
interface Note {
  /** Same id, same fact: folded runs show it once. */
  id: string;
  text: string;
  /** A page number: a run of these folds into "4 pages". */
  paged: boolean;
}

const PAGE = /^page \d+$/;

/** Notes of a step stored without args: the server's English detail, split into its parts. */
function legacyNotes(detail: string | null | undefined): Note[] {
  return detail ? detail.split(' · ').map((text) => ({ id: text, text, paged: PAGE.test(text) })) : [];
}

function argNote(key: string, value: string): Note | null {
  const id = `${key}:${value}`;
  switch (key) {
    case 'name':
      return null;
    case 'page': {
      const text = known('helply.note.page', { count: Number(value) });
      return text ? { id, text, paged: true } : null;
    }
    case 'folder': {
      const text = known(`helply.note.folder.${value}`);
      return text ? { id, text, paged: false } : null;
    }
    case 'terms': {
      const text = known('helply.note.terms', { count: Number(value) });
      return text ? { id, text, paged: false } : null;
    }
    case 'sources': {
      const names = value.split(',').map((source) => known(`helply.note.source.${source}`));
      const text = names.every((n) => n) ? known('helply.note.sources', { list: names.join(', ') }) : null;
      return text ? { id, text, paged: false } : null;
    }
    default: {
      const text = known(`helply.note.${key}`);
      return text ? { id, text, paged: false } : null;
    }
  }
}

/** The notes of a step in the UI language; the English detail stands in when the args hold something this app cannot say. */
function stepNotes(tool: Pick<ToolActivity, 'args' | 'detail'>): Note[] {
  const entries = Object.entries(tool.args ?? {}).filter(([key]) => key !== 'name');
  if (!entries.length) return legacyNotes(tool.detail);
  const notes = entries.map(([key, value]) => argNote(key, value));
  return notes.every((n): n is Note => n !== null) ? notes : legacyNotes(tool.detail);
}

function runNotes(runs: Note[][]): string | null {
  if (runs.length === 1) return runs[0].map((n) => n.text).join(' · ') || null;
  const parts = runs.flat();
  const paged = parts.some((p) => p.paged);
  const others = new Map(parts.filter((p) => !p.paged).map((p) => [p.id, p.text]));
  return [t(paged ? 'helply.run.pages' : 'helply.run.times', { count: runs.length }), ...others.values()].join(' · ');
}

/**
 * The note under a folded run: "4 pages" when it paged through results, "3 times" otherwise, plus any
 * other notes the steps carried ("unread only"). A single step keeps its own detail.
 */
export function runDetail(details: (string | null | undefined)[]): string | null {
  return runNotes(details.map(legacyNotes));
}

/**
 * Text and steps in the order they happened. Each step sits after the text that came before it (its
 * `at`); the text after the last step is the answer. Steps without a place (older replies) go first.
 * Consecutive identical steps with nothing written between them fold into one.
 */
export function buildTimeline(text: string, tools: readonly ToolActivity[]): ReplyTimeline {
  if (!tools.length) return { chain: [], answer: text.trim(), steps: 0 };
  const chain: ChainEntry[] = [];
  const notes = new Map<ChainStep, Note[][]>();
  let position = 0;
  for (const tool of tools) {
    const at = Math.min(Math.max(tool.at ?? 0, position), text.length);
    const between = text.slice(position, at).trim();
    if (between) chain.push({ kind: 'text', key: `text-${position}`, text: between });
    position = at;

    const label = stepLabel(tool);
    const last = chain[chain.length - 1];
    if (last?.kind === 'step' && !last.code && !tool.code && last.label === label && last.status === tool.status) {
      last.count++;
      notes.get(last)!.push(stepNotes(tool));
      continue;
    }
    const step: ChainStep = {
      kind: 'step',
      key: tool.id,
      label,
      status: tool.status,
      detail: null,
      count: 1,
      icon: toolIcon(tool),
      code: tool.code ?? null,
    };
    notes.set(step, [stepNotes(tool)]);
    chain.push(step);
  }
  for (const [step, runs] of notes) step.detail = runNotes(runs);
  return { chain, answer: text.slice(position).trim(), steps: tools.length };
}

/** A stretch of the chain: text Helply wrote, or the run of steps it took between two stretches of text. */
export type ChainBlock = { kind: 'text'; key: string; text: string } | { kind: 'steps'; key: string; steps: ChainStep[] };

/** The chain with its consecutive steps grouped, so each run folds and opens on its own. */
export function chainBlocks(chain: readonly ChainEntry[]): ChainBlock[] {
  const blocks: ChainBlock[] = [];
  for (const entry of chain) {
    const last = blocks[blocks.length - 1];
    if (entry.kind === 'text') blocks.push({ kind: 'text', key: entry.key, text: entry.text });
    else if (last?.kind === 'steps') last.steps.push(entry);
    else blocks.push({ kind: 'steps', key: `steps-${entry.key}`, steps: [entry] });
  }
  return blocks;
}

/** A finished run in one line: "Read your mail list · 4 steps", or the two kinds of step it took. */
export function runSummary(steps: readonly ChainStep[]): string {
  const labels = [...new Set(steps.map((s) => s.label))];
  if (!labels.length) return t('helply.run.worked');
  const shown = labels.slice(0, 2).join(' · ');
  const total = steps.reduce((sum, s) => sum + s.count, 0);
  return total > 1 ? `${shown} · ${t('helply.run.steps', { count: total })}` : shown;
}

/** A finished chain in one line. */
export function chainSummary(timeline: ReplyTimeline): string {
  return runSummary(timeline.chain.filter((e): e is ChainStep => e.kind === 'step'));
}
