import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoader2, lucidePencil } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { UserStore } from '../../stores/user.store';

/** One profile line: the picture, changed from a small menu on it, then the name and sign-in email. */
@Component({
  selector: 'app-account-card',
  imports: [NgIcon, HlmAlertImports, HlmAvatarImports, HlmCardImports, HlmDropdownMenuImports],
  providers: [provideIcons({ lucideLoader2, lucidePencil })],
  template: `
    <section hlmCard aria-label="Profile">
      <div hlmCardContent class="flex flex-col gap-4">
        <div class="flex items-center gap-4">
          <input #file type="file" accept="image/png,image/jpeg,image/webp" class="hidden" tabindex="-1" aria-hidden="true" (change)="upload(file)" />
          <button
            type="button"
            class="focus-visible:ring-ring/50 relative shrink-0 rounded-full outline-none focus-visible:ring-[3px]"
            aria-label="Change profile picture"
            [disabled]="user.busy()"
            [hlmDropdownMenuTrigger]="picMenu"
            align="start"
          >
            <hlm-avatar class="size-16">
              @if (user.avatar(); as src) {
                <img hlmAvatarImage [src]="src" alt="" />
              }
              <span hlmAvatarFallback class="text-lg">{{ user.initials() }}</span>
            </hlm-avatar>
            <span class="bg-background hover:bg-muted absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center rounded-full border leading-none shadow-xs" aria-hidden="true">
              @if (user.busy()) {
                <!-- A square icon box spinning about its own centre; the spinner component's font-sized icon overflows a smaller host and wobbles. -->
                <ng-icon name="lucideLoader2" size="12px" class="block size-3 leading-none [transform-origin:center] motion-safe:animate-spin" />
              } @else {
                <ng-icon name="lucidePencil" size="12px" class="block size-3 leading-none" />
              }
            </span>
          </button>
          <div class="grid min-w-0 gap-0.5">
            <h2 class="truncate text-lg font-semibold tracking-tight">{{ user.name() }}</h2>
            <p class="text-muted-foreground truncate text-sm">
              {{ user.email() }}
              <!-- Sign-in needs a confirmed address, so an unconfirmed one shows no label rather than a warning nobody can act on here. -->
              @if (user.email() && user.emailConfirmed()) {
                · <span class="text-green-700 dark:text-green-400">Confirmed</span>
              }
            </p>
          </div>
        </div>

        @if (picError()) {
          <div hlmAlert variant="destructive" role="alert">
            <p hlmAlertDescription>{{ picError() }}</p>
          </div>
        }
      </div>
    </section>

    <ng-template #picMenu>
      <hlm-dropdown-menu class="min-w-44">
        <button hlmDropdownMenuItem type="button" (click)="file.click()">Upload a picture…</button>
        @if (user.avatar()) {
          <button hlmDropdownMenuItem type="button" variant="destructive" (click)="user.removeAvatar()">Remove</button>
        }
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class AccountCard {
  protected readonly user = inject(UserStore);
  protected readonly picError = signal<string | null>(null);

  protected upload(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 2_000_000) {
      this.picError.set('The picture must be at most 2 MB.');
      return;
    }
    this.picError.set(null);
    this.user.uploadAvatar(file);
  }
}
