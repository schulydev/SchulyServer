import { TranslatePipe } from '@ngx-translate/core';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../core/auth-api';
import { AuthStore } from '../../stores/auth.store';
import { AuthLayout } from './auth-layout';

@Component({
  selector: 'app-verify-email',
  imports: [RouterLink, HlmAlertImports, HlmButton, HlmCardImports, HlmSpinner, AuthLayout, TranslatePipe],
  template: `
    <app-auth-layout [title]="'auth.verifyEmail.title' | translate">
      <section hlmCard>
        <div hlmCardContent>
          @switch (state()) {
            @case ('working') {
              <div class="flex justify-center py-4"><hlm-spinner [attr.aria-label]="'auth.verifyEmail.working' | translate" /></div>
            }
            @case ('done') {
              <div hlmAlert>
                <h4 hlmAlertTitle>{{ 'auth.verifyEmail.done' | translate }}</h4>
                <p hlmAlertDescription>
                  {{ 'auth.verifyEmail.doneHint' | translate }}
                </p>
              </div>
            }
            @case ('failed') {
              <div hlmAlert variant="destructive">
                <h4 hlmAlertTitle>{{ 'auth.verifyEmail.failed' | translate }}</h4>
                <p hlmAlertDescription>
                  {{ 'auth.verifyEmail.failedHint' | translate }}
                </p>
              </div>
            }
          }
        </div>
      </section>
      <a hlmBtn variant="link" [routerLink]="signedIn() ? '/settings' : '/login'">{{
        (signedIn() ? 'auth.verifyEmail.settings' : 'nav.signIn') | translate
      }}</a>
    </app-auth-layout>
  `,
})
export class VerifyEmail implements OnInit {
  readonly token = input<string>();

  private readonly api = inject(AuthApi);
  private readonly auth = inject(AuthStore);
  protected readonly signedIn = computed(() => this.auth.status() === 'signedIn');
  protected readonly state = signal<'working' | 'done' | 'failed'>('working');

  async ngOnInit(): Promise<void> {
    try {
      await firstValueFrom(this.api.verifyEmail(this.token() ?? ''));
      this.state.set('done');
    } catch {
      this.state.set('failed');
    }
  }
}
