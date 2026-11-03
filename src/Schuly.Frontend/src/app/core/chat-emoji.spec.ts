import { describe, expect, it } from 'vitest';
import { addSearchTerms, emojiQueryAt, parseCatalogue, searchCatalogue, searchLanguage, searchShortcuts, searchTerms, toneEmoji, tonedChar } from './chat-emoji';

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

describe('toned pictures', () => {
  const base = parseCatalogue({ categories: [{ id: 'p', title: 'P', emojis: [{ id: 'yes', unicode: '\u{1F44D}', title: 'Yes', diverse: true, animated: true, frames: 24, staticUrl: 'https://statics.teams.cdn.office.net/a/yes/default/30_f.png?v=v70', animatedUrl: 'https://statics.teams.cdn.office.net/a/yes/default/30_anim_f.png?v=v70' }] }] })!.all[0];

  it('points at the tone variant, as Teams names it', () => {
    const toned = toneEmoji(base, 4);
    expect(toned.staticUrl).toBe('https://statics.teams.cdn.office.net/a/yes/default/30_f_s5.png?v=v70');
    expect(toned.animatedUrl).toBe('https://statics.teams.cdn.office.net/a/yes/default/30_anim_f_s5.png?v=v70');
  });

  it('does not stack tones', () => {
    expect(toneEmoji(toneEmoji(base, 1), 5).staticUrl).toBe('https://statics.teams.cdn.office.net/a/yes/default/30_f_s6.png?v=v70');
  });
});

describe('shortcuts', () => {
  const catalogue = parseCatalogue({
    categories: [
      {
        id: 'c',
        title: 'C',
        emojis: [
          { id: 'loudlycrying', unicode: '\u{1F62D}', title: 'Loudly crying', shortcuts: ['(sob)', '(loudlycrying)', '(1f62d_sob)'] },
          { id: 'sobber', unicode: '\u{1F622}', title: 'Sobber', shortcuts: ['(sobber)'] },
          { id: 'laugh', unicode: '\u{1F606}', title: 'Laugh', shortcuts: ['(laugh)'] },
        ],
      },
    ],
  })!;

  it('offers a shortcode once, from the Teams catalogue', () => {
    const codes = searchShortcuts(catalogue, 'sob').map((m) => m.code);
    expect(codes.filter((c) => c === 'sob')).toHaveLength(1);
    expect(codes).toEqual(['sob', 'sobber']);
  });

  it('offers an emoji once, under its best shortcode', () => {
    expect(searchShortcuts(catalogue, 'sob').filter((m) => m.emoji.id === 'loudlycrying')).toHaveLength(1);
  });

  it('reads the query at the caret', () => {
    expect(emojiQueryAt('hi :sob', 7)).toEqual({ start: 3, query: 'sob' });
    expect(emojiQueryAt('hi :s', 5)).toBeNull();
    expect(emojiQueryAt('a:sob', 5)).toBeNull();
  });
});

describe('search words in the browser language', () => {
  const english = () => parseCatalogue({ categories: [{ id: 'c', title: 'C', emojis: [{ id: 'heart', unicode: '\u2764', title: 'Red heart', keywords: ['love'] }] }] })!;

  it('asks for the language only, and nothing for English', () => {
    expect(searchLanguage('de-CH')).toBe('de');
    expect(searchLanguage('fr')).toBe('fr');
    expect(searchLanguage('en-GB')).toBeNull();
    expect(searchLanguage(undefined)).toBeNull();
  });

  it('finds an emoji by the translated word and keeps the English label', () => {
    const catalogue = english();
    expect(searchCatalogue(catalogue, 'herz')).toEqual([]);
    addSearchTerms(catalogue, searchTerms({ categories: [{ emojis: [{ id: 'heart', title: 'Rotes Herz', keywords: ['Liebe'] }] }] }));
    const [hit] = searchCatalogue(catalogue, 'herz');
    expect(hit.id).toBe('heart');
    expect(hit.label).toBe('Red heart');
    expect(searchCatalogue(catalogue, 'love')).toHaveLength(1);
  });
});
