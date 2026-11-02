import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../../core/helply-state';
import { HelplyMessageView } from './message';

const message = (text: string): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  text,
  createdAt: '',
  tools: [],
  attachments: [],
  failed: false,
  streaming: false,
  error: null,
  retryable: false,
});

async function render(text: string): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(HelplyMessageView);
  fixture.componentRef.setInput('message', message(text));
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 50));
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Helply message markdown', () => {
  it('never creates an image element, whatever its source', async () => {
    const el = await render(
      '![a](https://evil.example/x.png)\n\n![b](/api/me/secret.png)\n\n![c](data:image/png;base64,AAAA)\n\n<img src="https://evil.example/y.png">',
    );
    expect(el.querySelectorAll('img[src*="evil"], img[src*="secret"], img[src^="data:"]')).toHaveLength(0);
    expect(el.querySelector('pk-markdown img')).toBeNull();
    expect(el.textContent).toContain('Image: a');
  });

  it('shows raw HTML as text instead of running it', async () => {
    const el = await render('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">');
    const md = el.querySelector('pk-markdown')!;
    expect(md.querySelector('script')).toBeNull();
    expect(md.querySelector('img')).toBeNull();
    expect(md.textContent).toContain('<script>alert(1)</script>');
    expect(md.textContent).toContain('onerror');
  });

  it('removes javascript: links', async () => {
    const el = await render('[run](javascript:alert(1))');
    expect(el.querySelector('pk-markdown a')).toBeNull();
    expect(el.querySelector('pk-markdown')!.textContent).toContain('run');
  });

  it('shows the host next to a link whose text differs from its address', async () => {
    const el = await render('[click here](https://evil.example/login)');
    const link = el.querySelector('pk-markdown a')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(el.querySelector('pk-markdown')!.textContent).toContain('click here (evil.example)');
  });
});
