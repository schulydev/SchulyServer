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
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('wraps tables so they scroll horizontally', () => {
    expect(sanitized('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('class="table-scroll"');
  });
});
