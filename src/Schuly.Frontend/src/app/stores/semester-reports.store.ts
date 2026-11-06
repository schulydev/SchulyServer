import { inject } from '@angular/core';
import { signalStore } from '@ngrx/signals';
import { MySchoolDto, SchoolsService, SemesterReportDto, SemesterReportsService } from '../api';
import { withCollection } from './with-collection';

export const SemesterReportsStore = signalStore(
  withCollection<SemesterReportDto>(() => {
    const api = inject(SemesterReportsService);
    return () => api.apiSemesterReportsGet();
  }),
);

export const MySchoolsStore = signalStore(
  withCollection<MySchoolDto>(() => {
    const api = inject(SchoolsService);
    return () => api.apiSchoolsMySchoolsGet();
  }),
);
