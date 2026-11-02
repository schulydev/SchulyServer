import { formatWhen, uiLocale } from '../../core/date-format';

const german = () => uiLocale().toLowerCase().startsWith('de');

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago", "yesterday", or "Never" when there is no date. */
export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return german() ? 'Nie' : 'Never';
  const relative = new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'auto' });
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return german() ? 'gerade eben' : 'just now';
}

export const formatDate = (value: string): string => formatWhen(value, 'date');
export const formatDateTime = (value: string): string => formatWhen(value, 'dayMonthTime');
