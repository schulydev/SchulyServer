import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyRound, lucidePencil, lucidePlus, lucideTrash2, lucideTriangleAlert } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';
import { AI_APP_OPT_IN, McpActivity, McpApi, McpKey, mcpErrorMessage } from '../../core/mcp-api';
import { McpPermissionSet, schoolDataPreset, summarize } from '../../core/mcp-permissions';
import { CopyBlock } from '../../shared/copy-block';
import { EmptyState } from '../../shared/empty-state';
import { formatDate, relativeTime } from './format';
import { McpEditSheet } from './mcp-edit-sheet';
import { McpPermissionEditor } from '../../shared/mcp-permission-editor';

const MAX_NAME = 100;
const DAY = 24 * 3600 * 1000;

const EXPIRIES = [
  { value: '30', label: 'mcp.keys.days30', days: 30 },
  { value: '90', label: 'mcp.keys.days90', days: 90 },
  { value: '365', label: 'mcp.keys.year', days: 365 },
];

@Component({
  selector: 'app-mcp-keys-card',
  imports: [
    TranslatePipe,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadge,
    HlmButton,
    HlmCardImports,
    HlmCheckbox,
    HlmDialogImports,
    HlmFieldImports,
    HlmInput,
    HlmSelectImports,
    HlmSpinner,
    NgIcon,
    CopyBlock,
    EmptyState,
    McpEditSheet,
    McpPermissionEditor,
  ],
  providers: [provideIcons({ lucideKeyRound, lucidePencil, lucidePlus, lucideTrash2, lucideTriangleAlert })],
  template: `
    <section hlmCard>
      <div hlmCardHeader>
        <h2 hlmCardTitle>{{ 'mcp.keys.title' | translate }}</h2>
        <p hlmCardDescription>{{ 'mcp.keys.description' | translate }}</p>
        <div hlmCardAction>
          <button hlmBtn type="button" (click)="openCreate()">
            <ng-icon name="lucidePlus" aria-hidden="true" />
            {{ 'mcp.keys.create' | translate }}
          </button>
        </div>
      </div>
      <div hlmCardContent class="flex flex-col gap-4">
        <div aria-live="polite" role="status">
          @if (error()) {
            <div hlmAlert variant="destructive">
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }
        </div>

        @if (loading()) {
          <hlm-spinner [attr.aria-label]="'mcp.keys.loading' | translate" />
        } @else if (keys().length) {
          <ul class="divide-y rounded-lg border">
            @for (key of keys(); track key.id) {
              <li class="flex flex-col gap-3 px-3 py-3 text-sm">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate font-medium">{{ key.name }}</p>
                    <p class="text-muted-foreground font-mono text-xs">{{ key.prefix }}...</p>
                    <p class="text-muted-foreground text-xs">
                      {{ 'mcp.keys.created' | translate: { date: date(key.createdAt) } }}
                      {{ key.expiresAt ? ('mcp.keys.expires' | translate: { date: date(key.expiresAt) }) : ('mcp.keys.neverExpires' | translate) }}
                      {{ 'mcp.keys.lastUsed' | translate: { used: lastUsed(key.lastUsedAt) } }}
                    </p>
                  </div>
                  <div class="flex gap-2">
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      type="button"
                      [attr.aria-label]="'Edit permissions for ' + key.name"
                      (click)="edit(key)"
                    >
                      <ng-icon name="lucidePencil" aria-hidden="true" />
                      {{ 'mcp.editPermissions' | translate }}
                    </button>
                    <hlm-alert-dialog>
                      <button
                        hlmAlertDialogTrigger
                        hlmBtn
                        variant="outline"
                        size="sm"
                        [attr.aria-label]="'mcp.revokeName' | translate: { name: key.name }"
                      >
                        <ng-icon name="lucideTrash2" aria-hidden="true" />
                        {{ 'mcp.revoke' | translate }}
                      </button>
                      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                        <hlm-alert-dialog-header>
                          <h2 hlmAlertDialogTitle>{{ 'mcp.revokeQuestion' | translate: { name: key.name } }}</h2>
                          <p hlmAlertDialogDescription>
                            {{ 'mcp.keys.revokeHint' | translate }}
                          </p>
                        </hlm-alert-dialog-header>
                        <hlm-alert-dialog-footer>
                          <button hlmAlertDialogCancel>{{ 'common.cancel' | translate }}</button>
                          <button hlmAlertDialogAction variant="destructive" (click)="revoke(key)">{{ 'mcp.revoke' | translate }}</button>
                        </hlm-alert-dialog-footer>
                      </hlm-alert-dialog-content>
                    </hlm-alert-dialog>
                  </div>
                </div>
                <ul class="flex flex-wrap gap-1.5" [attr.aria-label]="'mcp.access' | translate">
                  @for (chip of summary(key.permissions); track chip) {
                    <li><span hlmBadge variant="secondary">{{ chip }}</span></li>
                  }
                </ul>
              </li>
            }
          </ul>
        } @else {
          <app-empty-state
            icon="lucideKeyRound"
            [title]="'mcp.keys.none' | translate"
            [description]="'mcp.keys.noneHint' | translate"
          />
        }
      </div>
    </section>

    <hlm-dialog [state]="createOpen() ? 'open' : 'closed'" (closed)="createOpen.set(false)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ 'mcp.keys.createTitle' | translate }}</h2>
          <p hlmDialogDescription>{{ 'mcp.keys.createHint' | translate }}</p>
        </hlm-dialog-header>
        <div class="flex flex-col gap-4" [attr.aria-busy]="creating()">
          <div hlmField>
            <label hlmFieldLabel for="mcp-key-name">{{ 'mcp.keys.name' | translate }}</label>
            <input
              #nameInput
              hlmInput
              id="mcp-key-name"
              required
              autocomplete="off"
              [attr.maxlength]="maxName"
              [value]="name()"
              (input)="name.set(nameInput.value)"
              [placeholder]="'mcp.keys.namePlaceholder' | translate"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="mcp-key-expiry">{{ 'mcp.keys.expiresLabel' | translate }}</label>
            <hlm-select [value]="expiry()" (valueChange)="expiry.set($event ?? '90')">
              <hlm-select-trigger buttonId="mcp-key-expiry" class="w-full">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                <hlm-select-group>
                  @for (option of expiries; track option.value) {
                    <hlm-select-item [value]="option.value">{{ option.label | translate }}</hlm-select-item>
                  }
                </hlm-select-group>
              </hlm-select-content>
            </hlm-select>
          </div>
          <app-mcp-permission-editor [(value)]="newPermissions" />
          <label class="flex items-start gap-2 text-sm" for="mcp-key-opt-in">
            <hlm-checkbox class="mt-0.5" inputId="mcp-key-opt-in" [checked]="optIn()" (checkedChange)="optIn.set($event)" />
            {{ optInText | translate }}
          </label>
          <div aria-live="polite" role="status">
            @if (createError()) {
              <div hlmAlert variant="destructive">
                <p hlmAlertDescription>{{ createError() }}</p>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" type="button" [disabled]="creating()" (click)="createOpen.set(false)">
              {{ 'common.cancel' | translate }}
            </button>
            <button hlmBtn type="button" [disabled]="!nameValid() || !optIn() || creating()" (click)="create()">
              @if (creating()) {
                <hlm-spinner aria-hidden="true" />
              }
              {{ 'mcp.keys.create' | translate }}
            </button>
          </hlm-dialog-footer>
        </div>
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-dialog [state]="secret() ? 'open' : 'closed'" (closed)="secret.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ 'mcp.keys.newTitle' | translate }}</h2>
          <p hlmDialogDescription>{{ 'mcp.keys.newHint' | translate }}</p>
        </hlm-dialog-header>
        <div class="flex flex-col gap-4">
          <div hlmAlert>
            <ng-icon name="lucideTriangleAlert" hlmAlertIcon aria-hidden="true" />
            <p hlmAlertDescription>{{ 'mcp.keys.newWarning' | translate }}</p>
          </div>
          @if (secret(); as value) {
            <app-copy-block [text]="value" label="API key" [single]="true" />
          }
          <hlm-dialog-footer>
            <button hlmBtn type="button" (click)="secret.set(null)">{{ 'mcp.keys.copied' | translate }}</button>
          </hlm-dialog-footer>
        </div>
      </hlm-dialog-content>
    </hlm-dialog>

    <app-mcp-edit-sheet
      [(open)]="sheetOpen"
      kind="API key"
      [name]="editing()?.name ?? ''"
      [initial]="editing()?.permissions ?? null"
      [activity]="activity()"
      [activityLoading]="activityLoading()"
      [saving]="saving()"
      [error]="sheetError()"
      (save)="save($event)"
    />
  `,
})
export class McpKeysCard implements OnInit {
  private readonly api = inject(McpApi);

