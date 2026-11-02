import { Marked } from 'marked';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Raw HTML in the model output is shown as text, never parsed. Angular's [innerHTML] sanitizer is the second layer.
const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    // Remote images are fetched by the browser without a click (prompt-injection exfiltration), so none is ever emitted.
    image: ({ text }) => `<span>[image${text ? `: ${escapeHtml(text)}` : ''}]</span>`,
  },
});

/**
 * Renders assistant Markdown to HTML for `[innerHTML]` (Angular sanitizes it again; never bypass that).
 * Images are never rendered, only http(s)/mailto links survive (opened in a new tab), tables are wrapped so they scroll horizontally.
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  const html = marked.parse(source) as string;
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  root.querySelectorAll('a').forEach(hardenLink);
  root.querySelectorAll('table').forEach((table) => {
    const wrap = root.ownerDocument.createElement('div');
    wrap.className = 'table-scroll';
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Table');
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
  return root.innerHTML;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function parseHref(href: string): URL | null {
  try {
    const url = new URL(href);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null; // relative and protocol-relative links do not parse without a base
  }
}

/** Keeps only http(s)/mailto links, opens them safely, and shows where they really go when the text says otherwise. */
function hardenLink(a: HTMLAnchorElement): void {
  const href = (a.getAttribute('href') ?? '').trim();
  const url = parseHref(href);
  if (!url) {
    a.replaceWith(a.ownerDocument.createTextNode(a.textContent ?? ''));
    return;
  }
  a.setAttribute('href', url.href);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer nofollow');
  const destination = url.protocol === 'mailto:' ? decodeURIComponent(url.pathname) : url.hostname;
  a.setAttribute('title', destination);
  const bare = (value: string) => value.trim().replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/$/, '');
  const text = bare(a.textContent ?? '');
  if (text !== bare(href) && text !== bare(url.href)) {
    const label = a.ownerDocument.createElement('span');
    label.className = 'text-muted-foreground text-xs';
    label.textContent = ` (${destination})`;
    a.after(label);
  }
}
