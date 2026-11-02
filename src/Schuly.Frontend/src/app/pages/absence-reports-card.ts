import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUndo2 } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import {
  AbsenceReportsStore,
  ReportedAbsence,
  absenceErrorMessage,
} from '../stores/absence-reports.store';
import { AppDatePipe } from '../core/date-format';

@Component({
  selector: 'app-absence-reports-card',
  imports: [
    AppDatePipe,
    NgIcon,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadge,
    HlmButton,
    HlmCardImports,
    HlmSkeletonImports,
    HlmSpinner,
  ],
  providers: [provideIcons({ lucideUndo2 })],
  template: `
    @if (store.loading() && !store.reports().length) {
      <hlm-skeleton class="h-24 w-full" />
    } @else if (store.reports().length) {
      <section hlmCard aria-labelledby="absence-reports-title">
        <div hlmCardHeader>
          <h3 hlmCardTitle id="absence-reports-title">Waiting for your school</h3>
          <p hlmCardDescription>
            Reports your school has not processed yet. You can withdraw them until then.
          </p>
        </div>
        <div hlmCardContent class="flex flex-col gap-3">
          @if (error()) {
            <div hlmAlert variant="destructive" role="alert">
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }
          <ul class="divide-y rounded-lg border">
            @for (report of store.reports(); track key(report)) {
              <li
                class="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="font-medium tabular-nums">
                    {{ report.dateFrom | appDate: 'weekdayDate' }}
                    @if (report.dateTo !== report.dateFrom) {
                      to {{ report.dateTo | appDate: 'weekdayDate' }}
                    }
                    @if (report.hourFrom && report.hourTo) {
                      <span class="text-muted-foreground font-normal">
                        , {{ report.hourFrom }} - {{ report.hourTo }}
                      </span>
                    }
                  </span>
                  @if (report.reason) {
                    <span>{{ report.reason }}</span>
                  }
                  @if (report.comment) {
                    <span class="text-muted-foreground">{{ report.comment }}</span>
                  }
                  @if (report.profiles.length) {
                    <ul class="flex flex-wrap gap-1" aria-label="Classes">
                      @for (profile of report.profiles; track profile) {
                        <li>
                          <span hlmBadge variant="secondary">{{ profile }}</span>
                        </li>
                      }
                    </ul>
                  }
                </div>
                <hlm-alert-dialog>
                  <button
                    hlmAlertDialogTrigger
                    hlmBtn
                    variant="outline"
                    size="sm"
                    class="self-start"
                    [disabled]="withdrawing() !== null"
                    [attr.aria-busy]="withdrawing() === key(report)"
                  >
                    @if (withdrawing() === key(report)) {
                      <hlm-spinner aria-hidden="true" />
                    } @else {
                      <ng-icon name="lucideUndo2" aria-hidden="true" />
                    }
                    Withdraw
                    <span class="sr-only">report for {{ report.dateFrom | appDate: 'date' }}</span>
                  </button>
                  <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                    <hlm-alert-dialog-header>
                      <h2 hlmAlertDialogTitle>Withdraw this report?</h2>
                      <p hlmAlertDialogDescription>
                        Your school will no longer see this absence report. You can report it again
                        if you still need to.
                      </p>
                    </hlm-alert-dialog-header>
                    <hlm-alert-dialog-footer>
                      <button hlmAlertDialogCancel>Keep report</button>
                      <button
                        hlmAlertDialogAction
                        variant="destructive"
                        (click)="withdraw(report)"
                      >
                        Withdraw
                      </button>
                    </hlm-alert-dialog-footer>
                  </hlm-alert-dialog-content>
                </hlm-alert-dialog>
              </li>
            }
          </ul>
        </div>
      </section>
    }
  `,
})
export class AbsenceReportsCard {
  protected readonly store = inject(AbsenceReportsStore);
  protected readonly withdrawing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected key(report: ReportedAbsence): string {
    return report.accountId + report.ids.join(',');
  }

  protected async withdraw(report: ReportedAbsence): Promise<void> {
    this.error.set(null);
    this.withdrawing.set(this.key(report));
    try {
      await this.store.withdraw(report);
      toast.success('Report withdrawn.');
    } catch (error) {
      this.error.set(absenceErrorMessage(error, 'Could not withdraw the report. Try again.'));
    }
    await this.store.refresh();
    this.withdrawing.set(null);
  }
}
