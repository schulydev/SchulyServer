import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';
import {
  McpApi,
  McpAuthorizationParameters,
  McpAuthorizationRequestResult,
  authorizationParameters,
  mcpErrorMessage,
  AI_APP_OPT_IN,
} from '../core/mcp-api';
import { McpPermissionSet, schoolDataPreset } from '../core/mcp-permissions';
import { McpPermissionEditor } from '../shared/mcp-permission-editor';

@Component({
  selector: 'app-connect-authorize',
  imports: [HlmAlertImports, HlmButton, HlmCardImports, HlmCheckbox, HlmSpinner, NgIcon, McpPermissionEditor],
  providers: [provideIcons({ lucideTriangleAlert })],
  host: { class: 'bg-sidebar text-foreground flex min-h-svh items-start justify-center p-4 sm:items-center' },
  template: `
    <main class="flex w-full max-w-xl flex-col gap-4 py-6">
      <a href="https://schuly.dev" class="flex items-center gap-2.5 self-center text-base font-semibold tracking-tight">
        <img src="app_icon.png" alt="" class="size-7 rounded-md" />
        <span>Schuly</span>
      </a>

      <section hlmCard>
        @if (loading()) {
          <div hlmCardContent class="flex items-center justify-center gap-2 py-8 text-sm" role="status">
            <hlm-spinner aria-hidden="true" />
            Checking the request...
          </div>
        } @else if (request(); as req) {
          @if (req.valid) {
            <div hlmCardHeader>
              <h1 hlmCardTitle class="text-xl">{{ req.clientName }} wants to access your Schuly account</h1>
              <p hlmCardDescription>
                After you decide you return to
                <strong class="text-foreground font-mono">{{ req.redirectHost }}</strong>.
                @if (req.clientUri) {
                  <span class="block break-all">App website: {{ req.clientUri }}</span>
                }
              </p>
            </div>
            <div hlmCardContent class="flex flex-col gap-4">
              <div hlmAlert>
                <ng-icon name="lucideTriangleAlert" hlmAlertIcon aria-hidden="true" />
                <p hlmAlertDescription>Only approve apps you trust. They can see the data you allow below.</p>
              </div>

              <app-mcp-permission-editor [(value)]="permissions" />

              <label class="flex items-start gap-2 text-sm" for="ai-app-opt-in">
                <hlm-checkbox class="mt-0.5" inputId="ai-app-opt-in" [checked]="optIn()" (checkedChange)="optIn.set($event)" />
                {{ optInText }}
              </label>

              <div aria-live="polite" role="status">
                @if (error()) {
                  <div hlmAlert variant="destructive">
                    <p hlmAlertDescription>{{ error() }}</p>
                  </div>
                }
              </div>

              <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button hlmBtn variant="outline" type="button" [disabled]="submitting()" (click)="decide(false)">
                  Deny
                </button>
                <button hlmBtn type="button" [disabled]="submitting() || !optIn()" [attr.aria-busy]="submitting()" (click)="decide(true)">
                  @if (submitting()) {
                    <hlm-spinner aria-hidden="true" />
                  }
                  Allow
                </button>
              </div>
              <p class="text-muted-foreground text-center text-xs">
                You can change or revoke this later on the MCP page.
              </p>
            </div>
          } @else {
            <div hlmCardHeader>
              <h1 hlmCardTitle class="text-xl">This request can't be approved</h1>
            </div>
            <div hlmCardContent>
              <div hlmAlert variant="destructive" role="alert">
                <p hlmAlertDescription>{{ req.errorDescription || req.error || 'The request is not valid.' }}</p>
              </div>
            </div>
          }
        } @else {
          <div hlmCardHeader>
            <h1 hlmCardTitle class="text-xl">This request can't be approved</h1>
          </div>
          <div hlmCardContent>
            <div hlmAlert variant="destructive" role="alert">
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          </div>
        }
      </section>
    </main>
  `,
})
export class ConnectAuthorize implements OnInit {
  private readonly api = inject(McpApi);
  private readonly route = inject(ActivatedRoute);

  private parameters!: McpAuthorizationParameters;
  protected readonly optInText = AI_APP_OPT_IN;
  protected readonly optIn = signal(false);
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly request = signal<McpAuthorizationRequestResult | null>(null);
  protected readonly permissions = signal<McpPermissionSet>(schoolDataPreset());

  async ngOnInit(): Promise<void> {
    const query = this.route.snapshot.queryParamMap;
    this.parameters = authorizationParameters((name) => query.get(name));
    try {
      const result = await firstValueFrom(this.api.authorizationRequest(this.parameters));
      if (!result.valid && result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      this.request.set(result);
      if (result.valid) this.permissions.set(result.requested);
    } catch (error) {
      this.error.set(mcpErrorMessage(error, 'We could not check this request. Try again from your app.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async decide(approve: boolean): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    try {
      const { redirectUrl } = await firstValueFrom(
        this.api.authorizationDecision({
          parameters: this.parameters,
          approve,
          permissions: approve ? this.permissions() : null,
          aiAppSharingConfirmed: approve && this.optIn(),
        }),
      );
      window.location.assign(redirectUrl);
    } catch (error) {
      this.error.set(mcpErrorMessage(error, 'Something went wrong. Try again.'));
      this.submitting.set(false);
    }
  }
}
