import { describe, expect, it } from 'vitest';
import { allowedMediaUrl, cardView, formatSize, isTrustedCardImage } from './chat-media';

describe('cardView', () => {
  it('flattens title, text, images and facts and ignores actions', () => {
    const view = cardView(
      {
        content: JSON.stringify({
          type: 'AdaptiveCard',
          body: [
            { type: 'TextBlock', text: 'Build passed', weight: 'Bolder' },
            { type: 'Container', items: [{ type: 'TextBlock', text: 'main' }, { type: 'Image', url: 'https://x.test/a.png', altText: 'logo' }] },
            { type: 'Image', url: 'http://insecure.test/a.png' },
            { type: 'FactSet', facts: [{ title: 'Run', value: '42' }] },
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open', url: 'https://x.test' }],
        }),
      },
      0,
    );
    expect(view?.title).toBe('Build passed');
    expect(view?.blocks.map((b) => b.kind)).toEqual(['text', 'image', 'facts']);
  });

  it('returns null for unreadable content', () => {
    expect(cardView({ content: 'not json' }, 0)).toBeNull();
    expect(cardView({ content: { body: [] } }, 0)).toBeNull();
  });
});

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('allowedMediaUrl', () => {
  it('accepts exact allow-listed https hosts only', () => {
    expect(allowedMediaUrl('https://media.giphy.com/media/x/giphy.gif')).not.toBeNull();
    expect(allowedMediaUrl('https://media.tenor.com/a.gif')).not.toBeNull();
    expect(allowedMediaUrl('https://stickers.newfuture.cc/s.png')).not.toBeNull();
    expect(allowedMediaUrl('https://statics.teams.cdn.office.net/e.png')).not.toBeNull();
  });
  it('rejects look-alike hosts, other schemes, credentials and relative paths', () => {
    expect(allowedMediaUrl('https://media.giphy.com.evil.test/a.gif')).toBeNull();
    expect(allowedMediaUrl('https://evil.test/media.giphy.com')).toBeNull();
    expect(allowedMediaUrl('https://media.giphy.com@evil.test/a.gif')).toBeNull();
    expect(allowedMediaUrl('https://user:pw@media.giphy.com/a.gif')).toBeNull();
    expect(allowedMediaUrl('http://media.giphy.com/a.gif')).toBeNull();
    expect(allowedMediaUrl('//evil.test/a.gif')).toBeNull();
    expect(allowedMediaUrl('/api/plugins/microsoft/accounts/x/chats')).toBeNull();
    expect(allowedMediaUrl('javascript:alert(1)')).toBeNull();
    expect(allowedMediaUrl(null)).toBeNull();
  });
});

describe('isTrustedCardImage', () => {
  it('trusts only Microsoft and Teams hosts over plain https', () => {
    expect(isTrustedCardImage('https://statics.teams.cdn.office.net/a.png')).toBe(true);
    expect(isTrustedCardImage('https://eu-api.asyncgw.teams.microsoft.com/v1/objects/x/views/imgo')).toBe(true);
    expect(isTrustedCardImage('https://eu-api.asm.skype.com/v1/objects/x')).toBe(true);
  });
  it('does not trust lookalikes, other hosts or odd URLs', () => {
    expect(isTrustedCardImage('https://teams.microsoft.com.evil.test/a.png')).toBe(false);
    expect(isTrustedCardImage('https://evilteams.microsoft.com.test/a.png')).toBe(false);
    expect(isTrustedCardImage('https://nottracker.test/pixel.gif')).toBe(false);
    expect(isTrustedCardImage('http://statics.teams.cdn.office.net/a.png')).toBe(false);
    expect(isTrustedCardImage('https://user:pw@statics.teams.cdn.office.net/a.png')).toBe(false);
    expect(isTrustedCardImage('https://statics.teams.cdn.office.net:8443/a.png')).toBe(false);
    expect(isTrustedCardImage('nonsense')).toBe(false);
  });
  it('marks card images by trust and drops sign-in-gated ones', () => {
    const view = cardView({ content: { body: [{ type: 'Image', url: 'https://t.example/p.gif' }, { type: 'Image', url: 'https://graph.microsoft.com/v1.0/x' }, { type: 'Image', url: 'https://statics.teams.cdn.office.net/a.png' }] } }, 0);
    expect(view?.blocks.map((b) => (b.kind === 'image' ? b.trusted : null))).toEqual([false, true]);
  });
});
