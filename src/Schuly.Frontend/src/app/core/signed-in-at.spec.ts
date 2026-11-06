import { afterEach, describe, expect, it } from 'vitest';
import { FRESH_SIGN_IN_MS, clearSignedIn, describeAgent, markSignedIn, proofMode, signedInRecently } from './signed-in-at';

describe('signedInRecently', () => {
  afterEach(() => clearSignedIn());

  it('is true only shortly after a real sign-in', () => {
    const now = 1_800_000_000_000;
    expect(signedInRecently(now)).toBe(false);
    markSignedIn(now - 60_000);
    expect(signedInRecently(now)).toBe(true);
    expect(signedInRecently(now + FRESH_SIGN_IN_MS)).toBe(false);
  });

  it('does not trust a time in the future', () => {
    markSignedIn(2_000);
    expect(signedInRecently(1_000)).toBe(false);
  });
});

describe('proofMode', () => {
  it('asks for the password whenever there is one', () => {
    expect(proofMode(true, true)).toBe('password');
    expect(proofMode(true, false)).toBe('password');
  });

  it('asks a passwordless account for nothing after a fresh sign-in, else to sign in again', () => {
    expect(proofMode(false, true)).toBe('none');
    expect(proofMode(false, false)).toBe('reauth');
  });
});

describe('describeAgent', () => {
  it('names browser and system', () => {
    expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox on Linux');
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 OPR/124.0')).toBe('Opera on Windows');
    expect(describeAgent(null)).toBe('Unknown device');
  });
});
