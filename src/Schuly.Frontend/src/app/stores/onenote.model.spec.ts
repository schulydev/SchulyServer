import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { OneNoteNode, OneNoteNotebook, findNode, oneNoteProblemOf, orderNotebooks, visibleRows } from './onenote.model';

const nb = (id: string, name: string, team: string | null, extra: Partial<OneNoteNotebook> = {}): OneNoteNotebook => ({
  id,
  displayName: name,
  createdDateTime: null,
  lastModifiedDateTime: null,
  isDefault: false,
  isShared: false,
  userRole: 'Owner',
  writable: true,
  webUrl: null,
  source: team ? { kind: 'team', id: 'g', name: team } : { kind: 'personal', id: null, name: null },
  ...extra,
});
const node = (id: string, kind: 'section' | 'group', children: OneNoteNode[] = []): OneNoteNode => ({
  id,
  kind,
  displayName: id,
  lastModifiedDateTime: null,
  isDefault: false,
  children,
});

describe('orderNotebooks', () => {
  it('puts personal notebooks first, then team notebooks by team name', () => {
    const ordered = orderNotebooks([nb('t2', 'Notes', 'Zoology'), nb('p2', 'B', null), nb('t1', 'Notes', 'Art'), nb('p1', 'A', null, { isDefault: true })]);
    expect(ordered.map((n) => n.id)).toEqual(['p1', 'p2', 't1', 't2']);
  });
});

describe('visibleRows', () => {
  const books = [nb('n1', 'One', null), nb('n2', 'Two', null)];
  const trees = { n1: { nodes: [node('g1', 'group', [node('s1', 'section')]), node('s2', 'section')] } };

  it('lists only expanded branches', () => {
    expect(visibleRows(books, trees, new Set()).map((r) => r.id)).toEqual(['n1', 'n2']);
    expect(visibleRows(books, trees, new Set(['n1'])).map((r) => r.id)).toEqual(['n1', 'g1', 's2', 'n2']);
    const rows = visibleRows(books, trees, new Set(['n1', 'g1']));
    expect(rows.map((r) => `${r.id}:${r.level}`)).toEqual(['n1:1', 'g1:2', 's1:3', 's2:2', 'n2:1']);
    expect(rows.find((r) => r.id === 's1')?.parentId).toBe('g1');
  });

  it('finds nodes in nested groups', () => {
    expect(findNode(trees.n1.nodes, 's1')?.id).toBe('s1');
    expect(findNode(trees.n1.nodes, 'nope')).toBeNull();
  });
});

describe('oneNoteProblemOf', () => {
  it('maps statuses', () => {
    const err = (status: number) => new HttpErrorResponse({ status });
    expect(oneNoteProblemOf(err(409))).toBe('expired');
    expect(oneNoteProblemOf(err(404))).toBe('missing');
    expect(oneNoteProblemOf(err(403))).toBe('readonly');
    expect(oneNoteProblemOf(err(422))).toBe('unsupported');
    expect(oneNoteProblemOf(err(502))).toBe('failed');
  });
});
