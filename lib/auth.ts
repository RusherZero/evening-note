export const INVALID_OR_EXPIRED_OTP_MESSAGE =
  'That code is invalid or has expired. Request a new one and try again.';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function normalizeEmailOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

export function isValidEmailOtp(value: string): boolean {
  return /^\d{6,10}$/.test(value);
}

export function requestOtpErrorMessage(status?: number): string {
  return status === 429
    ? 'Too many attempts. Wait a little and try again.'
    : 'We could not send the code. Please try again.';
}
