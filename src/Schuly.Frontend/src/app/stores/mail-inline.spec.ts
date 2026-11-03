import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { prepareMailBody } from '../shared/mail-body';
import { MailClient, imageTypeOf, normalizeCid, referencesInlineParts } from './mail-client';
import { LinkedAccountsStore } from './linked-accounts.store';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const CID = 'part1.3570rv4z.rIgVu9H8@stud.bbbaden.ch';
const BASE = '/api/plugins/microsoft/accounts/acc1/mail';

describe('normalizeCid', () => {
  it('matches a Content-ID however the reference spells it', () => {
    const want = normalizeCid(CID);
    expect(normalizeCid(`cid:${CID}`)).toBe(want);
    expect(normalizeCid(`<${CID}>`)).toBe(want);
    expect(normalizeCid(`CID:${encodeURIComponent(CID).toUpperCase()}`)).toBe(want);
    expect(normalizeCid(' cid:%3Cabc%40host%3E ')).toBe('abc@host');
  });

  it('sees cid references in a body', () => {
    expect(referencesInlineParts('<img src="cid:a@b">')).toBe(true);
    expect(referencesInlineParts('<img src="https://x/cid.png">')).toBe(false);
  });

  it('only inlines raster images it can recognise', () => {
    expect(imageTypeOf(PNG)).toBe('image/png');
    expect(imageTypeOf(new TextEncoder().encode('<svg onload="x">'))).toBeNull();
  });
});

describe('prepareMailBody', () => {
  it('swaps cid images for their data: URLs and drops unmatched ones', () => {
    const { html, remote } = prepareMailBody(`<p>das crazy</p><img src="cid:${CID}" alt="shot"><img src="cid:missing@x" alt="gone">`, true, { [normalizeCid(CID)]: 'data:image/png;base64,AAAA' });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const [first, second] = Array.from(doc.querySelectorAll('img'));
    expect(first.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(second.hasAttribute('src')).toBe(false);
    expect(remote).toBe(false);
  });

  it('never puts a non-image data URL into a cid image', () => {
    const { html } = prepareMailBody(`<img src="cid:${CID}">`, true, { [normalizeCid(CID)]: 'data:text/html,<script>1</script>' });
    expect(html).not.toContain('data:text/html');
  });
});

describe('MailClient inline images', () => {
  it('loads the attachments of an inline-only message (hasAttachments false) and hands the images over as data URLs', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), MailClient, { provide: LinkedAccountsStore, useValue: { selectedId: () => 'acc1', endpoint: () => '/api/plugins/microsoft/accounts/acc1' } }],
    });
    const client = TestBed.inject(MailClient);
    const http = TestBed.inject(HttpTestingController);

    const opened = client.open('m1');
    await new Promise((r) => setTimeout(r));
    http.expectOne('/api/plugins/microsoft/accounts/acc1/cached/mail/m1').flush({ id: 'm1', subject: 'ahahahahahahah', hasAttachments: false, body: { contentType: 'html', content: `<p>das crazy</p><img src="cid:${CID}">` } });
    await opened;
    await Promise.resolve();
    http.expectOne(`${BASE}/m1/attachments`).flush([{ id: 'a1', name: 'shot.png', contentType: 'image/png', size: PNG.length, isInline: true, contentId: CID }]);
    await new Promise((r) => setTimeout(r));
    http.expectOne(`${BASE}/m1/attachments/a1`).flush(new Blob([PNG], { type: 'application/octet-stream' }));
    await new Promise((r) => setTimeout(r, 20));

    expect(client.attachments()[0].inline).toBe(true);
    const images = client.inlineImages();
    expect(Object.keys(images)).toEqual([normalizeCid(CID)]);
    expect(images[normalizeCid(CID)]).toMatch(/^data:image\/png;base64,/);
    http.verify();
  });
});
