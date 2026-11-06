import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../../core/i18n';
import { Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBot, lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';
import { McpActivity, McpApi, McpConnection, mcpErrorMessage } from '../../core/mcp-api';
import { McpPermissionSet, summarize } from '../../core/mcp-permissions';
import { EmptyState } from '../../shared/empty-state';
import { formatDate, relativeTime } from './format';
import { McpEditSheet } from './mcp-edit-sheet';

@Component({
  selector: 'app-mcp-connections-card',
  imports: [TranslatePipe, HlmAlertImports, HlmAlertDialogImports, HlmBadge, HlmButton, HlmCardImports, HlmSpinner, NgIcon, EmptyState, McpEditSheet],
  providers: [provideIcons({ lucideBot, lucidePencil, lucideTrash2 })],
  template: `
    <section hlmCard>
      <div hlmCardHeader>
        <h2 hlmCardTitle>{{ 'mcp.connections.title' | translate }}</h2>
        <p hlmCardDescription>{{ 'mcp.connections.description' | translate }}</p>
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
          <hlm-spinner [attr.aria-label]="'mcp.connections.loading' | translate" />
        } @else if (connections().length) {
          <ul class="divide-y rounded-lg border">
            @for (connection of connections(); track connection.id) {
              <li class="flex flex-col gap-3 px-3 py-3 text-sm">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate font-medium">{{ connection.clientName }}</p>
                    <p class="text-muted-foreground truncate text-xs">{{ connection.redirectHosts.join(', ') }}</p>
                    <p class="text-muted-foreground text-xs">
                      {{ 'mcp.connections.meta' | translate: { date: date(connection.createdAt), used: lastUsed(connection.lastUsedAt) } }}
                    </p>
                  </div>
                  <div class="flex gap-2">
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      type="button"
                      [attr.aria-label]="'Edit permissions for ' + connection.clientName"
                      (click)="edit(connection)"
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
                        [attr.aria-label]="'mcp.revokeName' | translate: { name: connection.clientName }"
                      >
                        <ng-icon name="lucideTrash2" aria-hidden="true" />
                        {{ 'mcp.revoke' | translate }}
                      </button>
                      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                        <hlm-alert-dialog-header>
                          <h2 hlmAlertDialogTitle>{{ 'mcp.revokeQuestion' | translate: { name: connection.clientName } }}</h2>
                          <p hlmAlertDialogDescription>
                            {{ 'mcp.connections.revokeHint' | translate }}
                          </p>
                        </hlm-alert-dialog-header>
                        <hlm-alert-dialog-footer>
                          <button hlmAlertDialogCancel>{{ 'common.cancel' | translate }}</button>
                          <button hlmAlertDialogAction variant="destructive" (click)="revoke(connection)">
                            {{ 'mcp.revoke' | translate }}
                          </button>
                        </hlm-alert-dialog-footer>
                      </hlm-alert-dialog-content>
                    </hlm-alert-dialog>
                  </div>
                </div>
                <ul class="flex flex-wrap gap-1.5" [attr.aria-label]="'mcp.access' | translate">
                  @for (chip of summary(connection.permissions); track chip) {
                    <li><span hlmBadge variant="secondary">{{ chip }}</span></li>
                  }
                </ul>
              </li>
            }
          </ul>
        } @else {
          <app-empty-state
            icon="lucideBot"
            [title]="'mcp.connections.none' | translate"
            [description]="'mcp.connections.noneHint' | translate"
          />
        }
      </div>
    </section>

    <app-mcp-edit-sheet
      [(open)]="sheetOpen"
      kind="app"
      [name]="editing()?.clientName ?? ''"
      [initial]="editing()?.permissions ?? null"
      [activity]="activity()"
      [activityLoading]="activityLoading()"
      [saving]="saving()"
      [error]="sheetError()"
      (save)="save($event)"
    />
  `,
})
export class McpConnectionsCard implements OnInit {
  private readonly api = inject(McpApi);

  protected readonly connections = signal<McpConnection[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<McpConnection | null>(null);
  protected readonly sheetOpen = signal(false);
  protected readonly activity = signal<McpActivity[]>([]);
  protected readonly activityLoading = signal(false);
  protected readonly saving = signal(false);
  protected readonly sheetError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.connections.set(await firstValueFrom(this.api.connections()));
    } catch (error) {
      this.error.set(mcpErrorMessage(error, t('mcp.connections.loadFailed')));
    } finally {
      this.loading.set(false);
    }
  }

  protected summary = summarize;
  protected date = formatDate;
  protected lastUsed(value: string | null | undefined): string {
    return relativeTime(value);
  }

  protected async edit(connection: McpConnection): Promise<void> {
    this.editing.set(connection);
    this.sheetError.set(null);
    this.activity.set([]);
    this.sheetOpen.set(true);
    this.activityLoading.set(true);
    try {
      this.activity.set(await firstValueFrom(this.api.connectionActivity(connection.id)));
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
      const updated = await firstValueFrom(this.api.updateConnection(current.id, permissions));
      this.connections.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      this.editing.set(updated);
      toast.success(t('mcp.saved'));
    } catch (error) {
      this.sheetError.set(mcpErrorMessage(error, t('mcp.saveFailed')));
    } finally {
      this.saving.set(false);
    }
  }

  protected async revoke(connection: McpConnection): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.api.revokeConnection(connection.id));
      this.connections.update((list) => list.filter((item) => item.id !== connection.id));
      toast.success(`${connection.clientName} was revoked.`);
    } catch (error) {
      this.error.set(mcpErrorMessage(error, t('mcp.connections.revokeFailed')));
    }
  }
}
