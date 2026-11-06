import { TranslatePipe } from '@ngx-translate/core';
import { Component, computed, input } from '@angular/core';

/** Monospace text with a line-number gutter that is neither selectable nor read out. */
@Component({
  selector: 'app-viewer-text',
  imports: [TranslatePipe],
  template: `
    <div class="bg-background min-h-0 flex-1 overflow-auto" tabindex="0" data-viewer-keys [attr.aria-label]="'Contents of ' + label()">
      <div class="flex min-w-max font-mono text-[13px] leading-5">
        <pre class="bg-muted text-muted-foreground sticky left-0 shrink-0 py-3 ps-3 pe-3 text-right select-none" aria-hidden="true">{{ gutter() }}</pre>
        <pre class="py-3 ps-4 pe-4">{{ text() }}</pre>
      </div>
      @if (truncated()) {
        <p class="text-muted-foreground bg-background sticky bottom-0 left-0 border-t px-4 py-2 text-xs" role="status">
          {{ 'shared.viewer.someText' | translate }}
        </p>
      }
    </div>
  `,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class ViewerText {
  readonly text = input.required<string>();
  readonly label = input('file');
  readonly truncated = input(false);

  protected readonly gutter = computed(() => {
    const n = this.text().replace(/\n$/, '').split('\n').length;
    let out = '1';
    for (let i = 2; i <= n; i++) out += '\n' + i;
    return out;
  });
}
