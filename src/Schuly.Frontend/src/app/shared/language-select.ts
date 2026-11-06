import { Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageStore } from '../core/i18n';

/** The app language, as a native select: names stay in their own language so anyone finds theirs. */
@Component({
  selector: 'app-language-select',
  imports: [TranslatePipe],
  template: `
    <label class="inline-flex items-center gap-2 text-sm">
      <span [class.sr-only]="!showLabel()">{{ 'common.language' | translate }}</span>
      <select
        class="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px]"
        [value]="store.current()"
        (change)="store.use($any($event.target).value)"
      >
        @for (language of store.languages; track language.code) {
          <option [value]="language.code" [attr.lang]="language.code" [selected]="language.code === store.current()">{{ language.label }}</option>
        }
      </select>
    </label>
  `,
})
export class LanguageSelect {
  protected readonly store = inject(LanguageStore);
  readonly showLabel = input(false);
}
