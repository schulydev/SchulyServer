import { t } from '../core/i18n';
import { Component, input, model } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSearch } from '@ng-icons/lucide';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';

/** Compact search input with a leading search icon. */
@Component({
  selector: 'app-search-field',
  imports: [HlmInputGroupImports, NgIcon],
  providers: [provideIcons({ lucideSearch })],
  template: `
    <hlm-input-group class="w-44 sm:w-60">
      <input
        hlmInputGroupInput
        type="search"
        [placeholder]="placeholder()"
        [attr.aria-label]="label()"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
      />
      <hlm-input-group-addon>
        <ng-icon name="lucideSearch" aria-hidden="true" />
      </hlm-input-group-addon>
    </hlm-input-group>
  `,
})
export class SearchField {
  readonly value = model('');
  readonly label = input.required<string>();
  readonly placeholder = input(t('common.search'));
}
