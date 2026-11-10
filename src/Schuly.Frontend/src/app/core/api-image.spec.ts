import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAvatar } from '../shared/api-avatar';
import { apiImageSource } from './api-image';

describe('apiImageSource', () => {
  it('fetches API pictures with the sign-in and shows data URLs and https pictures as they are', () => {
    expect(apiImageSource('/api/avatars/accounts/a1?v=1')).toEqual({ kind: 'fetch', url: '/api/avatars/accounts/a1?v=1' });
    expect(apiImageSource('data:image/png;base64,AAA')).toEqual({ kind: 'direct', url: 'data:image/png;base64,AAA' });
    expect(apiImageSource('https://example.org/p.png')).toEqual({ kind: 'direct', url: 'https://example.org/p.png' });
  });

  it('shows nothing for empty, plain http or script URLs', () => {
    expect(apiImageSource(null)).toEqual({ kind: 'none' });
    expect(apiImageSource('  ')).toEqual({ kind: 'none' });
    expect(apiImageSource('http://example.org/p.png')).toEqual({ kind: 'none' });
    expect(apiImageSource('javascript:alert(1)')).toEqual({ kind: 'none' });
  });
});

@Component({
  imports: [ApiAvatar],
  template: `@if (shown()) {<app-api-avatar [src]="src()" name="Mia Muster" />}`,
})
class Host {
  readonly src = signal<string | null>('/api/avatars/accounts/a1?v=1');
  readonly shown = signal(true);
}

describe('ApiAvatar', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:picture-1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('loads the picture over HttpClient, shows it and revokes it when the avatar goes away', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('MM');
    http.expectOne('/api/avatars/accounts/a1?v=1').flush(new Blob(['png'], { type: 'image/png' }));
    fixture.detectChanges();
    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:picture-1');

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picture-1');
  });

  it('keeps the initials when the picture is missing or not allowed', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();

    http.expectOne('/api/avatars/accounts/a1?v=1').flush(null, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain('MM');
  });

  it('asks nothing for an account without a picture', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.src.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    http.expectNone(() => true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('MM');
  });
});
