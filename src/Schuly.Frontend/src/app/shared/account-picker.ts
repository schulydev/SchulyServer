import { TranslatePipe } from '@ngx-translate/core';
import { Component, computed, inject, input } from '@angular/core';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { CapabilityKind, LinkedAccountsStore } from '../stores/linked-accounts.store';

/** Chooses between the linked accounts that offer a capability, when there is more than one. */
@Component({
  selector: 'app-account-picker',
  imports: [TranslatePipe, HlmSelectImports],
  template: `
    @if (list().length > 1) {
      <div class="flex items-center gap-2">
        <label [for]="'account-' + kind()" class="text-muted-foreground text-sm">{{ 'common.account' | translate }}</label>
        <hlm-select [value]="accounts.selectedId(kind())" [itemToString]="label" (valueChange)="choose($event)">
          <hlm-select-trigger [buttonId]="'account-' + kind()">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            <hlm-select-group>
              @for (account of list(); track account.id) {
                <hlm-select-item [value]="account.id">{{ account.providerName }}: {{ account.title }}</hlm-select-item>
              }
            </hlm-select-group>
          </hlm-select-content>
        </hlm-select>
      </div>
    }
  `,
})
export class AccountPicker {
  readonly kind = input.required<CapabilityKind>();
  protected readonly accounts = inject(LinkedAccountsStore);
  protected readonly list = computed(() => this.accounts.capabilityAccounts()[this.kind()]);

  protected readonly label = (id: string): string => {
    const account = this.list().find((a) => a.id === id);
    return account ? `${account.providerName}: ${account.title}` : id;
  };

  protected choose(id: string | null | undefined): void {
    if (id) this.accounts.select(this.kind(), id);
  }
}
