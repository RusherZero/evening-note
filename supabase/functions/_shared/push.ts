import webpush from 'npm:web-push@3.6.7';
import { buildNotificationPayload } from './push-payload.ts';

export type StoredSubscription = {
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

function appOrigin(): string {
  const origin = Deno.env.get('APP_ORIGIN');
  if (!origin) throw new Error('APP_ORIGIN is missing');
  const parsed = new URL(origin);
  const localDevelopment = parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localDevelopment) {
    throw new Error('APP_ORIGIN must use HTTPS');
  }
  return parsed.origin;
}

function configureVapid() {
  const subject = Deno.env.get('VAPID_SUBJECT');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!subject || !publicKey || !privateKey) {
    throw new Error('VAPID configuration is missing');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export function notificationPayload(localDate: string, test = false) {
  return buildNotificationPayload(appOrigin(), localDate, test);
}

export async function sendPush(
  subscription: StoredSubscription,
  localDate: string,
  ttlSeconds: number,
  test = false,
) {
  configureVapid();
  const payload = notificationPayload(localDate, test);
  const topic = test ? 'evening-note-test' : `evening-note-${localDate}`;
  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
    },
    JSON.stringify(payload),
    {
      TTL: Math.max(1, Math.min(Math.floor(ttlSeconds), 900)),
      urgency: 'normal',
      topic,
      timeout: 10_000,
    },
  );
}

export function pushStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return null;
  const status = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(status) ? status : null;
}
