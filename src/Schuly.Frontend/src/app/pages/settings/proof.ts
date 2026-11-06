import { Component, computed, inject, input, model } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { ProofMode, proofMode } from '../../core/signed-in-at';
import { PasswordField } from '../../shared/password-field';
import { AuthStore } from '../../stores/auth.store';
import { SecurityStore } from '../../stores/security.store';
import { UserStore } from '../../stores/user.store';

/**
 * The proof part of a settings dialog. `reason` is the translated sentence that says why ("To delete your
 * account, …"); `resume` is the settings action to reopen after signing in again.
 */
@Component({
  selector: 'app-proof',
  imports: [HlmButton, HlmFieldImports, PasswordField, TranslatePipe],
  template: `
    @switch (mode()) {
      @case ('password') {
        <div hlmField>
          <label hlmFieldLabel [for]="inputId()">{{ 'settings.proof.currentPassword' | translate }}</label>
          <app-password-field [inputId]="inputId()" fieldName="current-password" autocomplete="current-password" [autofocus]="true" [(value)]="password" />
        </div>
      }
      @case ('reauth') {
        <div class="flex flex-col gap-3 rounded-lg border p-4">
          <p class="text-muted-foreground text-sm">{{ reason() }}</p>
          @if (provider(); as p) {
            <button hlmBtn type="button" variant="outline" class="w-full" data-autofocus (click)="reauth(p.key)">{{ 'settings.proof.continueWith' | translate: { name: p.name } }}</button>
          } @else {
            <p class="text-sm">{{ 'settings.proof.signOutAndIn' | translate }}</p>
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

  readonly reason = input.required<string>();
  readonly resume = input.required<string>();
  /** Stable, so password managers recognise the field; only one dialog is open at a time. */
  readonly inputId = input('current-password');
  readonly password = model('');

  /** Read once per dialog: the dialog is rebuilt each time it opens. */
  readonly mode = computed<ProofMode>(() => proofMode(this.user.hasPassword()));
  protected readonly provider = computed(() => this.security.linkedRows()[0] ?? null);

  /** True when the action can be sent as it stands. */
  readonly ready = computed(() => this.mode() === 'none' || (this.mode() === 'password' && this.password().length > 0));

  protected reauth(provider: string): void {
    void this.auth.reauthenticate(provider, `/settings?resume=${encodeURIComponent(this.resume())}`);
  }
}
