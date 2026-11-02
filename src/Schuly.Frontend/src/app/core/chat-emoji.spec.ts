import { describe, expect, it } from 'vitest';
import { parseCatalogue, toneEmoji, tonedChar } from './chat-emoji';

describe('skin tones', () => {
  it('reads the diverse flag from the catalogue', () => {
    const catalogue = parseCatalogue({ categories: [{ id: 'p', title: 'People', emojis: [{ id: 'wave', unicode: '\u{1F44B}', title: 'Wave', diverse: true }, { id: 'heart', unicode: '❤️', title: 'Heart' }] }] });
    expect(catalogue?.all.map((e) => e.diverse)).toEqual([true, false]);
  });
  it('applies the modifier after the first code point', () => {
    expect(tonedChar('\u{1F44B}', 1)).toBe('\u{1F44B}\u{1F3FB}');
    expect(tonedChar('\u{1F44B}', 5)).toBe('\u{1F44B}\u{1F3FF}');
    expect(tonedChar('☝️', 3)).toBe('☝\u{1F3FD}');
  });
  it('sends -tone ids and does not stack them', () => {
    const base = parseCatalogue({ categories: [{ id: 'p', title: 'P', emojis: [{ id: 'wave', unicode: '\u{1F44B}', title: 'Wave', diverse: true }] }] })!.all[0];
    const toned = toneEmoji(base, 3);
    expect(toned.id).toBe('wave-tone3');
    expect(toneEmoji(toned, 5).id).toBe('wave-tone5');
    expect(toned.alt).toBe('\u{1F44B}\u{1F3FD}');
  });
});
