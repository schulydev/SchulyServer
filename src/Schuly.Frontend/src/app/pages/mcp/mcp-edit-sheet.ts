import { Component, computed, input, linkedSignal, model, output } from '@angular/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { McpActivity } from '../../core/mcp-api';
import { McpPermissionSet, samePermissions, schoolDataPreset } from '../../core/mcp-permissions';
import { McpPermissionEditor } from '../../shared/mcp-permission-editor';
import { formatDateTime } from './format';

/** Side sheet to change what a connected app or API key may do, with its recent activity. */
@Component({
  selector: 'app-mcp-edit-sheet',
  imports: [HlmAlertImports, HlmBadge, HlmButton, HlmSheetImports, HlmSpinner, McpPermissionEditor],
  template: `
    <hlm-sheet side="right" [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 sm:max-w-xl">
        <hlm-sheet-header class="border-b">
          <h2 hlmSheetTitle>{{ name() }}</h2>
          <p hlmSheetDescription>Choose what this {{ kind() }} may do. Changes apply right away.</p>
        </hlm-sheet-header>
        <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <app-mcp-permission-editor [(value)]="draft" />

          <section class="flex flex-col gap-2" aria-labelledby="mcp-activity-title">
            <h3 id="mcp-activity-title" class="text-sm font-medium">Recent activity</h3>
            @if (activityLoading()) {
              <hlm-spinner aria-label="Loading activity" />
            } @else if (activity().length) {
              <ul class="divide-y rounded-lg border text-sm">
                @for (entry of activity(); track $index) {
                  <li class="flex items-center justify-between gap-2 px-3 py-2">
                    <span class="min-w-0 truncate font-mono text-xs">{{ entry.toolName }}</span>
                    <span class="flex shrink-0 items-center gap-2">
                      <time class="text-muted-foreground text-xs" [attr.datetime]="entry.at">{{ time(entry.at) }}</time>
                      <span hlmBadge [variant]="entry.allowed ? 'secondary' : 'destructive'">{{
                        entry.allowed ? 'Allowed' : 'Denied'
                      }}</span>
                    </span>
                  </li>
                }
              </ul>
              <p class="text-muted-foreground text-xs">Latest 100 calls from the last 30 days.</p>
            } @else {
              <p class="text-muted-foreground text-sm">No activity in the last 30 days.</p>
            }
          </section>
        </div>
        <hlm-sheet-footer class="border-t">
          <div aria-live="polite" role="status" class="w-full">
            @if (error()) {
              <div hlmAlert variant="destructive">
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
          </div>
          <div class="flex justify-end gap-2">
            <button hlmBtn variant="outline" type="button" (click)="open.set(false)">Close</button>
            <button hlmBtn type="button" [disabled]="!changed() || saving()" (click)="save.emit(draft())">
              @if (saving()) {
                <hlm-spinner aria-hidden="true" />
              }
              Save changes
            </button>
          </div>
        </hlm-sheet-footer>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class McpEditSheet {
  readonly open = model(false);
  readonly name = input.required<string>();
  readonly kind = input<'app' | 'API key'>('app');
  readonly initial = input<McpPermissionSet | null>(null);
  readonly activity = input<McpActivity[]>([]);
  readonly activityLoading = input(false);
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly save = output<McpPermissionSet>();

  protected readonly draft = linkedSignal<McpPermissionSet>(() => this.initial() ?? schoolDataPreset());
  protected readonly changed = computed(() => {
    const initial = this.initial();
    return !!initial && !samePermissions(initial, this.draft());
  });

  protected time(value: string): string {
    return formatDateTime(value);
  }
}
