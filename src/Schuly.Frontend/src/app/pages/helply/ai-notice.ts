import { TranslatePipe } from '@ngx-translate/core';
import { Component, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { persistedChoice } from '../../core/persisted';
import { PRIVACY_POLICY_URL } from '../../core/privacy-notice';

const SEEN_KEY = 'schuly.helply.aiNoticeSeen';

/** Whether this browser has already shown the notice. */
export const aiNoticeSeen = () => persistedChoice(SEEN_KEY, ['no', 'yes'] as const, 'no');

/** Shown before the first use of Helply, so nobody takes it for a person or misses where their data goes. */
@Component({
  selector: 'app-helply-ai-notice',
  imports: [TranslatePipe, HlmButton, HlmCardImports],
  host: { class: 'flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4' },
  template: `
    <section hlmCard class="w-full max-w-lg" aria-labelledby="helply-ai-notice-title">
      <div hlmCardHeader>
        <h2 hlmCardTitle id="helply-ai-notice-title">{{ 'helply.notice.title' | translate }}</h2>
      </div>
      <div hlmCardContent class="flex flex-col gap-3 text-sm">
        <p>{{ 'helply.notice.description' | translate }}</p>
        <p>
          {{ 'helply.notice.data' | translate }}
        </p>
        <a class="underline underline-offset-4" [href]="policyUrl" target="_blank" rel="noopener">{{ 'auth.privacy.read' | translate }}</a>
      </div>
      <div hlmCardFooter>
        <button hlmBtn type="button" (click)="understood.emit()">{{ 'helply.notice.ok' | translate }}</button>
      </div>
    </section>
  `,
})
export class HelplyAiNotice {
  readonly understood = output<void>();
  protected readonly policyUrl = PRIVACY_POLICY_URL;
}
