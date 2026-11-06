import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, OnDestroy, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCopy } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';

/** Read-only text (a URL, a command or a config file) with its own Copy button and a screen reader confirmation. */
@Component({
  selector: 'app-copy-block',
  imports: [TranslatePipe, HlmButton, HlmInput, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideCopy })],
  template: `
    @if (single()) {
      <div class="flex items-center gap-2">
        <input hlmInput readonly class="min-w-0 flex-1 font-mono text-sm" [value]="text()" [attr.aria-label]="label()" />
        <button hlmBtn variant="outline" type="button" [attr.aria-label]="buttonName()" (click)="copy()">
          <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" aria-hidden="true" />
          {{ copied() ? ('common.copied' | translate) : ('common.copy' | translate) }}
        </button>
      </div>
    } @else {
      <div class="relative">
        <pre
          class="bg-muted text-foreground max-h-72 overflow-auto rounded-lg border p-3 pr-24 font-mono text-xs leading-relaxed"
          tabindex="0"
          role="region"
          [attr.aria-label]="label()"
        ><code>{{ text() }}</code></pre>
        <button
          hlmBtn
          variant="outline"
          size="sm"
          type="button"
          class="absolute top-2 right-2"
          [attr.aria-label]="buttonName()"
          (click)="copy()"
        >
          <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" aria-hidden="true" />
          {{ copied() ? ('common.copied' | translate) : ('common.copy' | translate) }}
        </button>
      </div>
    }
    <span class="sr-only" role="status" aria-live="polite">{{ status() }}</span>
  `,
})
export class CopyBlock implements OnDestroy {
  readonly text = input.required<string>();
  /** Names the text for assistive technology, e.g. "Server URL". */
  readonly label = input.required<string>();
  readonly single = input(false);

  protected readonly copied = signal(false);
  protected readonly status = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected buttonName(): string {
    return this.copied() ? t('common.copied') : t('shared.copyLabel', { label: this.label() });
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
      this.copied.set(true);
      this.status.set(t('shared.copiedTo', { label: this.label() }));
    } catch {
      this.status.set(t('shared.copyFailed'));
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.copied.set(false);
      this.status.set('');
    }, 2000);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
