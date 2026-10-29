import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { OneNoteResource } from '../../stores/onenote.model';
import { OneNoteStore } from '../../stores/onenote.store';
import { buildPageDoc, imageIds } from './page-html';

const CONCURRENCY = 4;

/**
 * Shows page markup in a sandboxed iframe (no scripts, no same-origin, CSP allows only inline styles and data: images).
 * Every image is first fetched through the authenticated proxy and turned into a data: URL, so the CSP never has to allow a network source.
 */
@Component({
  selector: 'app-onenote-body',
  imports: [HlmSkeletonImports],
  template: `
    @if (loading()) {
      <div class="flex flex-col gap-2 p-4" role="status" aria-label="Loading page content">
        <hlm-skeleton class="h-5 w-2/3" />
        <hlm-skeleton class="h-4 w-full" />
        <hlm-skeleton class="h-4 w-11/12" />
        <hlm-skeleton class="h-32 w-1/2" />
      </div>
    } @else {
      <iframe
        [attr.title]="title()"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        class="h-full min-h-0 w-full flex-1 rounded-md border bg-white"
        [srcdoc]="doc()"
      ></iframe>
    }
  `,
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class OneNoteBody {
  private readonly store = inject(OneNoteStore);
  private readonly sanitizer = inject(DomSanitizer);

  readonly html = input.required<string>();
  readonly width = input(0);
  readonly height = input(0);
  readonly resources = input<readonly OneNoteResource[]>([]);
  readonly title = input('Page content');

  protected readonly loading = signal(true);
  private readonly images = signal<Record<string, string>>({});
  private seq = 0;

  protected readonly doc = computed(() =>
    // Built here from sanitised markup; Angular would otherwise strip the meta and style tags the CSP depends on.
    this.sanitizer.bypassSecurityTrustHtml(buildPageDoc(this.html(), this.width(), this.height(), this.images())),
  );

  constructor() {
    effect(() => {
      const html = this.html();
      const ids = imageIds(html, this.resources());
      untracked(() => void this.fetchImages(ids));
    });
  }

  private async fetchImages(ids: string[]): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    const found: Record<string, string> = {};
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const url = await this.store.imageDataUrl(id);
        if (url) found[id] = url;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    if (seq !== this.seq) return;
    this.images.set(found);
    this.loading.set(false);
  }
}
