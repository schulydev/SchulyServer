import { describe, expect, it } from 'vitest';
import { shouldSubmit } from './composer';

const key = (over: Partial<Parameters<typeof shouldSubmit>[0]>) => ({ key: 'Enter', shiftKey: false, isComposing: false, ...over });

describe('shouldSubmit', () => {
  it('sends on Enter', () => expect(shouldSubmit(key({}))).toBe(true));
  it('inserts a newline on Shift+Enter', () => expect(shouldSubmit(key({ shiftKey: true }))).toBe(false));
  it('does not send while an IME is composing', () => {
    expect(shouldSubmit(key({ isComposing: true }))).toBe(false);
    expect(shouldSubmit(key({ keyCode: 229 }))).toBe(false);
  });
  it('ignores other keys', () => expect(shouldSubmit(key({ key: 'a' }))).toBe(false));
});
