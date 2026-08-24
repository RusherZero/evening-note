import { describe, expect, it } from 'vitest';
import { getLocalDateKey, isValidIanaTimezone } from './date';

describe('local date handling', () => {
  it('derives the date in the selected timezone', () => {
    const instant = new Date('2026-08-24T22:30:00.000Z');
    expect(getLocalDateKey('Europe/Amsterdam', instant)).toBe('2026-08-25');
    expect(getLocalDateKey('America/Los_Angeles', instant)).toBe('2026-08-24');
  });

  it('handles dates around daylight-saving transitions', () => {
    const beforeTransition = new Date('2026-03-29T00:30:00.000Z');
    const afterTransition = new Date('2026-03-29T02:30:00.000Z');
    expect(getLocalDateKey('Europe/Amsterdam', beforeTransition)).toBe('2026-03-29');
    expect(getLocalDateKey('Europe/Amsterdam', afterTransition)).toBe('2026-03-29');
  });

  it('rejects invented timezone names', () => {
    expect(isValidIanaTimezone('Europe/Amsterdam')).toBe(true);
    expect(isValidIanaTimezone('Mars/Olympus_Mons')).toBe(false);
  });
});
