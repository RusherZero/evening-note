'use client';

import { useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  PASSWORD_MIN_LENGTH,
  passwordUpdateErrorMessage,
  passwordValidationMessage,
} from '@/lib/auth';
import { completePasswordRecovery } from '@/lib/password-auth';

export type PasswordRecoveryState = 'checking' | 'ready' | 'error';

type PasswordRecoveryScreenProps = {
  client: SupabaseClient;
  onComplete: (user: User) => void;
  onRequestNew: () => void;
  state: PasswordRecoveryState;
};

export function PasswordRecoveryScreen({ client, onComplete, onRequestNew, state }: PasswordRecoveryScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function updatePassword() {
    const validationError = passwordValidationMessage(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { data, error: authError } = await completePasswordRecovery(client, password);
      if (authError || !data.user) {
        setError(passwordUpdateErrorMessage(authError));
        return;
      }
      onComplete(data.user);
    } catch (caughtError) {
      setError(passwordUpdateErrorMessage(caughtError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4efe7] px-5 pb-10 pt-[max(2rem,env(safe-area-inset-top))] text-[#18201d]">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col">
        <header className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#1d3930] text-xl text-[#fffaf0] shadow-[0_8px_24px_rgba(29,57,48,0.18)]">✦</span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5d6963]">Evening Note</p>
            <p className="text-sm text-[#5d6963]">Your day, gently remembered.</p>
          </div>
        </header>

        <section className="my-auto py-14">
          {state === 'checking' ? (
            <div className="text-center" aria-live="polite">
              <span className="inline-block animate-spin text-3xl text-[#1d3930]" aria-hidden="true">↻</span>
              <h1 className="mt-6 font-serif text-[2.5rem] leading-tight">Checking your reset link…</h1>
              <p className="mt-4 text-sm leading-6 text-[#5d6963]">This should only take a moment.</p>
            </div>
          ) : state === 'error' ? (
            <div>
              <p className="mb-3 text-sm font-medium text-[#5d6963]">Reset link unavailable</p>
              <h1 className="font-serif text-[2.65rem] leading-[1.03] tracking-[-0.035em]">Let’s send a fresh one.</h1>
              <p className="mt-4 text-[15px] leading-6 text-[#5d6963]">This password reset link is invalid, expired, or has already been used.</p>
              <button type="button" onClick={onRequestNew} className="mt-8 min-h-14 w-full rounded-2xl bg-[#1d3930] px-5 text-base font-semibold text-[#fffdf8] shadow-[0_12px_30px_rgba(29,57,48,0.2)]">
                Request another reset link
              </button>
            </div>
          ) : (
            <div>
              <p className="mb-3 text-sm font-medium text-[#5d6963]">Choose a new password</p>
              <h1 className="font-serif text-[2.65rem] leading-[1.03] tracking-[-0.035em]">A fresh key to your notes.</h1>
              <p className="mt-4 text-[15px] leading-6 text-[#5d6963]">Use at least {PASSWORD_MIN_LENGTH} characters. You will stay signed in after the update.</p>

              <form
                className="mt-8 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void updatePassword();
                }}
              >
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#45524c]">New password</span>
                  <span className="relative block">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="new-password"
                      autoComplete="new-password"
                      minLength={PASSWORD_MIN_LENGTH}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="min-h-14 w-full rounded-2xl border border-[#d4ccbf] bg-[#fffdf8] px-4 py-3 pr-20 text-base outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
                      disabled={busy}
                      required
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-1 right-1 min-w-16 rounded-xl px-3 text-xs font-semibold text-[#52625a]" aria-label={`${showPassword ? 'Hide' : 'Show'} new password`}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#45524c]">Confirm new password</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="new-password-confirmation"
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN_LENGTH}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className="min-h-14 w-full rounded-2xl border border-[#d4ccbf] bg-[#fffdf8] px-4 py-3 text-base outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
                    disabled={busy}
                    required
                  />
                </label>

                <div className="min-h-10 text-sm" aria-live="polite">
                  {error && <p className="text-[#a4432b]">{error}</p>}
                </div>

                <button type="submit" disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#1d3930] px-5 text-base font-semibold text-[#fffdf8] shadow-[0_12px_30px_rgba(29,57,48,0.2)] transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-65">
                  {busy && <span className="inline-block animate-spin text-lg" aria-hidden="true">↻</span>}
                  Update password
                </button>
              </form>
            </div>
          )}
        </section>

        <p className="text-center text-xs leading-5 text-[#5d6963]">Your entries remain attached to the same private account.</p>
      </div>
    </main>
  );
}
