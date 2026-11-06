import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';
import fr from '../../../public/i18n/fr.json';
import italian from '../../../public/i18n/it.json';
import rm from '../../../public/i18n/rm.json';
import { TestBed } from '@angular/core/testing';
import { LANGUAGE_KEY, LanguageStore, appLocale, dictionaryLookup, format, initialLanguage, useLookup } from './i18n';

const keys = (node: object, prefix = ''): string[] =>
  Object.entries(node).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const raw = (json: object, key: string): string => String(key.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], json));

const params = (text: string): string[] => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}|\{(\w+), plural,/g)].map((m) => m[1] ?? m[2]).sort();

describe('translations', () => {
  const reference = keys(de).sort();

  for (const [lang, json] of Object.entries({ en, fr, it: italian, rm })) {
    it(`${lang} has exactly the keys of de`, () => {
      const own = keys(json).sort();
      expect(own.filter((k) => !reference.includes(k)), 'extra keys').toEqual([]);
      expect(reference.filter((k) => !own.includes(k)), 'missing keys').toEqual([]);
    });

    it(`${lang} uses the same placeholders as de`, () => {
      expect(reference.filter((key) => params(raw(json, key)).join() !== params(raw(de, key)).join())).toEqual([]);
    });
  }
});

describe('format', () => {
  it('fills params and picks the plural case', () => {
    expect(format('{{name}} has {count, plural, one {# grade} other {# grades}}', { name: 'Mia', count: 1 }, 'en-CH')).toBe('Mia has 1 grade');
    expect(format('{count, plural, one {# Note} other {# Noten}}', { count: 3 }, 'de-CH')).toBe('3 Noten');
    expect(format('{count, plural, =0 {heute} =1 {morgen} other {in # Tagen}}', { count: 0 }, 'de-CH')).toBe('heute');
  });
});

describe('initialLanguage', () => {
  it('prefers the saved choice', () => {
    expect(initialLanguage('fr', ['de-CH'])).toBe('fr');
  });

  it('falls back to the first supported browser language', () => {
    expect(initialLanguage(null, ['es-ES', 'it-CH', 'de'])).toBe('it');
    expect(initialLanguage('xx', ['rm'])).toBe('rm');
  });

  it('uses German when nothing matches', () => {
    expect(initialLanguage(null, ['es-ES', 'ja'])).toBe('de');
    expect(initialLanguage(null, [])).toBe('de');
  });
});

describe('LanguageStore', () => {
  afterEach(() => {
    localStorage.removeItem(LANGUAGE_KEY);
    useLookup('en', dictionaryLookup(en));
  });

  it('remembers the choice, sets the page language and the locale', async () => {
    await TestBed.inject(LanguageStore).use('fr');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(appLocale()).toBe('fr-CH');
  });
});
