import { Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { LanguageStore } from '../core/i18n';

let nextId = 0;

/**
 * The app language, in the same select as the rest of the app (Grades' semester picker): a check on the
 * current one and keyboard support. Names stay in their own language so anyone finds theirs.
 */
@Component({
  selector: 'app-language-select',
  imports: [HlmSelectImports, TranslatePipe],
  host: { class: 'flex items-center gap-3' },
  template: `
    <label class="text-sm" [class.sr-only]="!showLabel()" [for]="id">{{ 'common.language' | translate }}</label>
    <hlm-select [class]="showLabel() ? 'ml-auto w-40' : 'w-36'" [value]="store.current()" [itemToString]="label" (valueChange)="choose($event)">
      <hlm-select-trigger [buttonId]="id" class="w-full" [size]="size()">
        <hlm-select-value />
      </hlm-select-trigger>
      <hlm-select-content *hlmSelectPortal>
        <hlm-select-group>
          @for (language of store.languages; track language.code) {
            <hlm-select-item [value]="language.code" [attr.lang]="language.code">{{ language.label }}</hlm-select-item>
          }
        </hlm-select-group>
      </hlm-select-content>
    </hlm-select>
  `,
})
export class LanguageSelect {
  protected readonly store = inject(LanguageStore);
  readonly showLabel = input(false);
  readonly size = input<'default' | 'sm'>('default');
  protected readonly id = `language-select-${nextId++}`;

  protected readonly label = (code: string | null): string => this.store.languages.find((l) => l.code === code)?.label ?? '';

  protected choose(code: string | null | undefined): void {
    if (code) this.store.use(code as Parameters<LanguageStore['use']>[0]);
  }
}
