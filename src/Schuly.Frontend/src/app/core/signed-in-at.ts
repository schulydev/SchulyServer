const key = 'schuly-signed-in-at';

/** How long the server takes a sign-in as proof. Kept a little under its five minutes so the request still lands inside the window. */
export const FRESH_SIGN_IN_MS = 4 * 60_000;

/** Called for a real sign-in, never for a token refresh, which the server does not count as one either. */
export function markSignedIn(at = Date.now()): void {
  try {
    sessionStorage.setItem(key, String(at));
  } catch {}
}

export function clearSignedIn(): void {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

/** Only a hint for which proof to ask for; the server decides from the session itself. */
export function signedInRecently(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(key));
    return at > 0 && at <= now && now - at < FRESH_SIGN_IN_MS;
  } catch {
    return false;
  }
}

/** How this account proves it's the owner: the password if it has one, otherwise nothing right after a sign-in, else signing in again at a linked provider. */
export type ProofMode = 'none' | 'password' | 'reauth';

export function proofMode(hasPassword: boolean, fresh = signedInRecently()): ProofMode {
  if (hasPassword) return 'password';
  return fresh ? 'none' : 'reauth';
}

/** The words around the names, so the caller can translate them. */
export interface AgentWords {
  unknown: string;
  app: string;
  on: (browser: string, system: string) => string;
}

const ENGLISH: AgentWords = { unknown: 'Unknown device', app: 'Schuly app', on: (browser, system) => `${browser} on ${system}` };

/** "Firefox on Linux" from a raw user agent; the Schuly app names itself. */
export function describeAgent(agent: string | null | undefined, words: AgentWords = ENGLISH): string {
  if (!agent) return words.unknown;
  if (/^schuly|dart\//i.test(agent)) return /android/i.test(agent) ? words.on(words.app, 'Android') : /ios|iphone|ipad/i.test(agent) ? words.on(words.app, 'iOS') : words.app;
  const browser = /Edg\//.test(agent) ? 'Edge' : /OPR\//.test(agent) ? 'Opera' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
  const system = /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Mac OS/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
  return system ? words.on(browser, system) : browser;
}
