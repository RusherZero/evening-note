import { describe, expect, it } from 'vitest';
import {
  INVALID_OR_EXPIRED_OTP_MESSAGE,
  isPlausibleEmail,
  isValidEmailOtp,
  normalizeEmail,
  normalizeEmailOtp,
  requestOtpErrorMessage,
} from './auth';

describe('email OTP form policy', () => {
  it('normalizes and validates an email before requesting a code', () => {
    expect(normalizeEmail('  PERSON@Example.COM ')).toBe('person@example.com');
    expect(isPlausibleEmail('person@example.com')).toBe(true);
    expect(isPlausibleEmail('person@localhost')).toBe(false);
  });

  it('accepts every supported Supabase email OTP length', () => {
    expect(isValidEmailOtp('012345')).toBe(true);
    expect(isValidEmailOtp('01234567')).toBe(true);
    expect(isValidEmailOtp('0123456789')).toBe(true);
    expect(isValidEmailOtp('12345')).toBe(false);
    expect(isValidEmailOtp('01234567890')).toBe(false);
    expect(isValidEmailOtp('12345a')).toBe(false);
  });

  it('makes formatted and pasted email codes easy to enter', () => {
    expect(normalizeEmailOtp(' 0123 4567 ')).toBe('01234567');
    expect(normalizeEmailOtp('code: 012-345-6789')).toBe('0123456789');
  });

  it('keeps rate-limit and expiry errors actionable without leaking account state', () => {
    expect(requestOtpErrorMessage(429)).toContain('Too many attempts');
    expect(requestOtpErrorMessage(500)).toBe('We could not send the code. Please try again.');
    expect(INVALID_OR_EXPIRED_OTP_MESSAGE).toContain('invalid or has expired');
  });
});
