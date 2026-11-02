import { describe, expect, it } from 'vitest';
import { buildPageDoc, editorText, imageIds, normalizeEditorHtml, preparePageHtml, sanitizeEditorHtml } from './page-html';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('preparePageHtml', () => {
  it('gives matching images a data: src', () => {
    const html = preparePageHtml('<img data-resource="r1" alt="cat" width="10" height="10">', { r1: PNG });
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
    expect(img?.getAttribute('src')).toBe(PNG);
  });

  it('replaces images that failed with their alt text', () => {
    const html = preparePageHtml('<img data-resource="r2" alt="A diagram">', {});
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('.on-missing')?.textContent).toBe('A diagram');
  });

  it('never keeps a src that is not a data: image', () => {
    const html = preparePageHtml(
      '<img data-resource="r1" src="https://evil.test/x.png"><img src="https://evil.test/y.png"><img data-resource="r3">',
      { r1: 'https://evil.test/z.png', r3: 'data:text/html;base64,AAAA' },
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const el of Array.from(doc.querySelectorAll('[src]'))) expect(el.getAttribute('src')).toMatch(/^data:image\//);
    expect(doc.querySelectorAll('img').length).toBe(0);
  });

  it('removes scripts, event handlers and script URLs', () => {
    const html = preparePageHtml(
      '<p onclick="x()" style="background:url(https://evil.test/a)">hi</p><script>alert(1)</script><iframe src="https://e.test"></iframe>' +
        '<a href="javascript:alert(1)">bad</a><a href="https://ok.test">ok</a><svg onload="x()"><script>1</script><path d="M0 0"/></svg>',
      {},
    );
    expect(html).not.toMatch(/<script|<iframe|onclick|onload|javascript:|evil\.test/i);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('a[href="https://ok.test"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(doc.querySelector('path')).not.toBeNull();
  });
});

describe('buildPageDoc', () => {
  it('has the CSP first, sizes the canvas and keeps positioned items', () => {
    const doc = buildPageDoc('<div style="position:absolute;left:10px;top:20px">x</div>', 800, 600, {});
    expect(doc).toContain("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<style>'));
    expect(doc).toContain('class="canvas" style="width:800px;height:600px"');
    expect(doc).toContain('position:absolute;left:10px;top:20px');
  });

  it('does not fix the size when nothing is positioned', () => {
    expect(buildPageDoc('<p>x</p>', 0, 0, {})).toContain('<div class="canvas"><p>x</p>');
  });
});

describe('imageIds', () => {
  it('collects declared image resources and img references once', () => {
    const ids = imageIds('<img data-resource="a"><img data-resource="b">', [
      { id: 'a', kind: 'image', name: null, contentType: null },
      { id: 'f', kind: 'file', name: 'x.pdf', contentType: null },
    ]);
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});

describe('editor html', () => {
  it('keeps text formatting and drops everything active', () => {
    const html = normalizeEditorHtml(
      '<p onclick="x()">a <b>b</b><script>x</script><img src="https://e.test/i.png"><a href="javascript:x()">l</a><a href="https://ok.test">ok</a></p>',
    );
    expect(html).not.toMatch(/script|onclick|img|javascript/i);
    expect(html).toContain('<b>b</b>');
    expect(html).toContain('href="https://ok.test"');
  });

  it('is stable when applied twice', () => {
    const once = normalizeEditorHtml('<div>x <a href="https://a.test">y</a></div><ul><li>1</li></ul>');
    expect(normalizeEditorHtml(once)).toBe(once);
  });

  it('unwraps unknown tags and reports text', () => {
    expect(sanitizeEditorHtml('<section><p>kept</p></section>').innerHTML).toBe('<p>kept</p>');
    expect(editorText('<p> </p><br>')).toBe('');
    expect(editorText('<p>x</p>')).toBe('x');
  });
});
