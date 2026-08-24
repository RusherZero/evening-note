import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicConfig, isSupabaseConfigured } from './config';

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;

  browserClient ??= createClient(
    publicConfig.supabaseUrl,
    publicConfig.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    },
  );

  return browserClient;
}
