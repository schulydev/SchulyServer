import { TranslatePipe } from '@ngx-translate/core';
import { Component, inject } from '@angular/core';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';

/** Shown on pages that depend on linked accounts while one of them is still syncing; announced politely and gone once the data arrived. */
@Component({
  selector: 'app-syncing-notice',
  imports: [TranslatePipe, HlmSpinner],
  template: `
    <div role="status" aria-live="polite" class="contents">
      @if (accounts.syncing()) {
        <p class="bg-muted text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm" data-testid="syncing-notice">
          <hlm-spinner aria-hidden="true" class="size-4" />
          {{ 'shared.syncing' | translate }}
        </p>
      }
    </div>
  `,
})
export class SyncingNotice {
  protected readonly accounts = inject(LinkedAccountsStore);
}
