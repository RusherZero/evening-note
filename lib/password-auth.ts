import type { SupabaseClient } from '@supabase/supabase-js';

export function signInWithPassword(client: SupabaseClient, email: string, password: string) {
  return client.auth.signInWithPassword({ email, password });
}

export function signUpWithPassword(
  client: SupabaseClient,
  email: string,
  password: string,
  emailRedirectTo: string,
) {
  return client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });
}

export function requestPasswordRecovery(
  client: SupabaseClient,
  email: string,
  redirectTo: string,
) {
  return client.auth.resetPasswordForEmail(email, { redirectTo });
}

export function completePasswordRecovery(client: SupabaseClient, password: string) {
  return client.auth.updateUser({ password });
}

export function changeAccountPassword(
  client: SupabaseClient,
  currentPassword: string,
  password: string,
) {
  return client.auth.updateUser({
    current_password: currentPassword,
    password,
  });
}
