import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { HlmButton } from '@spartan-ng/helm/button';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImage } from '@ng-icons/lucide';
import { normalizeCid } from '../stores/mail-client';

const REMOVED = 'script, iframe, frame, frameset, object, embed, applet, form, link, meta, base, noscript, template, svg script';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Prepared {
  html: string;
  remote: boolean;
}

/**
 * Strips everything active from a message and notes whether it points at remote images. The iframe's sandbox and CSP are the real guard; this is a second layer.
 * `cid:` images are swapped for the data: URLs in `inline` (normalised Content-ID -> data URL); ones without a match lose their src so only the alt text shows.
 */
export function prepareMailBody(source: string, isHtml: boolean, inline: Record<string, string> = {}): Prepared {
  if (!isHtml) return { html: `<pre>${escapeHtml(source)}</pre>`, remote: false };
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll(REMOVED).forEach((el) => el.remove());
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'action' || name === 'xlink:href') && /^\s*(javascript|vbscript|data:text\/html)/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') el.setAttribute('rel', 'noopener noreferrer');
    if (el.tagName === 'IMG' && /^\s*cid:/i.test(el.getAttribute('src') ?? '')) {
      const url = inline[normalizeCid(el.getAttribute('src'))];
      if (url && url.startsWith('data:image/')) el.setAttribute('src', url);
      else el.removeAttribute('src');
    }
  }
  const remote =
    doc.querySelectorAll('img[src^="http"], img[srcset], [background^="http"], image').length > 0 ||
    /url\(\s*['"]?\s*https?:/i.test(doc.documentElement.innerHTML);
  return { html: doc.body.innerHTML, remote };
}

/**
 * Renders a message body in a sandboxed iframe: no scripts, no same-origin access, and a CSP that allows nothing but inline styles and,
 * once the reader chooses, remote images. Remote images are blocked behind a t('mail.showImages') bar because they tell the sender you read the mail.
 */
@Component({
  selector: 'app-mail-body',
  imports: [TranslatePipe, HlmButton, NgIcon],
  providers: [provideIcons({ lucideImage })],
  template: `
    @if (prepared().remote && !showImages()) {
      <div class="bg-muted/60 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
        <ng-icon name="lucideImage" aria-hidden="true" />
        <span class="min-w-0 flex-1">{{ 'mail.imagesBlocked' | translate }}</span>
        <button hlmBtn type="button" size="sm" variant="outline" (click)="showImages.set(true)">{{ 'mail.showImages' | translate }}</button>
      </div>
    }
    <iframe
      [title]="'mail.content' | translate"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      class="min-h-0 w-full flex-1 rounded-md border bg-white"
      [srcdoc]="doc()"
    ></iframe>
  `,
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col gap-2' },
})
export class MailBody {
  private readonly sanitizer = inject(DomSanitizer);

  readonly body = input.required<string>();
  readonly html = input(true);
  /** Inline images by normalised Content-ID, as data: URLs. */
  readonly inline = input<Record<string, string>>({});

  protected readonly showImages = linkedSignal<string, boolean>({ source: this.body, computation: () => false });
  protected readonly prepared = computed(() => {
    this.body();
    return prepareMailBody(this.body(), this.html(), this.inline());
  });

  protected readonly doc = computed(() => {
    const images = this.showImages() ? ' https: http:' : '';
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${images}; font-src data:`;
    const page =
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<base target="_blank"><style>` +
      `html{color-scheme:light}body{margin:0;padding:16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a;background:#fff;overflow-wrap:anywhere}` +
      `img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap;font:inherit;margin:0}a{color:#0b57d0}` +
      `</style></head><body>${this.prepared().html}</body></html>`;
    // Built entirely here from sanitised markup; Angular would otherwise strip the meta and style tags the CSP depends on.
    return this.sanitizer.bypassSecurityTrustHtml(page);
  });
}
