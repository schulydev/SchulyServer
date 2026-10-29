import { beforeEach, describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from './csv';
import { canOpenInTab, detect, viewerSupports } from './file-types';
import { renderMarkdown } from './markdown';
import { clearPdfCache, getCachedPdf, pdfCacheSize, putCachedPdf } from './pdf-cache';

const bytes = (s: string) => new TextEncoder().encode(s);
const blobOf = (size: number) => new Blob([new Uint8Array(size)]);
const raw = (...b: number[]) => new Uint8Array(b);

describe('detect', () => {
  it('trusts verified bytes over the name', () => {
    expect(detect('x.txt', bytes('%PDF-1.4\n')).kind).toBe('pdf');
    expect(detect('x.txt', raw(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)).type).toBe('image/png');
  });

  it('decides Office types by extension', () => {
    for (const name of ['a.docx', 'a.DOC', 'a.xlsx', 'a.xls', 'a.pptx', 'a.ppt', 'a.odt', 'a.ods', 'a.odp', 'a.rtf']) {
      expect(detect(name, raw(0x50, 0x4b, 3, 4)).kind, name).toBe('office');
    }
    expect(detect('a.xlsx', new Uint8Array(4)).family).toBe('sheet');
  });

  it('recognises OOXML, ODF and RTF bytes without an extension', () => {
    const zip = (inner: string) => bytes('PK\u0003\u0004' + inner);
    expect(detect('noext', zip('[Content_Types].xml word/document.xml'))).toMatchObject({ kind: 'office', family: 'word' });
    expect(detect('noext', zip('xl/workbook.xml'))).toMatchObject({ kind: 'office', family: 'sheet' });
    expect(detect('noext', zip('mimetypeapplication/vnd.oasis.opendocument.presentation'))).toMatchObject({ kind: 'office', family: 'slides' });
    expect(detect('noext', bytes('{\\rtf1\\ansi')).kind).toBe('office');
  });

  it('never renders html: it is source text and cannot be opened in a tab', () => {
    const d = detect('page.html', bytes('<html><script>alert(1)</script></html>'));
    expect(d).toMatchObject({ kind: 'text', type: 'text/plain', source: true });
    expect(canOpenInTab(d)).toBe(false);
    expect(detect('page.htm', bytes('<p>x</p>')).source).toBe(true);
    expect(detect('x.xhtml', bytes('<p>x</p>')).source).toBe(true);
  });

  it('shows svg only as an image, never opened in a tab', () => {
    const d = detect('a.svg', bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    expect(d).toMatchObject({ kind: 'image', type: 'image/svg+xml' });
    expect(canOpenInTab(d)).toBe(false);
    expect(detect('a.svg', bytes('<html></html>')).kind).toBe('none');
  });

  it('types media from the extension and magic bytes', () => {
    expect(detect('a.mp3', bytes('ID3\u0004')).type).toBe('audio/mpeg');
    expect(detect('a.wav', bytes('RIFF\u0000\u0000\u0000\u0000WAVE')).type).toBe('audio/wav');
    expect(detect('a.mov', bytes('\u0000\u0000\u0000\u0014ftypqt  ')).type).toBe('video/quicktime');
    expect(detect('a.mp4', bytes('\u0000\u0000\u0000\u0018ftypisom')).type).toBe('video/mp4');
    expect(detect('a.m4a', bytes('\u0000\u0000\u0000\u0018ftypM4A ')).kind).toBe('audio');
    expect(detect('a.webm', raw(0x1a, 0x45, 0xdf, 0xa3)).type).toBe('video/webm');
    expect(detect('a.flac', bytes('xxxx')).type).toBe('audio/flac');
    expect(detect('a.avif', bytes('\u0000\u0000\u0000\u0018ftypavif')).type).toBe('image/avif');
    expect(detect('a.heic', bytes('whatever')).type).toBe('image/heic');
  });

  it('classifies text-like formats', () => {
    expect(detect('a.csv', bytes('a,b\n1,2')).kind).toBe('csv');
    expect(detect('a.tsv', bytes('a\tb')).kind).toBe('csv');
    expect(detect('README.md', bytes('# hi')).kind).toBe('markdown');
    expect(detect('a.json', bytes('{}')).kind).toBe('json');
    for (const n of ['a.py', 'a.ts', 'a.log', 'a.yml', 'a.sql', 'a.ps1', 'a.tex']) expect(detect(n, bytes('x = 1')).kind, n).toBe('text');
    expect(detect('a.py', raw(0, 1, 2, 3)).kind).toBe('none');
  });

  it('treats unknown types as not previewable', () => {
    expect(detect('a.bin', raw(0, 1, 2, 3, 4)).kind).toBe('none');
    expect(detect('a.exe', raw(0x4d, 0x5a, 0, 0)).kind).toBe('none');
  });

  it('knows which names have a renderer', () => {
    expect(viewerSupports('x.docx')).toBe(true);
    expect(viewerSupports('x.zip')).toBe(false);
    expect(viewerSupports('noext')).toBe(false);
  });
});

describe('csv', () => {
  it('parses quoted fields, escaped quotes and embedded newlines', () => {
    const { rows } = parseCsv('name,quote\n"Doe, Jane","She said ""hi"""\n"multi\nline",x\r\n');
    expect(rows).toEqual([['name', 'quote'], ['Doe, Jane', 'She said "hi"'], ['multi\nline', 'x']]);
  });

  it('handles bom, missing trailing newline and limits', () => {
    expect(parseCsv('﻿a,b\n1,2').rows).toEqual([['a', 'b'], ['1', '2']]);
    const limited = parseCsv('a\n1\n2\n3\n', ',', 2);
    expect(limited.rows.length).toBe(2);
    expect(limited.truncated).toBe(true);
  });

  it('detects the delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('"a;b",c\n')).toBe(',');
    expect(detectDelimiter('a b', 'tsv')).toBe('\t');
  });
});

describe('markdown', () => {
  it('renders structure', () => {
    const html = renderMarkdown('# Title\n\n- one\n- two\n\n**bold**');
    expect(html).toContain('<h1');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('strips scripts, handlers, styles and javascript links', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<p style="color:red" onclick="x()">p</p>\n\n[bad](javascript:alert(1))');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    // Raw html is escaped to text, so no element carries a handler or style.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script, img, [onerror], [onclick], [style]').length).toBe(0);
    expect(html).not.toMatch(/href="javascript/i);
  });

  it('never loads remote images, showing the alt text instead', () => {
    const html = renderMarkdown('![A cat](https://evil.test/cat.png)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('evil.test');
    expect(html).toContain('A cat');
  });

  it('opens links in a new tab without opener', () => {
    const html = renderMarkdown('[site](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('pdf cache', () => {
  beforeEach(() => clearPdfCache());

  it('returns what was stored and ignores missing keys', () => {
    const blob = blobOf(10);
    putCachedPdf('a', blob);
    expect(getCachedPdf('a')).toBe(blob);
    expect(getCachedPdf('b')).toBeNull();
    expect(getCachedPdf(undefined)).toBeNull();
    putCachedPdf(undefined, blob);
    expect(pdfCacheSize()).toBe(10);
  });

  it('evicts the least recently used entries above the cap', () => {
    const mb = 1024 * 1024;
    putCachedPdf('a', blobOf(60 * mb));
    putCachedPdf('b', blobOf(60 * mb));
    getCachedPdf('a');
    putCachedPdf('c', blobOf(60 * mb));
    expect(getCachedPdf('b')).toBeNull();
    expect(getCachedPdf('a')).not.toBeNull();
    expect(getCachedPdf('c')).not.toBeNull();
    expect(pdfCacheSize()).toBeLessThanOrEqual(150 * mb);
  });
});
