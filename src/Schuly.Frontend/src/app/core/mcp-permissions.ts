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
    label: 'Schuly',
    areas: [
      { area: 'Grades', label: 'Grades', description: 'Your grades and averages.', canWrite: false },
      { area: 'Exams', label: 'Exams', description: 'Upcoming and past exams.', canWrite: false },
      {
        area: 'Calendar',
        label: 'Calendar & agenda',
        description: 'Your school agenda, and the calendars of the linked accounts you allow below.',
        canWrite: false,
      },
      {
        area: 'Absences',
        label: 'Absences',
        description: 'Read absences. Write also reports and withdraws absences with your school.',
        canWrite: true,
      },
      { area: 'Documents', label: 'Documents', description: 'Documents from your school.', canWrite: false },
      {
        area: 'SchoolAccounts',
        label: 'School accounts',
        description: 'Which schools and classes are connected.',
        canWrite: false,
      },
    ],
  },
  {
    label: 'Linked accounts',
    areas: [
      {
        area: 'Mail',
        label: 'Mail',
        description: 'Read mail. Write also sends, replies, forwards, moves, flags and marks as read.',
        canWrite: true,
      },
      {
        area: 'Teams',
        label: 'Teams',
        description: 'Read chats. Write also sends chat messages.',
        canWrite: true,
      },
      { area: 'Drive', label: 'Drive', description: 'Browse your OneDrive files.', canWrite: false },
      { area: 'OneNote', label: 'OneNote', description: 'Read and edit your OneNote notebooks.', canWrite: true },
    ],
  },
];

export const MCP_AREAS: McpAreaInfo[] = MCP_GROUPS.flatMap((group) => group.areas);

export const MCP_LEVEL_LABELS: Record<McpAccessLevel, string> = {
  Off: 'Off',
  Read: 'Read',
  ReadWrite: 'Read & write',
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
    chips.push(`${info.label}: ${level === 'ReadWrite' ? 'read & write' : 'read'}`);
  }
  if (!chips.length) return ['No access'];
  if (permissions.allowDestructive && hasWrite(permissions)) chips.push('Deleting allowed');
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
