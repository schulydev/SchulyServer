import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { AccountProblem as Problem, accountProblemText } from '../stores/account-resource';

@Component({
  selector: 'app-account-problem',
  imports: [TranslatePipe, HlmAlertImports, NgIcon],
  providers: [provideIcons({ lucideTriangleAlert })],
  template: `
    <div hlmAlert variant="destructive">
      <ng-icon name="lucideTriangleAlert" hlmAlertIcon />
      <h3 hlmAlertTitle>{{ text().title | translate }}</h3>
      <p hlmAlertDescription>{{ text().description | translate }}</p>
    </div>
  `,
})
export class AccountProblem {
  readonly problem = input.required<Problem>();
  protected readonly text = computed(() => accountProblemText[this.problem()]);
}
