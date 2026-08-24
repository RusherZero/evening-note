import { describe, expect, it } from 'vitest';
import { classifyPushFailure, remainingTtlSeconds } from './push-policy';

describe('push delivery policy', () => {
  it('classifies terminal, transient, and permanent responses', () => {
    expect(classifyPushFailure(410)).toBe('expired');
    expect(classifyPushFailure(429)).toBe('retry');
    expect(classifyPushFailure(503)).toBe('retry');
    expect(classifyPushFailure(null)).toBe('retry');
    expect(classifyPushFailure(400)).toBe('failed');
  });

  it('keeps retry TTL inside the original 15-minute window', () => {
    const scheduledFor = '2026-08-24T17:45:00.000Z';
    expect(remainingTtlSeconds(scheduledFor, Date.parse('2026-08-24T17:50:00.000Z'))).toBe(600);
    expect(remainingTtlSeconds(scheduledFor, Date.parse('2026-08-24T18:00:01.000Z'))).toBe(-1);
  });
});
