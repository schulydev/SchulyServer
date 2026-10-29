import { OneNoteResource } from '../../stores/onenote.model';

const REMOVED =
  'script, iframe, frame, frameset, object, embed, applet, form, link, meta, base, noscript, template, style, audio, video, source, track, picture, svg script, svg foreignObject, svg use, svg image, svg a, svg animate, svg set';

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);/i;

/** Ids of every image the page needs: the declared image resources plus any img that names one. */
export function imageIds(html: string, resources: readonly OneNoteResource[]): string[] {
  const ids = new Set(resources.filter((r) => r.kind === 'image').map((r) => r.id));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img[data-resource]').forEach((img) => ids.add(img.getAttribute('data-resource') ?? ''));
  ids.delete('');
  return [...ids];
}

/**
 * Makes the server's page markup safe to show and gives every image its data: URL. The sandbox and the CSP of the iframe are the real guard;
 * this is the second layer: nothing active survives and no src points anywhere but at a data: image.
 */
export function preparePageHtml(html: string, images: ReadonlyMap<string, string> | Record<string, string>): string {
  const lookup = (id: string): string | undefined => (images instanceof Map ? images.get(id) : (images as Record<string, string>)[id]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(REMOVED).forEach((el) => el.remove());
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcset' || name === 'background' || name === 'poster' || name === 'ping') {
        el.removeAttribute(attr.name);
      } else if (name === 'style' && /url\s*\(|expression\s*\(|@import/i.test(attr.value)) {
        el.setAttribute(attr.name, attr.value.replace(/url\s*\([^)]*\)|expression\s*\([^)]*\)|@import[^;]*/gi, ''));
      } else if ((name === 'href' || name === 'xlink:href' || name === 'action') && !/^\s*(https?:|mailto:|#)/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      } else if (name === 'src' && el.tagName !== 'IMG') {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('target', '_blank');
    }
  }
  for (const img of Array.from(doc.body.querySelectorAll('img'))) {
    const id = img.getAttribute('data-resource') ?? '';
    const url = id ? lookup(id) : undefined;
    img.removeAttribute('src');
    if (url && DATA_IMAGE.test(url)) {
      img.setAttribute('src', url);
    } else {
      const missing = doc.createElement('span');
      missing.className = 'on-missing';
      missing.textContent = img.getAttribute('alt')?.trim() || 'Image unavailable';
      img.replaceWith(missing);
    }
  }
  return doc.body.innerHTML;
}

const PAGE_STYLE =
  'html{color-scheme:light}' +
  'body{margin:0;padding:16px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a;background:#fff;overflow-wrap:anywhere}' +
  '.canvas{position:relative}' +
  'img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #c8c8c8;padding:2px 6px;vertical-align:top}' +
  'pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,Consolas,monospace;margin:0}a{color:#0b57d0}' +
  'p{margin:0 0 .4em}h1,h2,h3,h4,h5,h6{margin:.3em 0 .3em;line-height:1.25}' +
  '.on-missing{display:inline-block;padding:2px 8px;border:1px dashed #6b6b6b;border-radius:4px;color:#4a4a4a;font-size:13px}' +
  '.on-file{display:inline-block;padding:2px 8px;border:1px solid #c8c8c8;border-radius:4px;background:#f3f3f3;color:#1a1a1a;font-size:13px}' +
  '.on-ink{pointer-events:none;overflow:visible}' +
  '[data-tag^="to-do"]::before{content:"";display:inline-block;box-sizing:border-box;width:.95em;height:.95em;margin-inline-end:.45em;vertical-align:-.12em;border:1.5px solid #4a4a4a;border-radius:3px;background:#fff}' +
  '[data-tag="to-do:completed"]::before{background:#0b57d0 url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M3.5 8.5l3 3 6-7%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27/%3E%3C/svg%3E") center/100% no-repeat;border-color:#0b57d0}' +
  '[data-tag="to-do:completed"]{color:#4a4a4a}';

/** The complete srcdoc for a page: CSP first, a light document style, and positioned content inside a canvas sized to the page extent. */
export function buildPageDoc(html: string, width: number, height: number, images: ReadonlyMap<string, string> | Record<string, string>): string {
  const body = preparePageHtml(html, images);
  const sized = width > 0 && height > 0;
  const canvas = sized
    ? `<div class="canvas" style="width:${Math.round(width)}px;height:${Math.round(height)}px">${body}</div>`
    : `<div class="canvas">${body}</div>`;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(PAGE_CSP)}">` +
    `<base target="_blank"><style>${PAGE_STYLE}</style></head><body>${canvas}</body></html>`
  );
}

/* ---------- editing ---------- */

const EDIT_TAGS = new Set([
  'P', 'BR', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'A', 'UL', 'OL', 'LI',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'PRE', 'CODE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
]);
const DROPPED = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'IMG']);
const SAFE_LINK = /^\s*(https?:|mailto:)/i;

/** Copies the allowed text markup into a fresh element of the parsed document; everything else is unwrapped or dropped. Only href and data-tag survive. */
function copyAllowed(source: Node, target: Node, doc: Document): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (DROPPED.has(el.tagName.toUpperCase())) continue;
      if (!EDIT_TAGS.has(el.tagName)) {
        copyAllowed(el, target, doc);
        continue;
      }
      const copy = doc.createElement(el.tagName.toLowerCase());
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (SAFE_LINK.test(href)) {
          copy.setAttribute('href', href);
          copy.setAttribute('rel', 'noopener noreferrer');
        }
      }
      const tag = el.getAttribute('data-tag');
      if (tag && /^to-do(:completed)?$/.test(tag)) copy.setAttribute('data-tag', tag);
      copyAllowed(el, copy, doc);
      target.appendChild(copy);
    }
  }
}

/** A sanitized copy of editable markup, still in the parser's document; import it before inserting it into the page. */
export function sanitizeEditorHtml(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const clean = doc.createElement('div');
  copyAllowed(doc.body, clean, doc);
  return clean;
}

/** The canonical string form of editable markup; used to compare against what an editor holds now. */
export function normalizeEditorHtml(html: string): string {
  return sanitizeEditorHtml(html).innerHTML.trim();
}

/** Plain text of markup, to tell an empty editor from one with content. */
export function editorText(html: string): string {
  return (sanitizeEditorHtml(html).textContent ?? '').trim();
}
