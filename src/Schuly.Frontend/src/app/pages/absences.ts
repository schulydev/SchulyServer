import { Component, computed, inject, signal } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideUserX } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { absenceAnswer, absenceMonths, absenceSemesters, buildAbsenceRows, daysMissed, lessonsMissed, semesterKeyOf, todayInSwitzerland } from '../core/absence-view';
import { isBbbWebsite } from '../core/grade-report';
import { EmptyState } from '../shared/empty-state';
import { SyncingNotice } from '../shared/syncing-notice';
import { AbsenceReportsStore, ReportedAbsence, absenceErrorMessage } from '../stores/absence-reports.store';
import { AbsenceFilter, AbsencesStore } from '../stores/absences.store';
import { MySchoolsStore, SemesterReportsStore } from '../stores/semester-reports.store';
import { AbsenceReportDialog } from './absence-report-dialog';
import { AbsenceRowItem } from './absence-row';

@Component({
  selector: 'app-absences',
  imports: [SyncingNotice, HlmAlertImports, HlmSelectImports, HlmSkeletonImports, HlmToggleGroupImports, EmptyState, AbsenceReportDialog, AbsenceRowItem],
  providers: [provideIcons({ lucideUserX }), AbsenceReportsStore],
  template: `
    <div class="flex flex-col gap-5 p-4 md:gap-6 lg:p-6">
      <app-syncing-notice />
      <h1 class="sr-only">Absences</h1>

      @if (absences.loading() && !allRows().length) {
        <div class="flex flex-col gap-2">
          @for (i of [1, 2, 3, 4]; track i) {
            <hlm-skeleton class="h-10 w-full" />
          }
        </div>
      } @else if (!allRows().length) {
        <div class="flex justify-end">
          @if (reports.available()) {
            <app-absence-report-dialog />
          }
        </div>
        <app-empty-state icon="lucideUserX" title="No absences" description="Absences and delays recorded by your school show up here." />
      } @else {
        <section class="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-b pb-6" aria-label="Summary">
          <div class="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
            <p class="text-muted-foreground text-[13px]">{{ semesterLabel(semesterKey()) }}</p>
            <h2 class="text-3xl leading-tight font-semibold tracking-tight text-balance" [class.text-destructive]="answer().tone === 'bad'">{{ answer().text }}</h2>
            <p class="text-muted-foreground max-w-prose text-sm">{{ answer().hint }}</p>
          </div>
          <div class="flex flex-col items-start gap-5 sm:items-end">
            <div class="flex flex-wrap items-center gap-2">
              <label class="sr-only" for="absences-semester">Semester</label>
              <hlm-select class="w-56" [value]="semesterKey()" [itemToString]="semesterLabel" (valueChange)="selected.set($event ?? null)">
                <hlm-select-trigger buttonId="absences-semester" class="w-full">
                  <hlm-select-value />
                </hlm-select-trigger>
                <hlm-select-content *hlmSelectPortal>
                  <hlm-select-group>
                    @for (semester of semesters(); track semester.key) {
                      <hlm-select-item [value]="semester.key">{{ semester.label }}</hlm-select-item>
                    }
                  </hlm-select-group>
                </hlm-select-content>
              </hlm-select>
              @if (reports.available()) {
                <app-absence-report-dialog />
              }
            </div>
            <dl class="flex gap-7">
              <div>
                <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ days() }}</dd>
                <dt class="text-muted-foreground text-[13px]">Days missed</dt>
              </div>
              <div>
                <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ delays() }}</dd>
                <dt class="text-muted-foreground text-[13px]">Delays</dt>
              </div>
              <div>
                <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ lessons() ?? '–' }}</dd>
                <dt class="text-muted-foreground text-[13px]">Lessons</dt>
              </div>
            </dl>
          </div>
        </section>

        <hlm-toggle-group type="single" variant="outline" size="sm" [nullable]="false" [value]="absences.filter()" (valueChange)="setFilter($event)" aria-label="Filter absences" class="self-start">
          <button hlmToggleGroupItem value="all" class="px-3">All</button>
          <button hlmToggleGroupItem value="Absence" class="px-3">Absences</button>
          <button hlmToggleGroupItem value="Delay" class="px-3">Delays</button>
        </hlm-toggle-group>

        @if (error()) {
          <div hlmAlert variant="destructive" role="alert">
            <p hlmAlertDescription>{{ error() }}</p>
          </div>
        }

        <div>
          @for (month of months(); track month.key; let first = $first) {
            <h3 class="text-muted-foreground px-1.5 pb-1 text-xs font-semibold" [class.pt-5]="!first">{{ month.label }}</h3>
            <div class="flex flex-col divide-y border-b">
              @for (row of month.rows; track row.key) {
                <app-absence-row [row]="row" [busy]="withdrawing() !== null" [withdrawing]="withdrawing() === row.key" (withdraw)="withdraw(row.key, $event)" />
              }
            </div>
          } @empty {
            <p class="text-muted-foreground px-1.5 py-7 text-sm">Nothing here for this semester.</p>
          }
        </div>
      }
    </div>
  `,
})
export class Absences {
  protected readonly absences = inject(AbsencesStore);
  protected readonly reports = inject(AbsenceReportsStore);
  private readonly semesterReports = inject(SemesterReportsStore);
  private readonly schools = inject(MySchoolsStore);

