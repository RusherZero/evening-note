import type { PushSubscriptionPayload } from './types';
import { publicConfig } from './config';
import { isPathInsideBasePath, withBasePath } from './paths';

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const classicIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const modernIPad =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return classicIOS || modernIPad;
}

export function supportsWebPush(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = globalThis.atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  await navigator.serviceWorker.register(
    withBasePath('/sw.js', publicConfig.basePath),
    { scope: withBasePath('/', publicConfig.basePath) },
  );
  return navigator.serviceWorker.ready;
}

export function serializeSubscription(
  subscription: PushSubscription,
): PushSubscriptionPayload | null {
  const serialized = subscription.toJSON();
  if (
    !serialized.endpoint ||
    !serialized.keys?.auth ||
    !serialized.keys?.p256dh
  ) {
    return null;
  }
  return {
    endpoint: serialized.endpoint,
    expirationTime: serialized.expirationTime ?? null,
    keys: {
      auth: serialized.keys.auth,
      p256dh: serialized.keys.p256dh,
    },
  };
}

export function safeNotificationTarget(
  value: unknown,
  origin: string,
  basePath = '',
): string {
  const fallback = new URL(`${withBasePath('/', basePath)}?view=today`, origin).href;
  if (typeof value !== 'string') return fallback;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && isPathInsideBasePath(url.pathname, basePath)
      ? url.href
      : fallback;
  } catch {
    return fallback;
  }
}
