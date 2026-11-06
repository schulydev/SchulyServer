import { TranslatePipe } from '@ngx-translate/core';
import { Component, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEllipsis, lucidePencil, lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ConversationSummary } from '../../core/helply-types';
import { relativeTime } from '../mcp/format';

const MAX_TITLE = 120;

@Component({
  selector: 'app-conversation-list',
  imports: [TranslatePipe, HlmAlertDialogImports, HlmButton, HlmDialogImports, HlmDropdownMenuImports, HlmInput, HlmLabel, NgIcon],
  providers: [provideIcons({ lucideEllipsis, lucidePencil, lucidePlus, lucideTrash2 })],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <div class="p-3">
      <button hlmBtn type="button" class="w-full" (click)="create.emit()">
        <ng-icon name="lucidePlus" aria-hidden="true" />
        {{ 'helply.newChat' | translate }}
      </button>
    </div>
    <nav [attr.aria-label]="'helply.conversationsShort' | translate" class="min-h-0 flex-1 overflow-y-auto px-2">
      @if (conversations().length) {
        <ul class="flex flex-col gap-0.5">
          @for (conversation of conversations(); track conversation.id) {
            <li
              class="hover:bg-accent group flex items-center rounded-lg"
              [class.bg-accent]="conversation.id === activeId()"
            >
              <button
                type="button"
                class="focus-visible:ring-ring/50 flex min-w-0 flex-1 flex-col rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-3"
                [attr.aria-current]="conversation.id === activeId() ? 'true' : null"
                (click)="select.emit(conversation.id)"
              >
                <span class="truncate text-sm font-medium">{{ conversation.title }}</span>
                <span class="text-xs" [class.text-muted-foreground]="conversation.id !== activeId()" [class.text-accent-foreground]="conversation.id === activeId()">{{ when(conversation.updatedAt) }}</span>
              </button>
              <button
                type="button"
                hlmBtn
                variant="ghost"
                size="icon-sm"
                class="mr-1 shrink-0"
                [hlmDropdownMenuTrigger]="menu"
                align="end"
                [attr.aria-label]="'Actions for ' + conversation.title"
              >
                <ng-icon name="lucideEllipsis" aria-hidden="true" />
              </button>
              <ng-template #menu>
                <hlm-dropdown-menu class="min-w-40">
                  <button hlmDropdownMenuItem type="button" (click)="startRename(conversation)">
                    <ng-icon name="lucidePencil" aria-hidden="true" />
                    {{ 'helply.list.rename' | translate }}
                  </button>
                  <button hlmDropdownMenuItem type="button" variant="destructive" (click)="deleting.set(conversation)">
                    <ng-icon name="lucideTrash2" aria-hidden="true" />
                    {{ 'common.delete' | translate }}
                  </button>
                </hlm-dropdown-menu>
              </ng-template>
            </li>
          }
        </ul>
      } @else {
        <p class="text-muted-foreground px-2.5 py-4 text-sm">{{ 'helply.list.none' | translate }}</p>
      }
    </nav>
    <div class="flex flex-col gap-2 border-t p-3">
      @if (conversations().length) {
        <button hlmBtn type="button" variant="outline" size="sm" (click)="deletingAll.set(true)">
          <ng-icon name="lucideTrash2" aria-hidden="true" />
          {{ 'helply.list.deleteAll' | translate }}
        </button>
      }
      <p class="text-muted-foreground text-xs">{{ 'helply.list.retention' | translate }}</p>
    </div>

    <hlm-dialog [state]="renaming() ? 'open' : 'closed'" (closed)="renaming.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-md">
        <form (submit)="$event.preventDefault(); confirmRename()" class="flex flex-col gap-4">
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ 'helply.list.renameTitle' | translate }}</h2>
            <p hlmDialogDescription>{{ 'helply.list.renameHint' | translate }}</p>
          </hlm-dialog-header>
          <div class="flex flex-col gap-2">
            <label hlmLabel for="helply-rename">{{ 'helply.list.title' | translate }}</label>
            <input
              #titleInput
              hlmInput
              id="helply-rename"
              autocomplete="off"
              required
              [attr.maxlength]="maxTitle"
              [value]="title()"
              (input)="title.set(titleInput.value)"
            />
          </div>
          <hlm-dialog-footer>
            <button hlmBtn type="button" variant="outline" (click)="renaming.set(null)">{{ 'common.cancel' | translate }}</button>
            <button hlmBtn type="submit" [disabled]="!title().trim()">{{ 'common.save' | translate }}</button>
          </hlm-dialog-footer>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-alert-dialog [state]="deleting() ? 'open' : 'closed'" (closed)="deleting.set(null)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h2 hlmAlertDialogTitle>{{ 'helply.list.deleteOne' | translate }}</h2>
          <p hlmAlertDialogDescription>
            {{ 'helply.list.deleteOneHint' | translate: { title: deleting()?.title } }}
          </p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel>{{ 'common.cancel' | translate }}</button>
          <button hlmAlertDialogAction variant="destructive" (click)="confirmDelete()">{{ 'common.delete' | translate }}</button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>

    <hlm-alert-dialog [state]="deletingAll() ? 'open' : 'closed'" (closed)="deletingAll.set(false)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h2 hlmAlertDialogTitle>{{ 'helply.list.deleteAllTitle' | translate }}</h2>
          <p hlmAlertDialogDescription>
            {{ 'helply.list.deleteAllDescription' | translate }}
          </p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel>{{ 'common.cancel' | translate }}</button>
          <button hlmAlertDialogAction variant="destructive" (click)="removeAll.emit(); deletingAll.set(false)">
            {{ 'helply.list.deleteAllShort' | translate }}
          </button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class ConversationList {
  readonly conversations = input.required<ConversationSummary[]>();
  readonly activeId = input<string | null>(null);
  readonly select = output<string>();
  readonly create = output();
  readonly rename = output<{ id: string; title: string }>();
  readonly remove = output<string>();
  readonly removeAll = output();

  protected readonly maxTitle = MAX_TITLE;
  protected readonly renaming = signal<ConversationSummary | null>(null);
  protected readonly title = signal('');
  protected readonly deleting = signal<ConversationSummary | null>(null);
  protected readonly deletingAll = signal(false);

  protected when(value: string): string {
    return relativeTime(value);
  }

  protected startRename(conversation: ConversationSummary): void {
    this.title.set(conversation.title);
    this.renaming.set(conversation);
  }

  protected confirmRename(): void {
    const target = this.renaming();
    const title = this.title().trim();
    if (!target || !title) return;
    this.rename.emit({ id: target.id, title });
    this.renaming.set(null);
  }

  protected confirmDelete(): void {
    const target = this.deleting();
    if (target) this.remove.emit(target.id);
    this.deleting.set(null);
  }
}
