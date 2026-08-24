const PUSH_ENDPOINT_HOSTS = new Set([
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
]);

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;

  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 4096) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && url.hash === ''
      && PUSH_ENDPOINT_HOSTS.has(url.hostname)
      && url.pathname.startsWith('/');
  } catch {
    return false;
  }
}

export async function validPushKeys(p256dh: unknown, auth: unknown): Promise<boolean> {
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return false;
  // Canonical unpadded base64url lengths for 65-byte and 16-byte values.
  if (p256dh.length !== 87 || auth.length !== 22) return false;

  const publicPoint = decodeBase64Url(p256dh);
  const authSecret = decodeBase64Url(auth);
  if (
    publicPoint?.length !== 65
    || publicPoint[0] !== 4
    || authSecret?.length !== 16
  ) {
    return false;
  }

  try {
    await crypto.subtle.importKey(
      'raw',
      publicPoint,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    return true;
  } catch {
    return false;
  }
}
