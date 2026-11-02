import { Component, ElementRef, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideChevronDown, lucideChevronRight, lucideShieldQuestion, lucideTriangleAlert, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApprovalRequest } from '../../core/helply-types';

let nextId = 0;

/** Asks the user to approve or deny a write action Helply wants to take. Takes focus when it appears. */
@Component({
  selector: 'app-approval-card',
  imports: [HlmButton, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideChevronDown, lucideChevronRight, lucideShieldQuestion, lucideTriangleAlert, lucideX })],
  host: {
    role: 'group',
    tabindex: '-1',
    '[attr.aria-label]': '"Approval needed: " + approval().toolLabel',
    class:
      'bg-card text-card-foreground focus-visible:ring-ring/50 flex flex-col gap-3 rounded-xl border p-4 text-sm outline-none focus-visible:ring-3',
    '[class.border-destructive]': 'danger()',
  },
  template: `
    <div class="flex items-start gap-2">
      <ng-icon
        [name]="danger() ? 'lucideTriangleAlert' : 'lucideShieldQuestion'"
        aria-hidden="true"
        class="mt-0.5 shrink-0 text-base"
        [class.text-destructive]="danger()"
      />
      <div class="min-w-0">
        <p class="font-medium" [class.text-destructive]="danger()">
          {{ approval().toolLabel }}
          @if (approval().destructive) {
            <span class="font-normal"> (cannot be undone)</span>
          }
        </p>
        <p class="text-foreground/90 break-words">{{ approval().summary }}</p>
      </div>
    </div>
    @if (approval().risk === 'high' && approval().riskReasons.length) {
      <div class="border-destructive/50 bg-destructive/10 text-foreground flex gap-2 rounded-lg border p-3 text-xs" role="note">
        <ng-icon name="lucideTriangleAlert" aria-hidden="true" class="text-destructive mt-0.5 shrink-0 text-base" />
        <div class="min-w-0">
          <p class="text-destructive font-medium">High risk</p>
          <ul class="list-disc pl-4">
            @for (reason of approval().riskReasons; track $index) {
              <li class="break-words">{{ reason }}</li>
            }
          </ul>
        </div>
      </div>
    }
    @if (approval().details.length) {
      <dl class="bg-muted/50 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg p-3 text-xs">
        @for (detail of approval().details; track $index) {
          <dt class="text-muted-foreground">{{ detail.label }}</dt>
          <dd class="min-w-0 break-words whitespace-pre-wrap">{{ detail.value }}</dd>
        }
      </dl>
    }
    @if (approval().arguments.length) {
      <div>
        <button
          type="button"
          class="text-foreground hover:bg-muted focus-visible:ring-ring/50 -ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium outline-none focus-visible:ring-3"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="panelId"
          (click)="expanded.set(!expanded())"
        >
          <ng-icon [name]="expanded() ? 'lucideChevronDown' : 'lucideChevronRight'" aria-hidden="true" />
          {{ expanded() ? 'Hide' : 'Show' }} everything that will be sent
        </button>
        @if (expanded()) {
          <dl [id]="panelId" class="bg-muted/50 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-lg p-3 text-xs">
            @for (argument of approval().arguments; track $index) {
              <dt class="text-muted-foreground">{{ argument.label }}</dt>
              <dd class="min-w-0 break-words whitespace-pre-wrap">{{ argument.value }}</dd>
            }
          </dl>
        }
      </div>
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
  /** Destructive or flagged high risk: the card is drawn as a warning. */
  protected readonly danger = computed(() => this.approval().destructive || this.approval().risk === 'high');
  protected readonly expanded = signal(false);
  protected readonly panelId = `approval-args-${nextId++}`;
  readonly decide = output<boolean>();

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => element.focus({ preventScroll: false }));
  }
}
