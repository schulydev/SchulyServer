import { describe, expect, it } from 'vitest';
import { presenceView } from './presence';

describe('presenceView', () => {
  it('shows nothing without a status', () => {
    expect(presenceView(null)).toBeNull();
  });

  it('maps Teams statuses', () => {
    expect(presenceView('Available')?.dot).toBe('bg-green-500');
    expect(presenceView('DoNotDisturb')?.dot).toBe('bg-red-500');
    expect(presenceView('BeRightBack')?.dot).toBe('bg-yellow-500');
  });

  it('shows a status it does not know as unknown', () => {
    expect(presenceView('PresenceUnknown')?.label).toBe('Status unknown');
  });
});
