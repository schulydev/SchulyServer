import { Component, computed, effect, inject, linkedSignal, model, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideInfo } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HelplyApi } from '../../core/helply-api';
import { mcpErrorMessage } from '../../core/mcp-api';
import { McpPermissionSet, readOnlyPreset, samePermissions } from '../../core/mcp-permissions';
import { McpPermissionEditor } from '../../shared/mcp-permission-editor';

/** Side sheet to choose what Helply may use. Reuses the MCP permission editor. */
@Component({
  selector: 'app-helply-settings-sheet',
  imports: [HlmAlertImports, HlmButton, HlmSheetImports, HlmSpinner, McpPermissionEditor, NgIcon],
  providers: [provideIcons({ lucideInfo })],
  template: `
    <hlm-sheet side="right" [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 sm:max-w-xl">
        <hlm-sheet-header class="border-b">
          <h2 hlmSheetTitle>Helply settings</h2>
          <p hlmSheetDescription>Choose what Helply may use. Changes apply to your next message.</p>
        </hlm-sheet-header>
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          <div hlmAlert>
            <ng-icon name="lucideInfo" aria-hidden="true" />
            <p hlmAlertDescription>
              Helply can only use what is allowed here. Actions that change something, like sending a mail, always ask
              for your approval in the chat first.
            </p>
          </div>
          @if (loading()) {
            <hlm-spinner aria-label="Loading settings" />
          } @else if (loaded()) {
            <app-mcp-permission-editor [(value)]="draft" />
          }
        </div>
        <hlm-sheet-footer class="border-t">
          <div aria-live="polite" role="status" class="w-full">
            @if (error()) {
              <div hlmAlert variant="destructive"><p hlmAlertDescription>{{ error() }}</p></div>
            } @else if (saved()) {
              <p class="text-muted-foreground text-sm">Settings saved.</p>
            }
          </div>
          <div class="flex justify-end gap-2">
            <button hlmBtn variant="outline" type="button" (click)="open.set(false)">Close</button>
            <button hlmBtn type="button" [disabled]="!changed() || saving()" (click)="save()">
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
export class HelplySettingsSheet {
  private readonly api = inject(HelplyApi);

  readonly open = model(false);

  private readonly initial = signal<McpPermissionSet | null>(null);
  protected readonly draft = linkedSignal<McpPermissionSet>(() => this.initial() ?? readOnlyPreset());
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loaded = computed(() => this.initial() !== null);
  protected readonly changed = computed(() => {
    const initial = this.initial();
    return !!initial && !samePermissions(initial, this.draft());
  });

  constructor() {
    effect(() => {
      if (this.open()) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      this.initial.set((await this.api.settings()).permissions);
    } catch (error) {
      this.error.set(mcpErrorMessage(error, "Couldn't load Helply's settings."));
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      this.initial.set((await this.api.updatePermissions(this.draft())).permissions);
      this.saved.set(true);
    } catch (error) {
      this.error.set(mcpErrorMessage(error, "Couldn't save Helply's settings."));
    } finally {
      this.saving.set(false);
    }
  }
}
