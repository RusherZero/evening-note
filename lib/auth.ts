export const PASSWORD_MIN_LENGTH = 8;

export type AuthFlowMode = 'sign-in' | 'sign-up' | 'forgot';
export type RecoveryIntent = 'none' | 'recovery';

type AuthErrorLike = {
  code?: string;
  message?: string;
  status?: number;
};

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function isValidPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH;
}

export function passwordValidationMessage(
  password: string,
  confirmation: string,
): string {
  if (!isValidPassword(password)) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password !== confirmation) return 'The passwords do not match.';
  return '';
}

function readAuthError(error: unknown): AuthErrorLike {
  return typeof error === 'object' && error !== null ? error : {};
}

function isRateLimited(error: unknown): boolean {
  const value = readAuthError(error);
  return value.status === 429 || value.code === 'over_request_rate_limit';
}

export function signInErrorMessage(error: unknown): string {
  const value = readAuthError(error);
  if (isRateLimited(error)) return 'Too many attempts. Wait a little and try again.';
  if (value.code === 'email_not_confirmed') {
    return 'Confirm your email before signing in.';
  }
  if (value.code === 'weak_password') {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return 'Email or password is incorrect.';
}

export function signUpErrorMessage(error: unknown): string {
  if (isRateLimited(error)) return 'Too many attempts. Wait a little and try again.';
  if (readAuthError(error).code === 'weak_password') {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return 'We could not create the account. Check your connection and try again.';
}

export function recoveryRequestErrorMessage(error: unknown): string {
  return isRateLimited(error)
    ? 'Too many requests. Wait a little and try again.'
    : 'We could not send the reset email. Check your connection and try again.';
}

export function passwordUpdateErrorMessage(error: unknown): string {
  const value = readAuthError(error);
  if (isRateLimited(error)) return 'Too many attempts. Wait a little and try again.';
  if (
    value.code === 'current_password_mismatch' ||
    value.code === 'current_password_required'
  ) {
    return 'The current password is incorrect.';
  }
  if (value.code === 'same_password') {
    return 'Choose a password that is different from the current one.';
  }
  if (value.code === 'weak_password') {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return 'We could not update the password. Check your connection and try again.';
}

export function getAuthRedirectUrl(siteUrl: string, mode?: 'recovery'): string {
  const url = new URL(siteUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  url.search = '';
  url.hash = '';
  if (mode) url.searchParams.set('auth', mode);
  return url.toString();
}

export function getRecoveryIntent(value: string): RecoveryIntent {
  const url = new URL(value);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return url.searchParams.get('auth') === 'recovery' || hash.get('type') === 'recovery'
    ? 'recovery'
    : 'none';
}

export function getCleanAuthCallbackUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.delete('auth');
  url.searchParams.delete('error');
  url.searchParams.delete('error_code');
  url.searchParams.delete('error_description');
  url.hash = '';
  return url.toString();
}
