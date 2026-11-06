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
  [/profile|school account/i, 'lucideUser'],
];

/** The lucide icon for a step, from its friendly label; a wrench for anything else. */
export function stepIcon(label: string): string {
  return ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? 'lucideWrench';
}

const PAGE = /^page \d+$/;

/**
 * The note under a folded run: "4 pages" when it paged through results, "3 times" otherwise, plus any
 * other notes the steps carried ("unread only"). A single step keeps its own detail.
 */
export function runDetail(details: (string | null | undefined)[]): string | null {
  if (details.length === 1) return details[0] || null;
  const parts = details.flatMap((d) => (d ? d.split(' · ') : []));
  const paged = parts.some((p) => PAGE.test(p));
  const others = [...new Set(parts.filter((p) => !PAGE.test(p)))];
  return [t(paged ? 'helply.run.pages' : 'helply.run.times', { count: details.length }), ...others].join(' · ');
}

/**
 * Text and steps in the order they happened. Each step sits after the text that came before it (its
 * `at`); the text after the last step is the answer. Steps without a place (older replies) go first.
 * Consecutive identical steps with nothing written between them fold into one.
 */
export function buildTimeline(text: string, tools: readonly ToolActivity[]): ReplyTimeline {
  if (!tools.length) return { chain: [], answer: text.trim(), steps: 0 };
  const chain: ChainEntry[] = [];
  const details = new Map<ChainStep, (string | null | undefined)[]>();
  let position = 0;
  for (const tool of tools) {
    const at = Math.min(Math.max(tool.at ?? 0, position), text.length);
    const between = text.slice(position, at).trim();
    if (between) chain.push({ kind: 'text', key: `text-${position}`, text: between });
    position = at;

    const last = chain[chain.length - 1];
    if (last?.kind === 'step' && !last.code && !tool.code && last.label === tool.label && last.status === tool.status) {
      last.count++;
      details.get(last)!.push(tool.detail);
      continue;
    }
    const step: ChainStep = {
      kind: 'step',
      key: tool.id,
      label: tool.label,
      status: tool.status,
      detail: null,
      count: 1,
      icon: stepIcon(tool.label),
      code: tool.code ?? null,
    };
    details.set(step, [tool.detail]);
    chain.push(step);
  }
  for (const [step, notes] of details) step.detail = runDetail(notes);
  return { chain, answer: text.slice(position).trim(), steps: tools.length };
}

/** A finished chain in one line: "Read your mail list · 4 steps", or the two kinds of step it took. */
export function chainSummary(timeline: ReplyTimeline): string {
  const labels = [...new Set(timeline.chain.flatMap((e) => (e.kind === 'step' ? [e.label] : [])))];
  if (!labels.length) return t('helply.run.worked');
  const shown = labels.slice(0, 2).join(' · ');
  return timeline.steps > 1 ? `${shown} · ${t('helply.run.steps', { count: timeline.steps })}` : shown;
}
