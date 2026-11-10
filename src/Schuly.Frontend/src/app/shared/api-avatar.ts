import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { apiImageSource } from '../core/api-image';
import { initials } from '../core/initials';

/**
 * A person's picture from the API with an initials fallback. API pictures need the sign-in, so they are loaded with the
 * authenticated HttpClient into an object URL, which is revoked when the picture changes or the avatar goes away.
 * Size it with a class on the host, e.g. `class="size-10"`.
 */
@Component({
  selector: 'app-api-avatar',
  imports: [HlmAvatarImports],
  template: `
    <hlm-avatar class="size-full">
      @if (url(); as src) {
        <img [src]="src" [alt]="alt()" decoding="async" class="size-full rounded-full object-cover" (error)="url.set(null)" />
      } @else {
        <span hlmAvatarFallback [class]="fallbackClass()">{{ letters() }}</span>
      }
    </hlm-avatar>
  `,
  host: { class: 'inline-flex size-8 shrink-0' },
})
export class ApiAvatar {
  private readonly http = inject(HttpClient);

  readonly src = input<string | null | undefined>(null);
  /** The name the initials come from. */
  readonly name = input<string | null | undefined>('');
  /** Alternative text of the picture; empty when the name is written next to it. */
  readonly alt = input('');
  readonly fallbackClass = input('');

  protected readonly url = signal<string | null>(null);
  protected readonly letters = computed(() => initials(this.name()) || '?');

  constructor() {
    effect((onCleanup) => {
      const source = apiImageSource(this.src());
      if (source.kind !== 'fetch') {
        this.url.set(source.kind === 'direct' ? source.url : null);
        return;
      }

      this.url.set(null);
      let objectUrl: string | null = null;
      const request = this.http.get(source.url, { responseType: 'blob' }).subscribe({
        next: (blob) => {
          if (!blob.size || !blob.type.startsWith('image/')) return;
          objectUrl = URL.createObjectURL(blob);
          this.url.set(objectUrl);
        },
        // No picture, or not allowed to see it: the initials stay.
        error: () => undefined,
      });
      onCleanup(() => {
        request.unsubscribe();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      });
    });
  }
}
