import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';

// Only the sign-in and register pages may show up in search; everything else is behind a login or a one-off link.
const INDEXABLE = new Set(['/login', '/register']);

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HlmToasterImports],
  template: `
    <router-outlet />
    <hlm-toaster />
  `,
})
export class App {
  constructor() {
    const meta = inject(Meta);
    inject(Router).events.subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      const path = e.urlAfterRedirects.split(/[?#]/)[0];
      meta.updateTag({ name: 'robots', content: INDEXABLE.has(path) ? 'index, follow' : 'noindex, nofollow' });
    });
  }
}
