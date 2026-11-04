import { Injectable, inject, signal } from '@angular/core';
import { swrCache } from '../core/swr-cache';
import { AbsencesStore } from './absences.store';
import { AgendaStore } from './agenda.store';
import { ClassesStore } from './classes.store';
import { DocumentsStore } from './documents.store';
import { GradesStore } from './grades.store';
import { MySchoolsStore, SemesterReportsStore } from './semester-reports.store';
import { UserStore } from './user.store';

/**
 * Everything derived from linked accounts. Each of these stores loads once when the app shell is created,
 * so after a school account is linked (or removed) nothing else would refetch it: the data only appeared after a page reload.
 * Linking and unlinking call this to reload them all; capability pages watch `revision`.
 */
@Injectable()
export class DataRefresh {
  private readonly user = inject(UserStore);
  private readonly classes = inject(ClassesStore);
  private readonly grades = inject(GradesStore);
  private readonly semesterReports = inject(SemesterReportsStore);
  private readonly mySchools = inject(MySchoolsStore);
  private readonly absences = inject(AbsencesStore);
  private readonly agenda = inject(AgendaStore);
  private readonly documents = inject(DocumentsStore);

  /** Bumped on every refresh so capability stores and the calendar feed reload too. */
  readonly revision = signal(0);

  /** Drops the loaded data at once (an account was unlinked), then reloads. */
  clearAndReload(): void {
    swrCache.clear();
    this.classes.clear();
    this.grades.clear();
    this.semesterReports.clear();
    this.mySchools.clear();
    this.absences.clear();
    this.agenda.clear();
    this.documents.clear();
    this.reloadAll();
  }

  reloadAll(): void {
    swrCache.clear();
    this.user.load();
    this.classes.load();
    this.grades.load();
    this.semesterReports.load();
    this.mySchools.load();
    this.absences.load();
    this.agenda.load();
    this.documents.load();
    this.revision.update((n) => n + 1);
  }
}
