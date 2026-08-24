import { normalizeBasePath } from './paths';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? '';
const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export const publicConfig = {
  supabaseUrl,
  supabasePublishableKey,
  vapidPublicKey,
  siteUrl,
  basePath,
};

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

export const isPushConfigured = Boolean(
  isSupabaseConfigured && vapidPublicKey,
);

export const isDemoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ||
  (process.env.NODE_ENV !== 'production' && !isSupabaseConfigured);
