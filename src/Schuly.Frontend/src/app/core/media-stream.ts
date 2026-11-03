import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ThrottledError, waitFromHeader } from './throttle';

/**
 * A URL a `<video>` can play, which can't send the session's bearer token. The signed-in POST answers the URL and sets an HttpOnly cookie scoped to it,
 * so no secret is in the URL. One byte is asked for first: a `<video>` that fails only says it failed, and this tells a throttle from a real refusal.
 */
export async function openMediaStream(http: HttpClient, ticketUrl: string): Promise<string> {
  const { url } = await firstValueFrom(http.post<{ url: string }>(ticketUrl, null));
  if (!url.startsWith('/api/')) throw new Error('Refusing an unexpected media URL.');
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, credentials: 'same-origin' });
  await probe.body?.cancel();
  if (probe.status === 429) throw new ThrottledError(waitFromHeader(probe.headers.get('Retry-After')));
  if (!probe.ok) throw new HttpErrorResponse({ status: probe.status });
  return url;
}
