import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, untracked } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { catchError, forkJoin, map, of, pipe, switchMap, tap } from 'rxjs';
import { AgendaEntryDto, AgendaEntryType } from '../api';
import {
  CalendarItem,
  CalendarSource,
  CalendarView,
  addDays,
  addMonths,
  dateOnly,
  filterItems,
  overlapsDay,
  parseDate,
  startOfDay,
  visibleRange,
} from '../core/calendar';
import { userIdFromToken } from '../core/browser-cache';
import { AgendaStore } from './agenda.store';
import { AuthStore } from './auth.store';
import { GradesStore } from './grades.store';
import { DataRefresh } from './data-refresh';
import { LinkedAccountsStore } from './linked-accounts.store';

/** One linked account in a calendar capability's feed (`GET <basePath>?start&end`). */
export interface FeedAccount {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  message: string | null;
}

export interface FeedEvent {
  id: string;
  accountId: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  organizer: string | null;
  preview: string | null;
  webLink: string | null;
  joinUrl: string | null;
  showAs: string | null;
  isCancelled: boolean;
}

interface Feed {
  accounts: FeedAccount[];
  events: FeedEvent[];
}

const HIDDEN_KEY = 'schuly-calendar-hidden';
/** Lessons repeat every week, so the month starts without them. */
const DEFAULT_HIDDEN = ['lessons'];
const hiddenKey = (userId: string | null) => (userId ? `${HIDDEN_KEY}:${userId}` : HIDDEN_KEY);
const VIEW_KEY = 'schuly-calendar-view';

const SCHULY_SOURCES: CalendarSource[] = [
  { id: 'tests', label: 'Tests', detail: 'Schuly', color: 'var(--cal-test)', problem: null },
  { id: 'events', label: 'Events', detail: 'Schuly', color: 'var(--cal-event)', problem: null },
  { id: 'holidays', label: 'Holidays', detail: 'Schuly', color: 'var(--cal-holiday)', problem: null },
  { id: 'lessons', label: 'Lessons', detail: 'Schuly', color: 'var(--cal-lesson)', problem: null },
];

const ACCOUNT_COLORS = [
  'oklch(0.6 0.19 255)',
  'oklch(0.6 0.21 300)',
  'oklch(0.62 0.15 195)',
  'oklch(0.63 0.21 350)',
  'oklch(0.64 0.16 140)',
];

const DEFAULT_DURATION = 45 * 60_000;

const AGENDA_SOURCE: Record<AgendaEntryType, string> = {
  Lesson: 'lessons',
  Test: 'tests',
  Event: 'events',
  Holiday: 'holidays',
};

