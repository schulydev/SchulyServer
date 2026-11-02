import { describe, expect, it } from 'vitest';
import { ExplorerEntry, rangeOf, sortEntries, wantsThumbnail } from './drive-explorer';

const entry = (name: string, extra: Partial<ExplorerEntry> = {}): ExplorerEntry => ({
  id: name,
  name,
  isFolder: false,
  size: 0,
  modified: null,
  mime: null,
  childCount: null,
  ...extra,
});

describe('sortEntries', () => {
  const list = [
    entry('b.pdf', { size: 30, modified: '2026-01-03T00:00:00Z' }),
    entry('Zeta', { isFolder: true }),
    entry('a10.docx', { size: 10, modified: '2026-01-01T00:00:00Z' }),
    entry('a2.docx', { size: 20, modified: '2026-01-02T00:00:00Z' }),
    entry('Alpha', { isFolder: true }),
  ];
  const names = (sorted: ExplorerEntry[]) => sorted.map((e) => e.name);

  it('puts folders first and compares names numerically', () => {
    expect(names(sortEntries(list, { key: 'name', down: false }))).toEqual(['Alpha', 'Zeta', 'a2.docx', 'a10.docx', 'b.pdf']);
  });
  it('keeps folders first when descending', () => {
    expect(names(sortEntries(list, { key: 'name', down: true }))).toEqual(['Zeta', 'Alpha', 'b.pdf', 'a10.docx', 'a2.docx']);
  });
  it('sorts by size and modified', () => {
    expect(names(sortEntries(list, { key: 'size', down: true })).slice(2)).toEqual(['b.pdf', 'a2.docx', 'a10.docx']);
    expect(names(sortEntries(list, { key: 'modified', down: false })).slice(2)).toEqual(['a10.docx', 'a2.docx', 'b.pdf']);
  });
  it('sorts by type label', () => {
    expect(names(sortEntries(list, { key: 'type', down: false })).slice(2)).toEqual(['b.pdf', 'a2.docx', 'a10.docx']);
  });
});

describe('rangeOf', () => {
  it('takes the range either way', () => {
    expect(rangeOf(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeOf(['a', 'b', 'c', 'd'], 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(rangeOf(['a', 'b'], 'x', 'b')).toEqual(['b']);
  });
});

describe('wantsThumbnail', () => {
  it('asks only for kinds OneDrive renders', () => {
    expect(wantsThumbnail(entry('photo.jpg'))).toBe(true);
    expect(wantsThumbnail(entry('deck.pptx'))).toBe(true);
    expect(wantsThumbnail(entry('logo.svg'))).toBe(false);
    expect(wantsThumbnail(entry('notes.zip'))).toBe(false);
    expect(wantsThumbnail(entry('marks.csv'))).toBe(false);
    expect(wantsThumbnail(entry('Folder', { isFolder: true }))).toBe(false);
  });
});
