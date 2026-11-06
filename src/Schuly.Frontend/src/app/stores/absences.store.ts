import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { AbsenceDto, AbsencesService, AbsenceType } from '../api';
import { dayOf, daysMissed, todayInSwitzerland } from '../core/absence-view';
import { withCollection } from './with-collection';

export type AbsenceFilter = 'all' | AbsenceType;

export const AbsencesStore = signalStore(
  withCollection<AbsenceDto>(() => {
    const api = inject(AbsencesService);
    return () => api.apiAbsencesGet();
  }),
  withState<{ filter: AbsenceFilter }>({ filter: 'all' }),
  withComputed((store) => {
    const sorted = computed(() => [...store.items()].sort((a, b) => b.from.localeCompare(a.from)));
    return {
      sorted,
      visible: computed(() => sorted().filter((a) => store.filter() === 'all' || a.type === store.filter())),
      absenceCount: computed(() => store.items().filter((a) => a.type === 'Absence').length),
      delayCount: computed(() => store.items().filter((a) => a.type === 'Delay').length),
      daysMissed: computed(() =>
        daysMissed(
          store.items().map((a) => ({ isDelay: a.type === 'Delay', from: dayOf(a.from), until: dayOf(a.until) })),
          todayInSwitzerland(),
        ),
      ),
    };
  }),
  withMethods((store) => ({
    setFilter(filter: AbsenceFilter): void {
      patchState(store, { filter });
    },
  })),
);
