import { signal } from '@angular/core';

const read = (key: string): number | null => {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

/** A number signal remembered in localStorage; storage may be unavailable, then it is just a signal. */
export function persistedNumber(key: string, fallback: number) {
  const value = signal(read(key) ?? fallback);
  return {
    value,
    set(next: number): void {
      value.set(next);
      try {
        localStorage.setItem(key, String(Math.round(next)));
      } catch {
        // Not remembered; the width still applies for this visit.
      }
    },
  };
}

/** One of a fixed set of strings, remembered in localStorage; an unknown or unreadable value falls back. */
export function persistedChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
  const value = signal<T>(options.includes(stored as T) ? (stored as T) : fallback);
  return {
    value: value.asReadonly(),
    set(next: T): void {
      value.set(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Not remembered; it still applies for this visit.
      }
    },
  };
}
