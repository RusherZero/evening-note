const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '';

export const publicConfig = {
  supabaseUrl,
  supabasePublishableKey,
  vapidPublicKey,
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
