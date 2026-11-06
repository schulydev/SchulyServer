import { Injectable, Injector } from '@angular/core';
import { AbsenceReportsStore } from './absence-reports.store';

type ReportsStore = InstanceType<typeof AbsenceReportsStore>;

/**
 * The Overview's copy of the reported absences, made the first time it's needed and kept for the session,
 * so going back to the Overview doesn't ask Schulnetz again. The Absences page keeps its own, always fresh one.
 */
@Injectable({ providedIn: 'root' })
export class ReportedAbsencesCache {
  private store: ReportsStore | null = null;

  /** `parent` must reach the app layout's stores (linked accounts, absences); the store loads itself once created. */
  open(parent: Injector): ReportsStore {
    this.store ??= Injector.create({ providers: [AbsenceReportsStore], parent }).get(AbsenceReportsStore);
    return this.store;
  }
}