  private readonly today = todayInSwitzerland();
  protected readonly withdrawing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly allRows = computed(() => {
    const schools = this.schools.items();
    const bbb = new Set(schools.filter((s) => isBbbWebsite(s.website)).map((s) => s.id));
    // A report doesn't say which school it's from, so it only follows BBB's rules when that is the only school.
    const onlyBbb = schools.length > 0 && bbb.size === schools.length;
    const isBbb = (schoolId: string | null): boolean => (schoolId ? bbb.has(schoolId) : onlyBbb);
    const website = (schoolId: string | null): string | null => (schoolId ? schools.find((s) => s.id === schoolId) : schools[0])?.website ?? null;
    return buildAbsenceRows<ReportedAbsence>(this.absences.items(), this.reports.reports(), { today: this.today, isBbb, website });
  });
  protected readonly semesters = computed(() => absenceSemesters(this.allRows(), this.semesterReports.items(), this.today));
  protected readonly selected = signal<string | null>(semesterKeyOf(this.today));
  protected readonly semesterKey = computed(() => {
    const key = this.selected();
    return this.semesters().some((s) => s.key === key) ? key : (this.semesters()[0]?.key ?? null);
  });
  protected readonly semesterLabel = (key: string | null): string => this.semesters().find((s) => s.key === key)?.label ?? '';

  private readonly semesterRows = computed(() => this.allRows().filter((row) => semesterKeyOf(row.from) === this.semesterKey()));
  protected readonly answer = computed(() => absenceAnswer(this.semesterRows()));
  protected readonly days = computed(() => daysMissed(this.semesterRows(), this.today));
  protected readonly delays = computed(() => this.semesterRows().filter((row) => row.isDelay).length);
  protected readonly lessons = computed(() => lessonsMissed(this.semesterRows(), this.semesterReports.items().filter((r) => `${r.schoolYearStart}-${r.semesterHalf}` === this.semesterKey())));
  protected readonly months = computed(() => {
    const filter = this.absences.filter();
    return absenceMonths(this.semesterRows().filter((row) => filter === 'all' || (filter === 'Delay') === row.isDelay));
  });

  protected setFilter(value: unknown): void {
    if (typeof value === 'string') this.absences.setFilter(value as AbsenceFilter);
  }

  protected async withdraw(key: string, report: ReportedAbsence): Promise<void> {
    this.error.set(null);
    this.withdrawing.set(key);
    try {
      await this.reports.withdraw(report);
      toast.success('Report withdrawn.');
    } catch (error) {
      this.error.set(absenceErrorMessage(error, 'Could not withdraw the report. Try again.'));
    }
    await this.reports.refresh();
    this.withdrawing.set(null);
  }
}
