import { t } from '../core/i18n';
import { AbsenceDto, AgendaEntryDto } from '../api';
import { AbsenceRow, dayOf } from './absence-view';

export interface AttentionItem {
  key: string;
  tone: 'bad' | 'warn';
  title: string;
  detail: string;
  when: string;
  link: string;
}

/** Tests this many days ahead count as something to prepare for. */
export const TEST_WINDOW_DAYS = 7;

const shortDate = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today", "tomorrow" or "in 4 days". */
export function daysUntil(date: Date, now: Date): string {
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  return t('overview.inDays', { count: Math.max(0, days) });
}

/**
 * Only what the student has to act on: an absence that still needs an excuse or was rejected, and tests in the next week.
 * Waiting, excused and upcoming absences aren't here; the Absences page shows them.
 */
export function attentionItems(absences: AbsenceRow[], agenda: AgendaEntryDto[], now: Date): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const row of absences) {
    if (row.state === 'needs-excuse') {
      const fine = row.bbb ? ` · ${t('overview.attention.fine')}` : '';
      items.push({ key: `absence|${row.key}`, tone: 'bad', title: t('overview.attention.needsExcuse', { date: shortDate(row.from) }), detail: `${row.reason}${fine}`, when: row.due ?? '', link: '/absences' });
    } else if (row.state === 'rejected') {
      items.push({ key: `absence|${row.key}`, tone: 'bad', title: t('overview.attention.rejected', { date: shortDate(row.from) }), detail: row.reason, when: '', link: '/absences' });
    }
  }
  const until = startOfDay(now) + (TEST_WINDOW_DAYS + 1) * 86_400_000;
  const tests = agenda
    .filter((e) => e.entryType === 'Test')
    .map((e) => ({ entry: e, at: new Date(e.date) }))
    .filter((t) => !Number.isNaN(t.at.getTime()) && t.at.getTime() >= now.getTime() && t.at.getTime() < until)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const { entry, at } of tests) {
    items.push({ key: `test|${entry.id ?? entry.date}`, tone: 'warn', title: t('overview.attention.test', { title: entry.title }), detail: entry.place || entry.description || '', when: daysUntil(at, now), link: '/grades' });
  }
  return items;
}

/**
 * Whether the reported absences are worth asking Schulnetz for: only a report can turn an unexcused absence into a waiting one,
 * so without a past, unexcused absence there is nothing a report would change on the Overview.
 */
export function needsReportLookup(absences: AbsenceDto[], today: string): boolean {
  return absences.some((a) => a.type !== 'Delay' && a.isExcused === false && dayOf(a.from) <= today);
}
