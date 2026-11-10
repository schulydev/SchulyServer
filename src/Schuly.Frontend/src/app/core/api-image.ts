/**
 * How a picture URL from the API is shown. Pictures under /api/ need the sign-in, which a plain img src can't send, so they are
 * fetched with the authenticated HttpClient and shown from an object URL. Data URLs and outside pictures are shown as they are.
 */
export type ApiImageSource = { kind: 'none' } | { kind: 'fetch'; url: string } | { kind: 'direct'; url: string };

export function apiImageSource(src: string | null | undefined): ApiImageSource {
  const url = src?.trim();
  if (!url) return { kind: 'none' };
  if (url.startsWith('/api/')) return { kind: 'fetch', url };
  if (/^(data:image\/|https:\/\/)/i.test(url)) return { kind: 'direct', url };
  return { kind: 'none' };
}
