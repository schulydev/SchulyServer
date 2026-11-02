import { Pipe, PipeTransform } from '@angular/core';

export const FALLBACK_LOCALE = 'de-CH';

/** The browser's locale when it has one, else de-CH. */
export function uiLocale(): string {
  const language = typeof navigator === 'undefined' ? '' : (navigator.languages?.[0] ?? navigator.language ?? '');
  try {
    return language ? Intl.getCanonicalLocales(language)[0] : FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

/** Every format is 24-hour; "h23" also keeps midnight at 00:xx rather than 24:xx. */
const TIME = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
const DATE = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;

export const DATE_PRESETS = {
  /** 31.10.2026 */
  date: DATE,
  /** 31. Okt. */
  dayMonth: { day: 'numeric', month: 'short' },
  /** 31. Oktober */
  dayMonthLong: { day: 'numeric', month: 'long' },
  /** Fr, 31.10.2026 */
  weekdayDate: { weekday: 'short', ...DATE },
  /** Freitag, 31. Oktober */
  weekdayDayMonthLong: { weekday: 'long', day: 'numeric', month: 'long' },
  /** Freitag, 31. Oktober 2026 */
  weekdayDateLong: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  /** Fr, 31. Okt. */
  weekdayDayMonth: { weekday: 'short', day: 'numeric', month: 'short' },
  weekday: { weekday: 'short' },
  weekdayLong: { weekday: 'long' },
  month: { month: 'short' },
  monthLong: { month: 'long' },
  monthYearLong: { month: 'long', year: 'numeric' },
  day: { day: 'numeric' },
  /** 14:03 */
  time: TIME,
  /** 31.10.2026, 14:03 */
  dateTime: { ...DATE, ...TIME },
  /** Fr, 31.10.2026, 14:03 */
  weekdayDateTime: { weekday: 'short', ...DATE, ...TIME },
  /** Fr, 31. Okt., 14:03 */
  weekdayDayMonthTime: { weekday: 'short', day: 'numeric', month: 'short', ...TIME },
  /** Freitag, 14:03 */
  weekdayLongTime: { weekday: 'long', ...TIME },
  /** 31. Okt., 14:03 */
  dayMonthTime: { day: 'numeric', month: 'short', ...TIME },
  /** Freitag, 31. Oktober 2026 (screen readers) */
  full: { dateStyle: 'full' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DatePreset = keyof typeof DATE_PRESETS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(preset: DatePreset, locale: string): Intl.DateTimeFormat {
  const key = `${locale}|${preset}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, DATE_PRESETS[preset]);
    formatters.set(key, found);
  }
  return found;
}

/** Formats a date for the UI; an empty or unparseable value gives an empty string. */
export function formatWhen(value: string | number | Date | null | undefined, preset: DatePreset, locale: string = uiLocale()): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatterFor(preset, locale).format(date);
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Heute"/"Gestern" in German locales, "Today"/"Yesterday" otherwise; null for any other day. */
export function relativeDayLabel(value: string | number | Date | null | undefined, now: Date = new Date(), locale: string = uiLocale()): string | null {
  if (value === null || value === undefined || value === '') return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  const german = locale.toLowerCase().startsWith('de');
  if (days === 0) return german ? 'Heute' : 'Today';
  if (days === 1) return german ? 'Gestern' : 'Yesterday';
  return null;
}

/** "Heute, 14:03", "Gestern, 09:12", else the full date (31.10.2026). */
export function formatModified(value: string | null | undefined, now: Date = new Date(), locale: string = uiLocale()): string {
  const label = relativeDayLabel(value, now, locale);
  if (label) return `${label}, ${formatWhen(value, 'time', locale)}`;
  return formatWhen(value, 'date', locale);
}

/** `{{ value | appDate: 'weekdayDate' }}`: the shared formatter in templates. */
@Pipe({ name: 'appDate' })
export class AppDatePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined, preset: DatePreset): string {
    return formatWhen(value, preset);
  }
}
