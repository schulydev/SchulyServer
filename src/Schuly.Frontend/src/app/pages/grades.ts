import { DecimalPipe } from '@angular/common';
import { SyncingNotice } from '../shared/syncing-notice';
import { Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChartColumn, lucideSearch } from '@ng-icons/lucide';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { EmptyState } from '../shared/empty-state';
import { GradeBadge } from '../shared/grade-badge';
import { GradesStore } from '../stores/grades.store';
import { AppDatePipe } from '../core/date-format';

@Component({
  selector: 'app-grades',
  imports: [SyncingNotice, 
    HlmCardImports,
    HlmTableImports,
    HlmInputGroupImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    NgIcon,
    AppDatePipe,
    DecimalPipe,
    GradeBadge,
    EmptyState,
  ],
  providers: [provideIcons({ lucideSearch, lucideChartColumn })],
  template: `
    <div class="flex flex-col gap-4 p-4 md:gap-6 lg:p-6">
      <app-syncing-notice />
      <div class="grid grid-cols-2 gap-4 @3xl/main:grid-cols-4">
        <div hlmCard class="py-4">
          <div hlmCardHeader class="px-4">
            <p hlmCardDescription>Average</p>
            <h3 hlmCardTitle class="text-2xl tabular-nums">
              @if (grades.overallAverage(); as average) {
                {{ average | number: '1.2-2' }}
              } @else {
                -
              }
            </h3>
          </div>
        </div>
        <div hlmCard class="py-4">
          <div hlmCardHeader class="px-4">
            <p hlmCardDescription>Grades</p>
            <h3 hlmCardTitle class="text-2xl tabular-nums">{{ grades.grades().length }}</h3>
          </div>
        </div>
        <div hlmCard class="py-4">
          <div hlmCardHeader class="px-4">
            <p hlmCardDescription>Subjects</p>
            <h3 hlmCardTitle class="text-2xl tabular-nums">
              {{ grades.subjectAverages().length }}
            </h3>
          </div>
        </div>
        <div hlmCard class="py-4">
          <div hlmCardHeader class="px-4">
            <p hlmCardDescription>Below 4</p>
            <h3
              hlmCardTitle
              class="text-2xl tabular-nums"
              [class.text-destructive]="grades.insufficientCount()"
            >
              {{ grades.insufficientCount() }}
            </h3>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <hlm-input-group class="sm:max-w-xs">
          <input
            hlmInputGroupInput
            placeholder="Filter grades..."
            aria-label="Filter grades"
            [value]="grades.query()"
            (input)="grades.setQuery($any($event.target).value)"
          />
          <hlm-input-group-addon>
            <ng-icon name="lucideSearch" />
          </hlm-input-group-addon>
        </hlm-input-group>
        <hlm-native-select
          class="sm:w-56"
          [value]="grades.subject()"
          (valueChange)="grades.setSubject($event ?? 'all')"
          aria-label="Subject"
        >
          <option hlmNativeSelectOption value="all">All subjects</option>
          @for (subject of grades.subjectAverages(); track subject.subject) {
            <option hlmNativeSelectOption [value]="subject.subject">{{ subject.subject }}</option>
          }
        </hlm-native-select>
      </div>

      @if (grades.loading()) {
        <div class="flex flex-col gap-2">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <hlm-skeleton class="h-10 w-full" />
          }
        </div>
      } @else if (grades.grades().length) {
        <div class="overflow-hidden rounded-lg border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted">
                <tr hlmTr>
                  <th hlmTh>Exam</th>
                  <th hlmTh>Subject</th>
                  <th hlmTh class="hidden md:table-cell">Date</th>
                  <th hlmTh class="hidden text-right sm:table-cell">Weight</th>
                  <th hlmTh class="hidden text-right lg:table-cell">Class average</th>
                  <th hlmTh class="text-right">Grade</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (grade of grades.filteredGrades(); track grade.id) {
                  <tr hlmTr>
                    <td hlmTd class="font-medium">{{ grade.exam }}</td>
                    <td hlmTd class="text-muted-foreground">{{ grade.subject }}</td>
                    <td hlmTd class="text-muted-foreground hidden md:table-cell">
                      {{ grade.date | appDate: 'date' }}
                    </td>
                    <td hlmTd class="hidden text-right tabular-nums sm:table-cell">
                      {{ grade.weighting | number: '1.0-2' }}
                    </td>
                    <td
                      hlmTd
                      class="text-muted-foreground hidden text-right tabular-nums lg:table-cell"
                    >
                      {{ grade.classAverage ? (grade.classAverage | number: '1.2-2') : '-' }}
                    </td>
                    <td hlmTd class="text-right"><app-grade-badge [score]="grade.score" /></td>
                  </tr>
                } @empty {
                  <tr hlmTr>
                    <td hlmTd colspan="6" class="text-muted-foreground h-24 text-center">
                      No results.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <app-empty-state
          icon="lucideChartColumn"
          title="No grades yet"
          description="Grades show up here once your school publishes them."
        />
      }
    </div>
  `,
})
export class Grades {
  protected readonly grades = inject(GradesStore);
}
