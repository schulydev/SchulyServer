import { HelplySettings } from '../../core/helply-types';
import { McpArea, levelOf } from '../../core/mcp-permissions';

const MAX = 4;

/** Starter questions per area, in the order they are offered. */
const BY_AREA: [McpArea, string][] = [
  ['Exams', 'What exams do I have this week?'],
  ['Mail', 'Summarize my unread mail'],
  ['Grades', 'How are my grades this semester?'],
  ['Calendar', "What's on my agenda tomorrow?"],
  ['Absences', 'Do I have any unexcused absences?'],
  ['Teams', 'Catch me up on my Teams chats'],
  ['Drive', 'Which files did I change recently?'],
  ['OneNote', 'What did I note down in OneNote last week?'],
];

/**
 * What the empty chat suggests: only questions Helply may answer with what the user allowed, and one
 * that runs code when the workspace is on. Nothing until the settings are known.
 */
export function starterPrompts(settings: HelplySettings | null): string[] {
  if (!settings) return [];
  const on = (area: McpArea) => levelOf(settings.permissions, area) !== 'Off';
  const workspace = settings.workspace && settings.workspaceAvailable;
  const prompts = BY_AREA.filter(([area]) => on(area))
    .map(([, prompt]) => prompt)
    .slice(0, workspace ? MAX - 1 : MAX);
  if (workspace) {
    prompts.push(
      on('Grades') ? 'Make a chart of my grades' : on('Exams') ? 'Make a study plan for my exams' : 'Make a chart from numbers I paste',
    );
  }
  return prompts;
}
