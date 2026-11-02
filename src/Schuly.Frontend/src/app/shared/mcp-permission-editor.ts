import { Component, OnInit, computed, inject, model, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { LinkedAccount, McpApi } from '../core/mcp-api';
import {
  MCP_GROUPS,
  McpAccessLevel,
  McpArea,
  McpAreaInfo,
  McpPermissionSet,
  fullAccessPreset,
  hasWrite,
  levelOf,
  readOnlyPreset,
  withLevel,
} from '../core/mcp-permissions';

let nextId = 0;

/** Two-way bound editor for what an app or API key may do. */
@Component({
  selector: 'app-mcp-permission-editor',
  imports: [HlmButton, HlmCheckbox, HlmFieldImports, HlmSwitch],
  template: `
    <div class="@container flex min-w-0 flex-col gap-5">
      <div class="flex flex-wrap items-center gap-2" role="group" [attr.aria-label]="'Presets'">
        <span class="text-muted-foreground text-sm">Presets</span>
        <button hlmBtn type="button" variant="outline" size="sm" (click)="applyReadOnly()">Read-only</button>
        <button hlmBtn type="button" variant="outline" size="sm" (click)="applyFull()">Full access</button>
      </div>

      @for (group of groups; track group.label) {
        <fieldset hlmFieldSet>
          <legend hlmFieldLegend>{{ group.label }}</legend>
          <div class="flex flex-col divide-y rounded-lg border">
            @for (info of group.areas; track info.area) {
              <div class="flex flex-col gap-2 px-3 py-3 @[640px]:flex-row @[640px]:items-center @[640px]:justify-between @[640px]:gap-6">
                <div class="min-w-0 @[640px]:flex-1">
                  <p class="text-sm font-medium break-words" [id]="prefix + info.area">{{ info.label }}</p>
                  <p class="text-muted-foreground text-xs break-words" [id]="prefix + info.area + '-d'">{{ info.description }}</p>
                </div>
                <!-- A segmented control made of native radios: arrow keys move the choice and every option stays visible. -->
                <div
                  role="radiogroup"
                  class="bg-muted grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-lg p-0.5 @[640px]:w-64 @[640px]:shrink-0"
                  [attr.aria-labelledby]="prefix + info.area"
                  [attr.aria-describedby]="prefix + info.area + '-d'"
                >
                  @for (option of options(info); track option.value) {
                    <label class="relative min-w-0 cursor-pointer">
                      <input
                        type="radio"
                        class="peer sr-only"
                        [name]="prefix + info.area"
                        [value]="option.value"
                        [checked]="level(info.area) === option.value"
                        (change)="setLevel(info, option.value)"
                      />
                      <span
                        class="text-foreground peer-checked:bg-background peer-focus-visible:ring-ring/50 hover:bg-background/50 block rounded-md px-2 py-1.5 text-center text-sm peer-checked:font-medium peer-checked:shadow-xs peer-focus-visible:ring-3"
                        >{{ option.label }}</span
                      >
                    </label>
                  }
                </div>
              </div>
            }
          </div>
        </fieldset>
      }

      <div class="flex items-start gap-3 rounded-lg border px-3 py-2.5">
        <hlm-switch
          [inputId]="prefix + 'destructive'"
          aria-label="Allow deleting"
          [aria-describedby]="prefix + 'destructive-d'"
          [checked]="value().allowDestructive"
          [disabled]="!writable()"
          (checkedChange)="setDestructive($event)"
        />
        <div>
          <label class="text-sm font-medium" [for]="prefix + 'destructive'">Allow deleting</label>
          <p class="text-muted-foreground text-xs" [id]="prefix + 'destructive-d'">
            Lets the app delete mail and withdraw reported absences. Needs write access to Mail or Absences.
          </p>
        </div>
      </div>

      @if (accounts().length > 1) {
        <fieldset hlmFieldSet>
          <legend hlmFieldLegend>Linked accounts</legend>
          <div class="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
            <label class="flex items-center gap-2 text-sm" [for]="prefix + 'all-accounts'">
              <hlm-checkbox
                [inputId]="prefix + 'all-accounts'"
                [checked]="value().microsoftAccountIds === null"
                (checkedChange)="setAllAccounts($event)"
              />
              All accounts, including ones you add later
            </label>
            @for (account of accounts(); track account.id) {
              <label class="flex items-center gap-2 text-sm" [for]="prefix + 'acc-' + account.id">
                <hlm-checkbox
                  [inputId]="prefix + 'acc-' + account.id"
                  [checked]="accountChecked(account.id)"
                  [disabled]="value().microsoftAccountIds === null"
                  (checkedChange)="setAccount(account.id, $event)"
                />
                {{ account.displayName || account.email }}
                @if (account.displayName && account.email) {
                  <span class="text-muted-foreground text-xs">{{ account.email }}</span>
                }
              </label>
            }
          </div>
        </fieldset>
      }
    </div>
  `,
})
export class McpPermissionEditor implements OnInit {
  readonly value = model.required<McpPermissionSet>();

  private readonly api = inject(McpApi);
  protected readonly prefix = `mcp-perm-${nextId++}-`;
  protected readonly groups = MCP_GROUPS;
  protected readonly accounts = signal<LinkedAccount[]>([]);
  protected readonly writable = computed(() => hasWrite(this.value()));

  async ngOnInit(): Promise<void> {
    this.accounts.set(await firstValueFrom(this.api.microsoftAccounts()).catch(() => []));
  }

  protected options(info: McpAreaInfo): { value: McpAccessLevel; label: string }[] {
    const options: { value: McpAccessLevel; label: string }[] = [
      { value: 'Off', label: 'Off' },
      { value: 'Read', label: 'Read' },
    ];
    if (info.canWrite) options.push({ value: 'ReadWrite', label: 'Read & write' });
    return options;
  }

  protected level(area: McpArea): McpAccessLevel {
    return levelOf(this.value(), area);
  }

  protected setLevel(info: McpAreaInfo, level: unknown): void {
    if (level !== 'Off' && level !== 'Read' && level !== 'ReadWrite') return;
    this.value.set(withLevel(this.value(), info.area, level));
  }

  protected setDestructive(allow: boolean): void {
    this.value.update((current) => ({ ...current, allowDestructive: allow && hasWrite(current) }));
  }

  protected applyReadOnly(): void {
    this.value.set(readOnlyPreset(this.value().microsoftAccountIds));
  }

  protected applyFull(): void {
    this.value.set(fullAccessPreset(this.value().microsoftAccountIds));
  }

  protected accountChecked(id: string): boolean {
    const ids = this.value().microsoftAccountIds;
    return ids === null || ids.includes(id);
  }

  protected setAllAccounts(all: boolean): void {
    this.value.update((current) => ({
      ...current,
      microsoftAccountIds: all ? null : this.accounts().map((account) => account.id),
    }));
  }

  protected setAccount(id: string, checked: boolean): void {
    this.value.update((current) => {
      const ids = current.microsoftAccountIds ?? this.accounts().map((account) => account.id);
      return {
        ...current,
        microsoftAccountIds: checked ? [...new Set([...ids, id])] : ids.filter((other) => other !== id),
      };
    });
  }
}