interface CalendarState {
  view: CalendarView;
  anchor: Date;
  selectedDay: Date;
  selectedId: string | null;
  hidden: string[];
  hiddenKey: string;
  accounts: FeedAccount[];
  feedEvents: FeedEvent[];
  feedLoading: boolean;
  feedAvailable: boolean;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function fromAgenda(entry: AgendaEntryDto): CalendarItem {
  const startDay = dateOnly(entry.date);
  const endDay = entry.endDate ? dateOnly(entry.endDate) : startDay;
  const allDay = startDay !== null && endDay !== null;
  const start = allDay ? startDay : new Date(entry.date);
  const end = allDay
    ? addDays(endDay, 1)
    : entry.endDate
      ? new Date(entry.endDate)
      : new Date(start.getTime() + DEFAULT_DURATION);
  return {
    id: `agenda:${entry.id ?? entry.date + entry.title}`,
    sourceId: AGENDA_SOURCE[entry.entryType],
    title: entry.title,
    start,
    end: end > start ? end : new Date(start.getTime() + DEFAULT_DURATION),
    allDay,
    location: entry.place ?? null,
    description: entry.description ?? null,
    organizer: null,
    joinUrl: null,
    webLink: null,
    cancelled: false,
  };
}

function fromFeed(event: FeedEvent): CalendarItem {
  return {
    id: `acct:${event.accountId}:${event.id}:${event.start}`,
    sourceId: `acct:${event.accountId}`,
    title: event.title,
    start: parseDate(event.start, event.isAllDay ?? false),
    end: parseDate(event.end, event.isAllDay ?? false),
    allDay: event.isAllDay ?? false,
    location: event.location ?? null,
    description: event.preview ?? null,
    organizer: event.organizer ?? null,
    joinUrl: event.joinUrl ?? null,
    webLink: event.webLink ?? null,
    cancelled: event.isCancelled ?? false,
  };
}

function accountProblem(account: FeedAccount): string | null {
  if (account.status === 'reconnect')
    return 'Sign-in expired. Re-authenticate this account in Settings > Schools & accounts.';
  if (account.status === 'unavailable')
    return account.message ?? 'This account is not answering right now.';
  return null;
}

export const CalendarStore = signalStore(
  withState<CalendarState>(() => {
    // The filter is kept per user, so a shared browser doesn't carry one person's choice to the next.
    const key = hiddenKey(userIdFromToken(inject(AuthStore).accessToken()));
    return {
    view: readStored<CalendarView>(VIEW_KEY, 'month'),
    anchor: startOfDay(new Date()),
    selectedDay: startOfDay(new Date()),
    selectedId: null,
    hidden: readStored<string[]>(key, DEFAULT_HIDDEN),
    hiddenKey: key,
    accounts: [],
    feedEvents: [],
    feedLoading: false,
    feedAvailable: true,
    };
  }),
  withComputed((state, agenda = inject(AgendaStore), grades = inject(GradesStore)) => {
    const range = computed(() => visibleRange(state.view(), state.anchor()));

    const sources = computed<CalendarSource[]>(() => [
      ...SCHULY_SOURCES,
      ...state.accounts().map((account, i) => ({
        id: `acct:${account.id}`,
        label: account.email,
        detail: account.displayName ? `${account.displayName} (${account.email})` : account.email,
        color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
        problem: accountProblem(account),
      })),
    ]);

    const allItems = computed<CalendarItem[]>(() => {
      const exams: CalendarItem[] = grades
        .items()
        .filter((exam) => exam.date)
        .map((exam) => {
          const day = dateOnly(exam.date!);
          const start = day ?? new Date(exam.date!);
          return {
            id: `exam:${exam.id ?? exam.name}`,
            sourceId: 'tests',
            title: exam.name,
            start,
            end: day ? addDays(day, 1) : new Date(start.getTime() + DEFAULT_DURATION),
            allDay: day !== null,
            location: null,
            description: exam.description ?? null,
            organizer: null,
            joinUrl: null,
            webLink: null,
            cancelled: false,
          };
        });
      return [
        ...agenda.items().map(fromAgenda),
        ...exams,
        ...state.feedEvents().map(fromFeed),
      ].sort((a, b) => a.start.getTime() - b.start.getTime());
    });

    const inRange = computed(() => {
      const { start, end } = range();
      return allItems().filter((item) => item.start < end && item.end >= start);
    });
    const visibleItems = computed(() => filterItems(inRange(), state.hidden()));
    // The week and the day panel always show lessons: a school day without them would read as a free day.
    const itemsWithLessons = computed(() => filterItems(inRange(), state.hidden(), true));
    const allWithLessons = computed(() => filterItems(allItems(), state.hidden(), true));

    const colors = computed(() => new Map(sources().map((source) => [source.id, source.color])));

    return {
      range,
      sources,
      visibleItems,
      itemsWithLessons,
      colors,
      loading: computed(() => agenda.loading() || grades.loading() || state.feedLoading()),
      selected: computed(() => allItems().find((item) => item.id === state.selectedId()) ?? null),
      selectedDayItems: computed(() => allWithLessons().filter((item) => overlapsDay(item, state.selectedDay()))),
      selectedDayAll: computed(() => allItems().filter((item) => overlapsDay(item, state.selectedDay()))),
      problems: computed(() => sources().filter((source) => source.problem)),
    };
  }),
  withMethods((state, http = inject(HttpClient), linked = inject(LinkedAccountsStore)) => {
    const move = (direction: 1 | -1) => {
      const anchor = state.anchor();
      const view = state.view();
      const next =
        view === 'month'
          ? addMonths(anchor, direction)
          : addDays(anchor, direction * (view === 'week' ? 7 : 28));
      patchState(state, { anchor: next, selectedDay: next });
    };

    return {
      setView(view: CalendarView): void {
        patchState(state, { view, anchor: state.selectedDay() });
        store(VIEW_KEY, view);
      },
      previous: () => move(-1),
      next: () => move(1),
      today(): void {
        const today = startOfDay(new Date());
        patchState(state, { anchor: today, selectedDay: today });
      },
      selectDay(day: Date): void {
        patchState(state, { selectedDay: startOfDay(day) });
      },
      openDay(day: Date): void {
        patchState(state, { selectedDay: startOfDay(day), anchor: startOfDay(day), view: 'week' });
        store(VIEW_KEY, 'week');
      },
      select(id: string | null): void {
        patchState(state, { selectedId: id });
      },
      toggleSource(id: string): void {
        const hidden = state.hidden().includes(id)
          ? state.hidden().filter((h) => h !== id)
          : [...state.hidden(), id];
        patchState(state, { hidden });
        store(state.hiddenKey(), hidden);
      },
      loadFeeds: rxMethod<{ start: Date; end: Date; paths: string[] }>(
        pipe(
          tap(() => patchState(state, { feedLoading: true })),
          switchMap(({ start, end, paths }) => {
            if (!paths.length) return of(null).pipe(tap(() => patchState(state, { accounts: [], feedEvents: [], feedLoading: false })));
            const params = { start: start.toISOString(), end: end.toISOString() };
            const feeds = paths.map((path) =>
              http.get<Feed>(path, { params }).pipe(
                map((feed) => ({ feed, missing: false })),
                catchError((error: unknown) =>
                  of({ feed: { accounts: [], events: [] } as Feed, missing: error instanceof HttpErrorResponse && error.status === 404 }),
                ),
              ),
            );
            return forkJoin(feeds).pipe(
              tap((results) =>
                patchState(state, {
                  accounts: results.flatMap((r) => r.feed.accounts ?? []),
                  feedEvents: results.flatMap((r) => r.feed.events ?? []),
                  feedLoading: false,
                  feedAvailable: !results.every((r) => r.missing),
                }),
              ),
            );
          }),
        ),
      ),
      feedPaths: () => [...new Set(linked.capabilityAccounts().calendar.map((a) => a.basePath))],
    };
  }),
  withHooks({
    onInit(state) {
      const refresh = inject(DataRefresh, { optional: true });
      // The feed lives at each calendar capability's basePath; it reloads when the range, the linked accounts or the data revision change.
      effect(() => {
        const range = state.range();
        refresh?.revision();
        const paths = state.feedPaths();
        untracked(() => state.loadFeeds({ ...range, paths }));
      });
    },
  }),
);
