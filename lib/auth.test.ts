import { describe, expect, it } from 'vitest';
import {
  INVALID_OR_EXPIRED_OTP_MESSAGE,
  isPlausibleEmail,
  isSixDigitOtp,
  normalizeEmail,
  requestOtpErrorMessage,
} from './auth';

describe('email OTP form policy', () => {
  it('normalizes and validates an email before requesting a code', () => {
    expect(normalizeEmail('  PERSON@Example.COM ')).toBe('person@example.com');
    expect(isPlausibleEmail('person@example.com')).toBe(true);
    expect(isPlausibleEmail('person@localhost')).toBe(false);
  });

  it('accepts only a six-digit in-app OTP', () => {
    expect(isSixDigitOtp('012345')).toBe(true);
    expect(isSixDigitOtp('12345')).toBe(false);
    expect(isSixDigitOtp('12345a')).toBe(false);
  });

  it('keeps rate-limit and expiry errors actionable without leaking account state', () => {
    expect(requestOtpErrorMessage(429)).toContain('Too many attempts');
    expect(requestOtpErrorMessage(500)).toBe('We could not send the code. Please try again.');
    expect(INVALID_OR_EXPIRED_OTP_MESSAGE).toContain('invalid or has expired');
  });
});
