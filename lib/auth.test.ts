import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  getAuthRedirectUrl,
  getCleanAuthCallbackUrl,
  getRecoveryIntent,
  isPlausibleEmail,
  isValidPassword,
  normalizeEmail,
  passwordUpdateErrorMessage,
  passwordValidationMessage,
  recoveryRequestErrorMessage,
  signInErrorMessage,
  signUpErrorMessage,
} from './auth';

describe('email and password form policy', () => {
  it('normalizes email addresses without changing passwords', () => {
    expect(normalizeEmail('  PERSON@Example.COM ')).toBe('person@example.com');
    expect(isPlausibleEmail('person@example.com')).toBe(true);
    expect(isPlausibleEmail('person@localhost')).toBe(false);
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(isValidPassword(' spaces ')).toBe(true);
    expect(isValidPassword('short')).toBe(false);
  });

  it('requires a valid length and matching confirmation', () => {
    expect(passwordValidationMessage('short', 'short')).toBe('Use at least 8 characters.');
    expect(passwordValidationMessage('long enough', 'different')).toBe('The passwords do not match.');
    expect(passwordValidationMessage('long enough', 'long enough')).toBe('');
  });

  it('keeps authentication errors useful without revealing account existence', () => {
    expect(signInErrorMessage({ status: 400 })).toBe('Email or password is incorrect.');
    expect(signInErrorMessage({ code: 'email_not_confirmed' })).toContain('Confirm your email');
    expect(signInErrorMessage({ status: 429 })).toContain('Too many attempts');
    expect(signUpErrorMessage({ code: 'weak_password' })).toContain('8 characters');
    expect(recoveryRequestErrorMessage({ status: 500 })).not.toContain('account');
  });

  it('maps password-change errors without exposing server details', () => {
    expect(passwordUpdateErrorMessage({ code: 'current_password_mismatch' })).toContain('incorrect');
    expect(passwordUpdateErrorMessage({ code: 'same_password' })).toContain('different');
    expect(passwordUpdateErrorMessage({ code: 'weak_password' })).toContain('8 characters');
  });
});

describe('authentication redirects', () => {
  it('builds root and GitHub Pages callback URLs', () => {
    expect(getAuthRedirectUrl('https://example.com')).toBe('https://example.com/');
    expect(getAuthRedirectUrl('https://example.com/evening-note', 'recovery')).toBe(
      'https://example.com/evening-note/?auth=recovery',
    );
  });

  it('detects recovery links from the app query or Supabase fragment', () => {
    expect(getRecoveryIntent('https://example.com/?auth=recovery')).toBe('recovery');
    expect(getRecoveryIntent('https://example.com/#type=recovery&access_token=secret')).toBe('recovery');
    expect(getRecoveryIntent('https://example.com/#type=signup')).toBe('none');
  });

  it('removes callback markers and credentials from the visible URL', () => {
    expect(
      getCleanAuthCallbackUrl(
        'https://example.com/evening-note/?auth=recovery&view=settings#access_token=secret',
      ),
    ).toBe('https://example.com/evening-note/?view=settings');
  });
});
