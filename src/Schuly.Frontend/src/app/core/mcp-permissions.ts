import { t } from '../core/i18n';
export type McpArea =
  | 'Grades'
  | 'Exams'
  | 'Calendar'
  | 'Absences'
  | 'Documents'
  | 'SchoolAccounts'
  | 'Mail'
  | 'Teams'
  | 'Drive'
  | 'OneNote';
export type McpAccessLevel = 'Off' | 'Read' | 'ReadWrite';

export interface McpPermissionSet {
  areas: Partial<Record<McpArea, McpAccessLevel>>;
  allowDestructive: boolean;
  /** null means every linked account, including ones linked later. */
  microsoftAccountIds: string[] | null;
}

export interface McpAreaInfo {
  area: McpArea;
  label: string;
  description: string;
  canWrite: boolean;
}

export interface McpAreaGroup {
  label: string;
  areas: McpAreaInfo[];
}

export const MCP_GROUPS: McpAreaGroup[] = [
  {
    label: 'mcp.group.schuly',
    areas: [
      { area: 'Grades', label: 'mcp.area.grades', description: 'mcp.area.gradesHint', canWrite: false },
      { area: 'Exams', label: 'mcp.area.exams', description: 'mcp.area.examsHint', canWrite: false },
      {
        area: 'Calendar',
        label: 'mcp.area.calendar',
        description: 'mcp.area.calendarHint',
        canWrite: false,
      },
      {
        area: 'Absences',
        label: 'mcp.area.absences',
        description: 'mcp.area.absencesHint',
        canWrite: true,
      },
      { area: 'Documents', label: 'mcp.area.documents', description: 'mcp.area.documentsHint', canWrite: false },
      {
        area: 'SchoolAccounts',
        label: 'mcp.area.schoolAccounts',
        description: 'mcp.area.schoolAccountsHint',
        canWrite: false,
      },
    ],
  },
  {
    label: 'mcp.group.linked',
    areas: [
      {
        area: 'Mail',
        label: 'mcp.area.mail',
        description: 'mcp.area.mailHint',
        canWrite: true,
      },
      {
        area: 'Teams',
        label: 'mcp.area.teams',
        description: 'mcp.area.teamsHint',
        canWrite: true,
      },
      { area: 'Drive', label: 'mcp.area.drive', description: 'mcp.area.driveHint', canWrite: false },
      { area: 'OneNote', label: 'mcp.area.onenote', description: 'mcp.area.onenoteHint', canWrite: true },
    ],
  },
];

export const MCP_AREAS: McpAreaInfo[] = MCP_GROUPS.flatMap((group) => group.areas);

export const MCP_LEVEL_LABELS: Record<McpAccessLevel, string> = {
  Off: 'mcp.level.off',
  Read: 'mcp.level.read',
  ReadWrite: 'mcp.level.readWrite',
};

export const levelOf = (permissions: McpPermissionSet, area: McpArea): McpAccessLevel =>
  permissions.areas[area] ?? 'Off';

export const hasWrite = (permissions: McpPermissionSet): boolean =>
  MCP_AREAS.some((info) => info.canWrite && levelOf(permissions, info.area) === 'ReadWrite');

const LINKED_AREAS = new Set<McpArea>(['Mail', 'Teams', 'Drive', 'OneNote']);

/** The default for Helply and new connections: school data, read-only, and no Microsoft account. */
export const schoolDataPreset = (): McpPermissionSet => ({
  areas: Object.fromEntries(
    MCP_AREAS.filter((info) => !LINKED_AREAS.has(info.area)).map((info) => [info.area, 'Read']),
  ) as McpPermissionSet['areas'],
  allowDestructive: false,
  microsoftAccountIds: [],
});

/** An empty list means "no account yet", which would make a preset or a Microsoft area silently empty. */
const usableAccounts = (ids: string[] | null): string[] | null => (ids?.length ? ids : null);

export const readOnlyPreset = (microsoftAccountIds: string[] | null = null): McpPermissionSet => ({
  areas: Object.fromEntries(MCP_AREAS.map((info) => [info.area, 'Read'])) as McpPermissionSet['areas'],
  allowDestructive: false,
  microsoftAccountIds,
});

/** Applies a preset from the editor: a preset with Microsoft areas needs an account to work on. */
export const presetAccounts = usableAccounts;

export const fullAccessPreset = (microsoftAccountIds: string[] | null = null): McpPermissionSet => ({
  areas: Object.fromEntries(
    MCP_AREAS.map((info) => [info.area, info.canWrite ? 'ReadWrite' : 'Read']),
  ) as McpPermissionSet['areas'],
  allowDestructive: true,
  microsoftAccountIds,
});

/** Sets one area. Turning off the last write permission also drops "allow deleting". */
export function withLevel(
  permissions: McpPermissionSet,
  area: McpArea,
  level: McpAccessLevel,
): McpPermissionSet {
  const microsoftAccountIds =
    LINKED_AREAS.has(area) && level !== 'Off' ? usableAccounts(permissions.microsoftAccountIds) : permissions.microsoftAccountIds;
  const next = { ...permissions, microsoftAccountIds, areas: { ...permissions.areas, [area]: level } };
  return hasWrite(next) ? next : { ...next, allowDestructive: false };
}

/** Short chips such as "Grades: read" or "Mail: read & write". Areas that are off are omitted. */
export function summarize(permissions: McpPermissionSet): string[] {
  const chips: string[] = [];
  for (const info of MCP_AREAS) {
    const level = levelOf(permissions, info.area);
    if (level === 'Off') continue;
    chips.push(t(level === 'ReadWrite' ? 'mcp.chip.readWrite' : 'mcp.chip.read', { area: t(info.label) }));
  }
  if (!chips.length) return [t('mcp.chip.none')];
  if (permissions.allowDestructive && hasWrite(permissions)) chips.push(t('mcp.chip.delete'));
  return chips;
}

export function samePermissions(a: McpPermissionSet, b: McpPermissionSet): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(permissions: McpPermissionSet) {
  return {
    areas: MCP_AREAS.map((info) => levelOf(permissions, info.area)),
    allowDestructive: permissions.allowDestructive,
    accounts: permissions.microsoftAccountIds ? [...permissions.microsoftAccountIds].sort() : null,
  };
}
