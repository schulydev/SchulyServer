import { describe, expect, it } from 'vitest';
import { CELL_PX, LABEL_PX, layoutGrid, moveInGrid, scrollForItem, sectionAt, windowGrid } from './emoji-grid';

const items = (n: number) => Array.from({ length: n }, (_, i) => i);
const sections = (...sizes: number[]) => layoutGrid(sizes.map((n, i) => ({ id: `s${i}`, title: `S${i}`, items: items(n) })), 9);

describe('emoji grid', () => {
  it('stacks sections by their rows', () => {
    const [a, b] = sections(10, 3);
    expect(a.height).toBe(LABEL_PX + 2 * CELL_PX);
    expect(b.top).toBe(a.height);
  });

  it('renders only the rows near the view, so the whole catalogue stays cheap', () => {
    const laidOut = sections(219, 63, 257, 159, 137, 226, 260, 86, 246);
    const shown = windowGrid(laidOut, 9, 2000, 288).reduce((n, s) => n + s.shown.length, 0);
    expect(shown).toBeLessThan(120);
    expect(shown).toBeGreaterThan(0);
  });

  it('offsets the rendered rows so they sit where the scroll position expects', () => {
    const [s] = windowGrid(sections(219), 9, 10 * CELL_PX + LABEL_PX, 288);
    expect(s.offset).toBe(8 * CELL_PX);
    expect(s.shown[0]).toBe(8 * 9);
  });

  it('leaves far sections empty', () => {
    const window = windowGrid(sections(45, 45), 9, 0, 100);
    expect(window[1].shown).toEqual([]);
  });

  it('finds the section at the top of the view, including right at its label', () => {
    const laidOut = sections(45, 45);
    expect(sectionAt(laidOut, 0)?.id).toBe('s0');
    expect(sectionAt(laidOut, laidOut[1].top - 1)?.id).toBe('s0');
    expect(sectionAt(laidOut, laidOut[1].top)?.id).toBe('s1');
  });

  it('scrolls only when the row is out of view', () => {
    const [s] = sections(90);
    expect(scrollForItem(s, 0, 9, 0, 288)).toBe(0);
    expect(scrollForItem(s, 89, 9, 0, 288)).toBe(LABEL_PX + 10 * CELL_PX - 288);
    expect(scrollForItem(s, 0, 9, 200, 288)).toBe(0);
  });
});

describe('moving through the grid with the keyboard', () => {
  it('moves by cell and row within a section', () => {
    expect(moveInGrid([20], 9, 0, 'ArrowRight')).toBe(1);
    expect(moveInGrid([20], 9, 1, 'ArrowLeft')).toBe(0);
    expect(moveInGrid([20], 9, 1, 'ArrowDown')).toBe(10);
    expect(moveInGrid([20], 9, 10, 'ArrowUp')).toBe(1);
  });

  it('stops at the ends', () => {
    expect(moveInGrid([20], 9, 0, 'ArrowLeft')).toBe(0);
    expect(moveInGrid([20], 9, 19, 'ArrowRight')).toBe(19);
    expect(moveInGrid([20], 9, 2, 'ArrowUp')).toBe(2);
    expect(moveInGrid([20], 9, 19, 'ArrowDown')).toBe(19);
    expect(moveInGrid([20], 9, 5, 'Home')).toBe(0);
    expect(moveInGrid([20], 9, 5, 'End')).toBe(19);
  });

  it('goes to the short last row when the cell below does not exist', () => {
    expect(moveInGrid([20], 9, 15, 'ArrowDown')).toBe(19);
  });

  it('keeps the column across sections', () => {
    // Section one has rows of 9, 9 and 2.
    expect(moveInGrid([20, 20], 9, 19, 'ArrowDown')).toBe(21);
    expect(moveInGrid([20, 20], 9, 21, 'ArrowUp')).toBe(19);
    expect(moveInGrid([20, 20], 9, 25, 'ArrowUp')).toBe(19);
  });
});
