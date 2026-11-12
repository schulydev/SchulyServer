import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, computed, effect, inject, linkedSignal, model, output, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideInfo } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { HelplyApi } from '../../core/helply-api';
import { HelplyReasoningEffort, HelplySettings } from '../../core/helply-types';
import { mcpErrorMessage } from '../../core/mcp-api';
import { McpPermissionSet, samePermissions, schoolDataPreset } from '../../core/mcp-permissions';
import { McpPermissionEditor } from '../../shared/mcp-permission-editor';

/** Side sheet to choose what Helply may use. Reuses the MCP permission editor. */
@Component({
  selector: 'app-helply-settings-sheet',
  imports: [TranslatePipe, HlmAlertImports, HlmButton, HlmSheetImports, HlmSpinner, HlmSwitch, HlmToggleGroupImports, McpPermissionEditor, NgIcon],
  providers: [provideIcons({ lucideInfo })],
  template: `
    <hlm-sheet side="right" [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 sm:max-w-xl">
        <hlm-sheet-header class="border-b">
          <h2 hlmSheetTitle>{{ 'helply.settings' | translate }}</h2>
          <p hlmSheetDescription>{{ 'helply.settingsSheet.description' | translate }}</p>
        </hlm-sheet-header>
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          <div hlmAlert>
            <ng-icon name="lucideInfo" aria-hidden="true" />
            <p hlmAlertDescription>
              {{ 'helply.settingsSheet.info' | translate }}
            </p>
          </div>
          @if (loading()) {
            <hlm-spinner [attr.aria-label]="'helply.settingsSheet.loading' | translate" />
          } @else if (loaded()) {
            <section class="flex flex-col gap-2 rounded-lg border p-4" aria-labelledby="helply-reasoning-title">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 id="helply-reasoning-title" class="text-sm font-medium">{{ 'helply.settingsSheet.reasoning' | translate }}</h3>
                <hlm-toggle-group
                  type="single"
                  variant="outline"
                  [nullable]="false"
                  [value]="draftReasoning()"
                  (valueChange)="setReasoning($event)"
                  aria-labelledby="helply-reasoning-title"
                  aria-describedby="helply-reasoning-help"
                >
                  @for (option of reasoningOptions; track option.value) {
                    <button hlmToggleGroupItem [value]="option.value" class="px-3">{{ option.key | translate }}</button>
                  }
                </hlm-toggle-group>
              </div>
              <p id="helply-reasoning-help" class="text-muted-foreground text-sm">{{ 'helply.settingsSheet.reasoningHelp' | translate }}</p>
            </section>
            <section class="flex flex-col gap-2 rounded-lg border p-4" aria-labelledby="helply-workspace-title">
              <div class="flex items-center justify-between gap-3">
                <h3 id="helply-workspace-title" class="text-sm font-medium">
                  <label for="helply-workspace">{{ 'helply.settingsSheet.workspace' | translate }}</label>
                </h3>
                <hlm-switch
                  inputId="helply-workspace"
                  aria-describedby="helply-workspace-help"
                  [checked]="draftWorkspace()"
                  [disabled]="!workspaceAvailable()"
                  (checkedChange)="draftWorkspace.set($event)"
                />
              </div>
              <p id="helply-workspace-help" class="text-muted-foreground text-sm">
                {{ 'helply.settingsSheet.workspaceHelp' | translate }}
              </p>
              @if (!workspaceAvailable()) {
                <p class="text-muted-foreground text-sm font-medium">{{ 'helply.settingsSheet.unavailable' | translate }}</p>
              }
            </section>
            <app-mcp-permission-editor [(value)]="draft" />
          }
        </div>
        <hlm-sheet-footer class="border-t">
          <div aria-live="polite" role="status" class="w-full">
            @if (error()) {
              <div hlmAlert variant="destructive"><p hlmAlertDescription>{{ error() }}</p></div>
            } @else if (saved()) {
              <p class="text-muted-foreground text-sm">{{ 'helply.settingsSheet.saved' | translate }}</p>
            }
          </div>
          <div class="flex justify-end gap-2">
            <button hlmBtn variant="outline" type="button" (click)="open.set(false)">{{ 'common.close' | translate }}</button>
            <button hlmBtn type="button" [disabled]="!changed() || saving()" (click)="save()">
              @if (saving()) {
                <hlm-spinner aria-hidden="true" />
              }
              {{ 'helply.settingsSheet.save' | translate }}
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
  /** The settings as saved, so the page can follow them (starter questions). */
  readonly saved$ = output<HelplySettings>({ alias: 'saved' });

  private readonly initial = signal<McpPermissionSet | null>(null);
  protected readonly draft = linkedSignal<McpPermissionSet>(() => this.initial() ?? schoolDataPreset());
  private readonly initialWorkspace = signal(false);
  protected readonly workspaceAvailable = signal(false);
  protected readonly draftWorkspace = linkedSignal<boolean>(() => this.initialWorkspace());
  private readonly initialReasoning = signal<HelplyReasoningEffort>('High');
  protected readonly draftReasoning = linkedSignal<HelplyReasoningEffort>(() => this.initialReasoning());
  protected readonly reasoningOptions: { value: HelplyReasoningEffort; key: string }[] = [
    { value: 'Low', key: 'helply.settingsSheet.reasoningLow' },
    { value: 'Medium', key: 'helply.settingsSheet.reasoningMedium' },
    { value: 'High', key: 'helply.settingsSheet.reasoningHigh' },
  ];
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loaded = computed(() => this.initial() !== null);
  protected readonly changed = computed(() => {
    const initial = this.initial();
    return !!initial && (!samePermissions(initial, this.draft()) || this.draftWorkspace() !== this.initialWorkspace() || this.draftReasoning() !== this.initialReasoning());
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
      const settings = await this.api.settings();
      this.initialWorkspace.set(settings.workspace === true);
      this.workspaceAvailable.set(settings.workspaceAvailable === true);
      this.initialReasoning.set(settings.reasoningEffort ?? 'High');
      this.initial.set(settings.permissions);
    } catch (error) {
      this.error.set(mcpErrorMessage(error, t('helply.settingsSheet.loadFailed')));
    } finally {
      this.loading.set(false);
    }
  }

  protected setReasoning(value: HelplyReasoningEffort | HelplyReasoningEffort[] | null | undefined): void {
    const next = Array.isArray(value) ? value[0] : value;
    if (next === 'Low' || next === 'Medium' || next === 'High') this.draftReasoning.set(next);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      const initial = this.initial();
      if (!initial || !samePermissions(initial, this.draft())) {
        this.initial.set((await this.api.updatePermissions(this.draft())).permissions);
      }
      if (this.draftWorkspace() !== this.initialWorkspace()) {
        this.initialWorkspace.set((await this.api.updateWorkspace(this.draftWorkspace())).workspace === true);
      }
      if (this.draftReasoning() !== this.initialReasoning()) {
        this.initialReasoning.set((await this.api.updateReasoning(this.draftReasoning())).reasoningEffort ?? 'High');
      }
      this.saved.set(true);
      this.saved$.emit({ permissions: this.initial() ?? this.draft(), workspace: this.initialWorkspace(), workspaceAvailable: this.workspaceAvailable(), reasoningEffort: this.initialReasoning() });
    } catch (error) {
      this.error.set(mcpErrorMessage(error, t('helply.settingsSheet.saveFailed')));
    } finally {
      this.saving.set(false);
    }
  }
}
