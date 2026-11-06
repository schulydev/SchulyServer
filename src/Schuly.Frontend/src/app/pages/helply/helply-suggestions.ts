import { t } from '../../core/i18n';
import { HelplySettings } from '../../core/helply-types';
import { McpArea, levelOf } from '../../core/mcp-permissions';

const MAX = 4;

/** Starter questions per area, in the order they are offered. */
const BY_AREA: [McpArea, string][] = [
  ['Exams', 'helply.suggest.exams'],
  ['Mail', 'helply.suggest.mail'],
  ['Grades', 'helply.suggest.grades'],
  ['Calendar', 'helply.suggest.calendar'],
  ['Absences', 'helply.suggest.absences'],
  ['Teams', 'helply.suggest.teams'],
  ['Drive', 'helply.suggest.drive'],
  ['OneNote', 'helply.suggest.onenote'],
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
    .map(([, prompt]) => t(prompt))
    .slice(0, workspace ? MAX - 1 : MAX);
  if (workspace) {
    prompts.push(
      on('Grades') ? t('helply.suggest.chartGrades') : on('Exams') ? t('helply.suggest.studyPlan') : t('helply.suggest.chartNumbers'),
    );
  }
  return prompts;
}
