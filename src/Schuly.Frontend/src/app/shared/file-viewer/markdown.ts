import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({
  async: false,
  gfm: true,
  renderer: {
    // Raw HTML inside markdown is shown as text, never interpreted.
    html: ({ text }) => escapeHtml(text),
    // Nothing in a file may trigger a network load: images become their alt text.
    image: ({ text }) => `<span>[Image: ${escapeHtml(text || 'no description')}]</span>`,
  },
});

let hooked = false;
function purifier(): typeof DOMPurify {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return DOMPurify;
}

/** Markdown to HTML that is safe to bind with innerHTML: no scripts, handlers, styles, remote images or non-http(s)/mailto links. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source) as string;
  return purifier().sanitize(html, {
    FORBID_TAGS: ['style', 'img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'src'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  });
}
