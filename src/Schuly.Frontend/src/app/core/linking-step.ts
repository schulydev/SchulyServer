import { HttpErrorResponse } from '@angular/common/http';
import { LinkFieldDto, LinkSessionDto, LinkStepDto } from './linking-api';

/** True for an absolute https URL (the only kind the renderer opens or navigates to). */
export function isHttps(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The message the server sent, or a plain fallback per status. Never hides a real message. */
export function linkErrorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!(error instanceof HttpErrorResponse)) return error instanceof Error && error.message ? error.message : fallback;
  const body: unknown = error.error;
  if (typeof body === 'string' && body.trim() && body.length < 400 && !body.trimStart().startsWith('<')) return body.trim();
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'detail', 'error_description', 'title', 'error']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    if (Array.isArray(record['errors']) && record['errors'].length) return record['errors'].map(String).join(' ');
  }
  if (error.status === 0) return 'Schuly is not reachable right now. Check your connection and try again.';
  if (error.status === 429) {
    const wait = Number(error.headers?.get('Retry-After'));
    return Number.isFinite(wait) && wait > 0
      ? `Too many attempts. Wait ${Math.ceil(wait)} seconds and try again.`
      : 'Too many attempts. Wait a minute and try again.';
  }
  if (error.status === 404) return 'This sign-in expired or was cancelled. Start again.';
  if (error.status >= 500) return 'Schuly could not complete the sign-in right now. Try again in a moment.';
  return fallback;
}

/** Whether the session ended: the server says so, or the step is a terminal one. */
export function isTerminal(session: LinkSessionDto): 'done' | 'failed' | null {
  if (session.status === 'done' || session.step.kind === 'done') return 'done';
  if (session.status === 'failed' || session.status === 'expired' || session.step.kind === 'error') return 'failed';
  return null;
}

/** Text shown for a failed session; the real server message wins. */
export function failureMessage(session: LinkSessionDto): string {
  const step = session.step;
  return (
    step.error ||
    step.description ||
    (session.status === 'expired' ? 'This sign-in expired. Start again.' : step.title) ||
    'The sign-in did not complete. Try again.'
  );
}

/** Client-side hint for one field; the server validates again. Returns an error message or null. */
export function fieldHint(field: LinkFieldDto, raw: string): string | null {
  const value = raw.trim();
  if (!value) return field.required === false ? null : `${field.label} is required.`;
  if (field.maxLength && raw.length > field.maxLength) return `${field.label} can be at most ${field.maxLength} characters.`;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.';
  if (field.type === 'url' || (field.type === 'select' && field.allowCustom && /^https?:/i.test(value))) {
    try {
      const url = new URL(value);
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return 'Enter a full address starting with https://.';
    } catch {
      return 'Enter a full address starting with https://.';
    }
  }
  if (field.type === 'select' && !field.allowCustom && field.options?.length && !field.options.some((o) => o.value === value))
    return `Choose one of the listed options for ${field.label}.`;
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value)) return `${field.label} is not in the expected format.`;
    } catch {
      // A .NET pattern JavaScript cannot compile: leave it to the server.
    }
  }
  return null;
}

/** Hints for every field of a form step, keyed by field key. */
export function formHints(fields: LinkFieldDto[], values: Record<string, string>): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const field of fields) {
    const hint = fieldHint(field, values[field.key] ?? '');
    if (hint) hints[field.key] = hint;
  }
  return hints;
}

/** Initial values of a form step: defaults for non-secret fields, empty for secrets. */
export function initialValues(step: LinkStepDto): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of step.fields ?? []) values[field.key] = field.secret ? '' : (field.defaultValue ?? '');
  return values;
}

/** Only the values a form submit sends: optional empty fields are left out. */
export function submitValues(fields: LinkFieldDto[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.key] ?? '').trim();
    if (value || field.required !== false) out[field.key] = value;
  }
  return out;
}

export function secondsLeft(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : 0;
}

/** m:ss for the visible countdown. */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Coarse text for the polite live region, so a screen reader is not read a number every second. */
export function countdownAnnouncement(seconds: number): string {
  if (seconds <= 0) return 'The request expired.';
  if (seconds <= 10) return 'About 10 seconds left.';
  if (seconds <= 30) return 'About 30 seconds left.';
  if (seconds <= 60) return 'About 1 minute left.';
  return `About ${Math.ceil(seconds / 60)} minutes left.`;
}

const FALLBACK_TITLES: Partial<Record<LinkStepDto['kind'], string>> = {
  otp: 'Enter your code',
  pushCode: 'Approve the sign-in',
  deviceCode: 'Enter this code to sign in',
  select: 'Choose an option',
  done: 'Account linked',
  error: 'Sign-in failed',
};

/** The step's own title, else a plain one for its kind. */
export function stepTitle(step: LinkStepDto): string {
  return step.title || FALLBACK_TITLES[step.kind] || 'Sign in';
}

export interface SearchOption {
  value: string;
  name: string;
  /** A short tag after the last " · " of the label, such as a canton. */
  tag: string | null;
  /** The value without its scheme, shown under the name when the value is an address. */
  address: string | null;
}

/** Splits "Kantonsschule Baden · AG" into the name and its tag, and shows an https value as its address. */
export function searchOption(option: { value: string; label: string }): SearchOption {
  const cut = option.label.lastIndexOf(' · ');
  const tail = cut > 0 ? option.label.slice(cut + 3).trim() : '';
  const tag = tail && tail.length <= 4 ? tail : null;
  return { value: option.value, name: tag ? option.label.slice(0, cut).trim() : option.label, tag, address: isHttps(option.value) ? option.value.replace(/^https:\/\//, '') : null };
}

/** The options whose name, tag or address contain every word of the query, ignoring case and accents. */
export function filterSearchOptions(options: SearchOption[], query: string): SearchOption[] {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((option) => {
    const text = fold(`${option.name} ${option.tag ?? ''} ${option.address ?? option.value}`);
    return words.every((word) => text.includes(word));
  });
}
