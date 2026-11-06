import { Component, computed, inject, input, model, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { ProofMode, proofMode } from '../../core/signed-in-at';
import { AuthStore } from '../../stores/auth.store';
import { SecurityStore } from '../../stores/security.store';
import { UserStore } from '../../stores/user.store';

/** The proof part of a settings dialog. `resume` is the settings action to reopen after signing in again. */
@Component({
  selector: 'app-proof',
  imports: [HlmButton, HlmFieldImports, HlmInput],
  template: `
    @switch (mode()) {
      @case ('password') {
        <div hlmField>
          <label hlmFieldLabel [for]="inputId()">Current password</label>
          <div class="relative">
            <input
              hlmInput
              class="w-full pr-16"
              [id]="inputId()"
              [type]="shown() ? 'text' : 'password'"
              autocomplete="current-password"
              data-autofocus
              [value]="password()"
              (input)="password.set($any($event.target).value)"
            />
            <button hlmBtn type="button" variant="ghost" size="sm" class="absolute top-1/2 right-1 h-7 -translate-y-1/2 px-2 text-xs" [attr.aria-pressed]="shown()" (click)="shown.set(!shown())">
              {{ shown() ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>
      }
      @case ('reauth') {
        <div class="flex flex-col gap-3 rounded-lg border p-4">
          <p class="text-muted-foreground text-sm">To {{ what() }}, confirm it's you by signing in again. You come straight back here.</p>
          @if (provider(); as p) {
            <button hlmBtn type="button" variant="outline" class="w-full" data-autofocus (click)="reauth(p.key)">Continue with {{ p.name }}</button>
          } @else {
            <p class="text-sm">Sign out and sign in again, then try once more.</p>
          }
        </div>
      }
    }
  `,
})
export class Proof {
  private readonly auth = inject(AuthStore);
  private readonly security = inject(SecurityStore);
  private readonly user = inject(UserStore);

  readonly what = input.required<string>();
  readonly resume = input.required<string>();
  readonly inputId = input('proof-password');
  readonly password = model('');
  protected readonly shown = signal(false);

  /** Read once per dialog: the dialog is rebuilt each time it opens. */
  readonly mode = computed<ProofMode>(() => proofMode(this.user.hasPassword()));
  protected readonly provider = computed(() => this.security.linkedRows()[0] ?? null);

  /** True when the action can be sent as it stands. */
  readonly ready = computed(() => this.mode() === 'none' || (this.mode() === 'password' && this.password().length > 0));

  protected reauth(provider: string): void {
    void this.auth.reauthenticate(provider, `/settings?resume=${encodeURIComponent(this.resume())}`);
  }
}
