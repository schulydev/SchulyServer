import { t } from '../core/i18n';
import { HttpErrorResponse } from '@angular/common/http';

const MIN_WAIT_MS = 5_000;
const MAX_WAIT_MS = 5 * 60_000;
const DEFAULT_WAIT_MS = 30_000;

/** A request that was not sent, or was refused, because Microsoft asked to wait. */
export class ThrottledError extends Error {
  constructor(readonly waitMs: number) {
    super(t('files.limited'));
  }
}

/** How long a `Retry-After` of seconds asks to wait, kept to a calm range. */
export function waitFromHeader(retryAfter: string | null | undefined): number {
  const seconds = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(seconds) || seconds < 0) return DEFAULT_WAIT_MS;
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, seconds * 1000));
}

/** How long to wait before asking again when the error is a throttle; null for any other error. */
export function throttleWait(error: unknown): number | null {
  if (error instanceof ThrottledError) return error.waitMs;
  if (error instanceof HttpErrorResponse && error.status === 429) return waitFromHeader(error.headers?.get('Retry-After'));
  return null;
}

/** The HTTP status of a failed request, when there is one. */
export function errorStatus(error: unknown): number | null {
  return error instanceof HttpErrorResponse ? error.status : null;
}
