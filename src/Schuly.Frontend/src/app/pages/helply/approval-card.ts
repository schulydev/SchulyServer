import { Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideShieldQuestion, lucideTriangleAlert, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApprovalRequest } from '../../core/helply-types';

/** Asks the user to approve or deny a write action Helply wants to take. Takes focus when it appears. */
@Component({
  selector: 'app-approval-card',
  imports: [HlmButton, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideShieldQuestion, lucideTriangleAlert, lucideX })],
  host: {
    role: 'group',
    tabindex: '-1',
    '[attr.aria-label]': '"Approval needed: " + approval().toolLabel',
    class:
      'bg-card text-card-foreground focus-visible:ring-ring/50 flex flex-col gap-3 rounded-xl border p-4 text-sm outline-none focus-visible:ring-3',
    '[class.border-destructive]': 'approval().destructive',
  },
  template: `
    <div class="flex items-start gap-2">
      <ng-icon
        [name]="approval().destructive ? 'lucideTriangleAlert' : 'lucideShieldQuestion'"
        aria-hidden="true"
        class="mt-0.5 shrink-0 text-base"
        [class.text-destructive]="approval().destructive"
      />
      <div class="min-w-0">
        <p class="font-medium" [class.text-destructive]="approval().destructive">
          {{ approval().toolLabel }}
          @if (approval().destructive) {
            <span class="font-normal"> (cannot be undone)</span>
          }
        </p>
        <p class="text-foreground/90 break-words">{{ approval().summary }}</p>
      </div>
    </div>
    @if (approval().details.length) {
      <dl class="bg-muted/50 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg p-3 text-xs">
        @for (detail of approval().details; track $index) {
          <dt class="text-muted-foreground">{{ detail.label }}</dt>
          <dd class="min-w-0 break-words whitespace-pre-wrap">{{ detail.value }}</dd>
        }
      </dl>
    }
    @if (decision() === undefined) {
      <div class="flex flex-wrap gap-2">
        <button
          hlmBtn
          type="button"
          [variant]="approval().destructive ? 'destructive' : 'default'"
          size="sm"
          [disabled]="busy()"
          (click)="decide.emit(true)"
        >
          <ng-icon name="lucideCheck" aria-hidden="true" />
          Approve
        </button>
        <button hlmBtn type="button" variant="outline" size="sm" [disabled]="busy()" (click)="decide.emit(false)">
          <ng-icon name="lucideX" aria-hidden="true" />
          Deny
        </button>
      </div>
    } @else {
      <p class="text-muted-foreground text-xs">{{ decision() ? 'Approved' : 'Denied' }}. Waiting for your other answers.</p>
    }
  `,
})
export class ApprovalCard {
  readonly approval = input.required<ApprovalRequest>();
  /** The answer already given, while other cards on the same turn are still open. */
  readonly decision = input<boolean | undefined>(undefined);
  readonly busy = input(false);
  readonly decide = output<boolean>();

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => element.focus({ preventScroll: false }));
  }
}
