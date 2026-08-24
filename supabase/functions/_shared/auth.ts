import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.112.4';

let adminClient: SupabaseClient | null = null;

export function namedSupabaseSecret(name: string): string | null {
  const encodedSecrets = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!encodedSecrets) return null;

  try {
    const secrets = JSON.parse(encodedSecrets) as Record<string, unknown>;
    const value = secrets[name];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = Deno.env.get('SUPABASE_URL');
  // Hosted projects expose named sb_secret_ keys as a JSON map. Keep both local
  // and legacy variables as migration fallbacks.
  const serviceKey = namedSupabaseSecret('default')
    || Deno.env.get('SUPABASE_SECRET_KEY')
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase service configuration is missing');

  adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export async function authenticatedUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;

  const { data, error } = await getAdminClient().auth.getUser(token);
  return error ? null : data.user;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return difference === 0;
}
