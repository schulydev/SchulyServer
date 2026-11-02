import { describe, expect, it } from 'vitest';
import { formatModified, formatWhen, relativeDayLabel, uiLocale } from './date-format';

const NBSP = /[  ]/g;
const plain = (s: string) => s.replace(NBSP, ' ');

describe('formatWhen', () => {
  const at = new Date(2026, 9, 31, 18, 21);
  it('uses dd.MM.yyyy and 24-hour time in de-CH', () => {
    expect(formatWhen(at, 'date', 'de-CH')).toBe('31.10.2026');
    expect(formatWhen(at, 'time', 'de-CH')).toBe('18:21');
    expect(plain(formatWhen(at, 'dateTime', 'de-CH'))).toBe('31.10.2026, 18:21');
  });
  it('is 24-hour even for locales that default to 12-hour', () => {
    expect(formatWhen(at, 'time', 'en-US')).toBe('18:21');
    expect(formatWhen(new Date(2026, 9, 31, 0, 5), 'time', 'en-US')).toBe('00:05');
  });
  it('gives weekday names', () => {
    expect(formatWhen(at, 'weekdayLong', 'de-CH')).toBe('Samstag');
    expect(formatWhen(at, 'weekdayLong', 'en-GB')).toBe('Saturday');
  });
  it('gives an empty string for nothing or nonsense', () => {
    expect(formatWhen(null, 'date')).toBe('');
    expect(formatWhen('', 'date')).toBe('');
    expect(formatWhen('nope', 'date')).toBe('');
  });
});

describe('relativeDayLabel', () => {
  const now = new Date(2026, 9, 29, 15, 0);
  it('names today and yesterday in the UI language', () => {
    expect(relativeDayLabel(new Date(2026, 9, 29, 1, 0), now, 'de-CH')).toBe('Heute');
    expect(relativeDayLabel(new Date(2026, 9, 28, 23, 0), now, 'de-CH')).toBe('Gestern');
    expect(relativeDayLabel(new Date(2026, 9, 29, 1, 0), now, 'en-GB')).toBe('Today');
    expect(relativeDayLabel(new Date(2026, 9, 28, 23, 0), now, 'en-US')).toBe('Yesterday');
    expect(relativeDayLabel(new Date(2026, 9, 20), now, 'de-CH')).toBeNull();
  });
});

describe('formatModified', () => {
  const now = new Date(2026, 9, 29, 15, 0);
  it('reads Heute/Gestern with the time, else the date', () => {
    expect(formatModified(new Date(2026, 9, 29, 9, 5).toISOString(), now, 'de-CH')).toBe('Heute, 09:05');
    expect(formatModified(new Date(2026, 9, 28, 23, 59).toISOString(), now, 'de-CH')).toBe('Gestern, 23:59');
    expect(formatModified(new Date(2026, 9, 29, 18, 21).toISOString(), now, 'en-US')).toBe('Today, 18:21');
    expect(formatModified(new Date(2026, 0, 2, 12, 0).toISOString(), now, 'de-CH')).toBe('02.01.2026');
    expect(formatModified(null, now)).toBe('');
  });
});

describe('uiLocale', () => {
  it('returns a valid locale', () => {
    expect(() => new Intl.DateTimeFormat(uiLocale())).not.toThrow();
  });
});
