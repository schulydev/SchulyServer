import { Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { LinkIconDto } from '../core/linking-api';
import { providerIconName, providerIcons } from '../core/provider-icons';

/** The real logos of the built-in providers, the same ones the app bundles. */
const bundledLogos: Record<string, string> = {
  schulnetz: '/providers/schulnetz.webp',
  odaorg: '/providers/odaorg.webp',
  microsoft: '/sso-icons/microsoft.svg',
};

/** A provider's icon: its Lucide name through ng-icons, or the host-served sanitized SVG through an img. Always decorative: the name is printed beside it. */
@Component({
  selector: 'app-provider-icon',
  imports: [NgIcon],
  providers: [provideIcons(providerIcons)],
  template: `
    @if (svgUrl(); as url) {
      <img [src]="url" alt="" class="size-5 shrink-0 object-contain" />
    } @else {
      <ng-icon [name]="name()" class="size-5 shrink-0" aria-hidden="true" />
    }
  `,
  host: { class: 'inline-flex shrink-0 items-center' },
})
export class ProviderIcon {
  readonly icon = input<LinkIconDto | null | undefined>(null);
  readonly providerId = input<string | null | undefined>(null);
  protected readonly svgUrl = computed(
    () => bundledLogos[this.providerId() ?? ''] ?? (this.icon()?.svgUrl || null),
  );
  protected readonly name = computed(() => providerIconName(this.icon()?.lucide));
}
