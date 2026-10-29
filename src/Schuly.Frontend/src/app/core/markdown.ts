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
  },
});

/**
 * Renders assistant Markdown to HTML for `[innerHTML]` (Angular sanitizes it again; never bypass that).
 * Links open in a new tab, tables are wrapped so they scroll horizontally.
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  const html = marked.parse(source) as string;
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  root.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
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