  protected readonly maxName = MAX_NAME;
  protected readonly expiries = EXPIRIES;
  protected readonly keys = signal<McpKey[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly optInText = AI_APP_OPT_IN;
  protected readonly optIn = signal(false);
  protected readonly expiry = signal('90');
  protected readonly newPermissions = signal<McpPermissionSet>(schoolDataPreset());
  protected readonly nameValid = computed(() => this.name().trim().length > 0 && this.name().length <= MAX_NAME);
  /** Held only while the dialog is open, never stored. */
  protected readonly secret = signal<string | null>(null);

  protected readonly editing = signal<McpKey | null>(null);
  protected readonly sheetOpen = signal(false);
  protected readonly activity = signal<McpActivity[]>([]);
  protected readonly activityLoading = signal(false);
  protected readonly saving = signal(false);
  protected readonly sheetError = signal<string | null>(null);

  protected summary = summarize;
  protected date = formatDate;
  protected lastUsed(value: string | null | undefined): string {
    return relativeTime(value);
  }

  async ngOnInit(): Promise<void> {
    try {
      this.keys.set(await firstValueFrom(this.api.keys()));
    } catch (error) {
      this.error.set(mcpErrorMessage(error, t('mcp.keys.loadFailed')));
    } finally {
      this.loading.set(false);
    }
  }

  protected openCreate(): void {
    this.name.set('');
    this.expiry.set('90');
    this.optIn.set(false);
    this.newPermissions.set(schoolDataPreset());
    this.createError.set(null);
    this.createOpen.set(true);
  }

  protected async create(): Promise<void> {
    if (!this.nameValid() || !this.optIn() || this.creating()) return;
    const days = EXPIRIES.find((option) => option.value === this.expiry())?.days ?? 0;
    this.creating.set(true);
    this.createError.set(null);
    try {
      const created = await firstValueFrom(
        this.api.createKey({
          name: this.name().trim(),
          permissions: this.newPermissions(),
          expiresAt: days ? new Date(Date.now() + days * DAY).toISOString() : null,
          aiAppSharingConfirmed: true,
        }),
      );
      this.keys.update((list) => [created.key, ...list]);
      this.createOpen.set(false);
      this.secret.set(created.secret);
    } catch (error) {
      this.createError.set(mcpErrorMessage(error, t('mcp.keys.createFailed')));
    } finally {
      this.creating.set(false);
    }
  }

  protected async edit(key: McpKey): Promise<void> {
    this.editing.set(key);
    this.sheetError.set(null);
    this.activity.set([]);
    this.sheetOpen.set(true);
    this.activityLoading.set(true);
    try {
      this.activity.set(await firstValueFrom(this.api.keyActivity(key.id)));
    } catch {
      this.activity.set([]);
    } finally {
      this.activityLoading.set(false);
    }
  }

  protected async save(permissions: McpPermissionSet): Promise<void> {
    const current = this.editing();
    if (!current) return;
    this.saving.set(true);
    this.sheetError.set(null);
    try {
      const updated = await firstValueFrom(this.api.updateKey(current.id, permissions));
      this.keys.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      this.editing.set(updated);
      toast.success(t('mcp.saved'));
    } catch (error) {
      this.sheetError.set(mcpErrorMessage(error, t('mcp.saveFailed')));
    } finally {
      this.saving.set(false);
    }
  }

  protected async revoke(key: McpKey): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.api.revokeKey(key.id));
      this.keys.update((list) => list.filter((item) => item.id !== key.id));
      toast.success(`${key.name} was revoked.`);
    } catch (error) {
      this.error.set(mcpErrorMessage(error, t('mcp.keys.revokeFailed')));
    }
  }
}
