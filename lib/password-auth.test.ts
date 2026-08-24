import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  changeAccountPassword,
  completePasswordRecovery,
  requestPasswordRecovery,
  signInWithPassword,
  signUpWithPassword,
} from './password-auth';

function mockClient(auth: Record<string, ReturnType<typeof vi.fn>>): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

describe('password authentication calls', () => {
  it('signs in and signs up with the expected credentials and redirect', async () => {
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    const signUp = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = mockClient({ signInWithPassword: signIn, signUp });

    await signInWithPassword(client, 'person@example.com', 'not trimmed ');
    await signUpWithPassword(
      client,
      'person@example.com',
      'not trimmed ',
      'https://example.com/evening-note/',
    );

    expect(signIn).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'not trimmed ',
    });
    expect(signUp).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'not trimmed ',
      options: { emailRedirectTo: 'https://example.com/evening-note/' },
    });
  });

  it('requests a recovery link with the exact callback', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = mockClient({ resetPasswordForEmail });

    await requestPasswordRecovery(
      client,
      'person@example.com',
      'https://example.com/evening-note/?auth=recovery',
    );

    expect(resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', {
      redirectTo: 'https://example.com/evening-note/?auth=recovery',
    });
  });

  it('distinguishes recovery from a signed-in password change', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = mockClient({ updateUser });

    await completePasswordRecovery(client, 'new password');
    await changeAccountPassword(client, 'old password', 'newer password');

    expect(updateUser).toHaveBeenNthCalledWith(1, { password: 'new password' });
    expect(updateUser).toHaveBeenNthCalledWith(2, {
      current_password: 'old password',
      password: 'newer password',
    });
  });
});
