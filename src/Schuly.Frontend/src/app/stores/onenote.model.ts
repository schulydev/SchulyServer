import { HttpErrorResponse } from '@angular/common/http';

/** Shapes of the OneNote plugin routes; ids are opaque and only ever passed back. */
export interface OneNoteNotebook {
  id: string;
  displayName: string;
  createdDateTime: string | null;
  lastModifiedDateTime: string | null;
  isDefault: boolean;
  isShared: boolean;
  userRole: 'Owner' | 'Contributor' | 'Reader' | null;
  writable: boolean;
  webUrl: string | null;
  source: { kind: 'personal' | 'team'; id: string | null; name: string | null };
}

export interface OneNoteNode {
  id: string;
  kind: 'section' | 'group';
  displayName: string;
  lastModifiedDateTime: string | null;
  isDefault: boolean;
  children: OneNoteNode[];
}

export interface OneNotePageSummary {
  id: string;
  title: string;
  level: number;
  order: number | null;
  createdDateTime: string | null;
  lastModifiedDateTime: string | null;
  webUrl: string | null;
  sectionId: string;
}

export interface OneNotePagesResult {
  items: OneNotePageSummary[];
  nextSkip: number | null;
}

export interface OneNoteResource {
  id: string;
  kind: 'image' | 'file';
  name: string | null;
  contentType: string | null;
}

export interface OneNoteOutline {
  id: string;
  editable: boolean;
  html: string;
}

export interface OneNotePageContent {
  id: string;
  title: string;
  createdDateTime: string | null;
  lastModifiedDateTime: string | null;
  webUrl: string | null;
  section: { id: string; displayName: string } | null;
  notebook: { id: string; displayName: string } | null;
  writable: boolean;
  html: string;
  width: number;
  height: number;
  resources: OneNoteResource[];
  outlines: OneNoteOutline[];
  hasInk: boolean;
}

export interface OneNotePageUpdate {
  title?: string;
  outlines?: { id: string; html: string }[];
  append?: string;
}

export interface OneNoteSearchHit {
  id: string;
  title: string;
  lastModifiedDateTime: string | null;
  webUrl: string | null;
  section: { id: string; displayName: string } | null;
  notebook: { id: string; displayName: string } | null;
}

export interface OneNoteSearchResult {
  items: OneNoteSearchHit[];
  partial: boolean;
}

export interface OneNoteTree {
  notebookId: string;
  children: OneNoteNode[];
}

export type OneNoteProblem = 'expired' | 'missing' | 'failed' | 'unsupported' | 'readonly';

export const oneNoteProblemOf = (error: unknown): OneNoteProblem => {
  if (!(error instanceof HttpErrorResponse)) return 'failed';
  if (error.status === 409) return 'expired';
  if (error.status === 404) return 'missing';
  if (error.status === 403) return 'readonly';
  if (error.status === 422) return 'unsupported';
  return 'failed';
};

/** Personal notebooks first (default one on top), then team and class notebooks grouped by team name. */
export function orderNotebooks(notebooks: OneNoteNotebook[]): OneNoteNotebook[] {
  const name = (n: OneNoteNotebook) => n.displayName || '';
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const personal = notebooks
    .filter((n) => n.source?.kind !== 'team')
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || compare(name(a), name(b)));
  const teams = notebooks
    .filter((n) => n.source?.kind === 'team')
    .sort((a, b) => compare(a.source.name ?? '', b.source.name ?? '') || compare(name(a), name(b)));
  return [...personal, ...teams];
}

/** One row of the visible tree, in display order; the keyboard moves through these. */
export interface TreeRow {
  id: string;
  kind: 'notebook' | 'group' | 'section';
  parentId: string | null;
  level: number;
  expandable: boolean;
}

export function visibleRows(
  notebooks: OneNoteNotebook[],
  trees: Record<string, { nodes: OneNoteNode[] | null } | undefined>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (nodes: OneNoteNode[], parentId: string, level: number) => {
    for (const node of nodes) {
      const isGroup = node.kind === 'group';
      rows.push({ id: node.id, kind: node.kind, parentId, level, expandable: isGroup });
      if (isGroup && expanded.has(node.id)) walk(node.children, node.id, level + 1);
    }
  };
  for (const notebook of notebooks) {
    rows.push({ id: notebook.id, kind: 'notebook', parentId: null, level: 1, expandable: true });
    if (expanded.has(notebook.id)) walk(trees[notebook.id]?.nodes ?? [], notebook.id, 2);
  }
  return rows;
}

/** Finds a section or group by id anywhere in a section tree. */
export function findNode(nodes: OneNoteNode[], id: string): OneNoteNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inner = findNode(node.children, id);
    if (inner) return inner;
  }
  return null;
}
