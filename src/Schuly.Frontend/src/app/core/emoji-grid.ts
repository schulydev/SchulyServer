/** Layout of the emoji picker's one scroll area: sections stacked, each a sticky label over rows of equal cells, so only the rows near the view need to exist. */

export const CELL_PX = 36;
export const LABEL_PX = 28;
/** Rows kept rendered above and below the view. */
const OVERSCAN_ROWS = 2;

export interface GridSection<T> {
  id: string;
  title: string;
  items: T[];
  /** Offset of the section's label inside the scroll area. */
  top: number;
  height: number;
}

export interface GridWindow<T> extends GridSection<T> {
  /** Height left empty above the rendered rows. */
  offset: number;
  shown: T[];
}

export function layoutGrid<T>(sections: { id: string; title: string; items: T[] }[], columns: number): GridSection<T>[] {
  let top = 0;
  return sections.map((s) => {
    const height = LABEL_PX + Math.ceil(s.items.length / columns) * CELL_PX;
    const placed = { ...s, top, height };
    top += height;
    return placed;
  });
}

/** Each section with only the items of the rows near the view [scrollTop, scrollTop + viewHeight]. */
export function windowGrid<T>(sections: GridSection<T>[], columns: number, scrollTop: number, viewHeight: number): GridWindow<T>[] {
  return sections.map((s) => {
    const rows = Math.ceil(s.items.length / columns);
    const first = Math.max(0, Math.floor((scrollTop - s.top - LABEL_PX) / CELL_PX) - OVERSCAN_ROWS);
    const last = Math.min(rows, Math.ceil((scrollTop + viewHeight - s.top - LABEL_PX) / CELL_PX) + OVERSCAN_ROWS);
    return last <= first ? { ...s, offset: 0, shown: [] } : { ...s, offset: first * CELL_PX, shown: s.items.slice(first * columns, last * columns) };
  });
}

/** The section at the top of the view; a section whose label is at the top counts. */
export function sectionAt<T>(sections: GridSection<T>[], scrollTop: number): GridSection<T> | null {
  return sections.find((s) => scrollTop < s.top + s.height) ?? sections[sections.length - 1] ?? null;
}

/** The scroll position that brings an item's row into view below the sticky label; the current one when it is already in view. */
export function scrollForItem<T>(section: GridSection<T>, index: number, columns: number, scrollTop: number, viewHeight: number): number {
  const rowTop = section.top + LABEL_PX + Math.floor(index / columns) * CELL_PX;
  if (rowTop - LABEL_PX < scrollTop) return Math.max(0, rowTop - LABEL_PX);
  if (rowTop + CELL_PX > scrollTop + viewHeight) return rowTop + CELL_PX - viewHeight;
  return scrollTop;
}

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/** Where a key moves from `index` in a list split into sections of the given sizes, keeping the column across sections. The index is over all sections. */
export function moveInGrid(sizes: number[], columns: number, index: number, key: GridKey): number {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  if (key === 'ArrowLeft') return Math.max(0, index - 1);
  if (key === 'ArrowRight') return Math.min(total - 1, index + 1);
  let section = 0;
  let start = 0;
  while (index >= start + sizes[section]) start += sizes[section++];
  const position = index - start;
  const column = position % columns;
  if (key === 'ArrowDown') {
    if (position + columns < sizes[section]) return index + columns;
    if (Math.floor(position / columns) < Math.floor((sizes[section] - 1) / columns)) return start + sizes[section] - 1;
    return section + 1 < sizes.length ? start + sizes[section] + Math.min(column, sizes[section + 1] - 1) : index;
  }
  if (position >= columns) return index - columns;
  if (section === 0) return index;
  const previous = sizes[section - 1];
  return start - previous + Math.min(Math.floor((previous - 1) / columns) * columns + column, previous - 1);
}
