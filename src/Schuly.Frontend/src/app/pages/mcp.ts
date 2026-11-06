import { TranslatePipe } from '@ngx-translate/core';
import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCollapsibleImports } from '@spartan-ng/helm/collapsible';
import { mcpUrl } from '../core/mcp-clients';
import { CopyBlock } from '../shared/copy-block';
import { McpClientsCard } from './mcp/mcp-clients-card';
import { McpConnectionsCard } from './mcp/mcp-connections-card';
import { McpKeysCard } from './mcp/mcp-keys-card';

@Component({
  selector: 'app-mcp',
  imports: [TranslatePipe, HlmButton, HlmCardImports, HlmCollapsibleImports, NgIcon, CopyBlock, McpClientsCard, McpConnectionsCard, McpKeysCard],
  providers: [provideIcons({ lucideChevronDown })],
  template: `
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 lg:p-6">
      <p class="text-muted-foreground text-sm">
        {{ 'mcp.intro' | translate }}
      </p>

      <section hlmCard>
        <div hlmCardHeader>
          <h2 hlmCardTitle>{{ 'mcp.serverUrl' | translate }}</h2>
          <p hlmCardDescription>{{ 'mcp.serverUrlHint' | translate }}</p>
        </div>
        <div hlmCardContent>
          <app-copy-block [text]="url" [label]="'mcp.serverUrl' | translate" [single]="true" />
        </div>
      </section>

      <app-mcp-clients-card />
      <app-mcp-connections-card />
      <app-mcp-keys-card />

      <section hlmCard>
        <hlm-collapsible>
          <div hlmCardHeader>
            <h2 hlmCardTitle>
              <button hlmCollapsibleTrigger hlmBtn variant="ghost" class="-ml-2.5 text-base font-semibold">
                {{ 'mcp.troubleshooting' | translate }}
                <ng-icon name="lucideChevronDown" aria-hidden="true" />
              </button>
            </h2>
          </div>
          <hlm-collapsible-content>
            <div hlmCardContent>
              <ul class="flex list-disc flex-col gap-2 ps-5 text-sm">
                <li>
                  {{ 'mcp.trouble.reset' | translate }}
                </li>
                <li>{{ 'mcp.trouble.restart' | translate }}</li>
                <li>
                  {{ 'mcp.trouble.login' | translate }}
                </li>
                <li>
                  {{ 'mcp.trouble.keyName' | translate }}
                </li>
                <li>{{ 'mcp.trouble.cloud' | translate }}</li>
                <li>{{ 'mcp.trouble.revoked' | translate }}</li>
                <li>
                  {{ 'mcp.trouble.missingTool' | translate }}
                </li>
              </ul>
            </div>
          </hlm-collapsible-content>
        </hlm-collapsible>
      </section>
    </div>
  `,
})
export class Mcp {
  protected readonly url = mcpUrl(inject(DOCUMENT).location.origin);
}
