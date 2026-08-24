'use client';
/* eslint-disable react-hooks/set-state-in-effect -- effects restore external session state */

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  INVALID_OR_EXPIRED_OTP_MESSAGE,
  isPlausibleEmail,
  isValidEmailOtp,
  normalizeEmail,
  normalizeEmailOtp,
  requestOtpErrorMessage,
} from '@/lib/auth';

type AuthScreenProps = {
  client: SupabaseClient;
};

const PENDING_EMAIL_KEY = 'evening-note:pending-email';

export function AuthScreen({ client }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    try {
      const pendingEmail = window.sessionStorage.getItem(PENDING_EMAIL_KEY);
      if (pendingEmail) {
        setEmail(pendingEmail);
        setStage('code');
      }
    } catch {
      // The form still works if session storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function sendCode() {
    const normalizedEmail = normalizeEmail(email);
    if (!isPlausibleEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: authError } = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true },
      });
      if (authError) {
        setError(requestOtpErrorMessage(authError.status));
        return;
      }

      setEmail(normalizedEmail);
      setStage('code');
      setCooldown(60);
      setMessage('A sign-in code is on its way.');
      try {
        window.sessionStorage.setItem(PENDING_EMAIL_KEY, normalizedEmail);
      } catch {
        // Best-effort convenience only.
      }
    } catch {
      setError(requestOtpErrorMessage());
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!isValidEmailOtp(token)) {
      setError('Enter the 6–10 digit code from your email.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: authError } = await client.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });
      if (authError) {
        setError(INVALID_OR_EXPIRED_OTP_MESSAGE);
        return;
      }

      try {
        window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
      } catch {
        // Best-effort convenience only.
      }
    } catch {
      setError('We could not verify the code. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function editEmail() {
    setStage('email');
    setToken('');
    setError('');
    setMessage('');
    try {
      window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
    } catch {
      // Best-effort convenience only.
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
          {stage === 'code' && (
            <button type="button" onClick={editEmail} className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-[#52625a]">
              <span className="text-lg" aria-hidden="true">←</span> Change email
            </button>
          )}

          <p className="mb-3 text-sm font-medium text-[#5d6963]">{stage === 'email' ? 'Welcome' : 'Check your inbox'}</p>
          <h1 className="max-w-sm font-serif text-[2.65rem] leading-[1.03] tracking-[-0.035em]">
            {stage === 'email' ? 'A quiet moment, every evening.' : 'Paste your sign-in code.'}
          </h1>
          <p className="mt-4 max-w-sm text-[15px] leading-6 text-[#5d6963]">
            {stage === 'email'
              ? 'Sign in by email to keep your notes safe and available on every device.'
              : `We sent it to ${email}.`}
          </p>

          <form
            className="mt-8"
            onSubmit={(event) => {
              event.preventDefault();
              void (stage === 'email' ? sendCode() : verifyCode());
            }}
          >
            {stage === 'email' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[#45524c]">Email address</span>
                <span className="relative block">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-[#5d6963]" aria-hidden="true">@</span>
                  <input
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="min-h-14 w-full rounded-2xl border border-[#d4ccbf] bg-[#fffdf8] py-3 pl-12 pr-4 text-base outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
                    placeholder="you@example.com"
                    disabled={busy}
                    required
                  />
                </span>
              </label>
            ) : (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[#45524c]">One-time code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  minLength={6}
                  maxLength={10}
                  value={token}
                  onChange={(event) => setToken(normalizeEmailOtp(event.target.value))}
                  className="min-h-16 w-full rounded-2xl border border-[#d4ccbf] bg-[#fffdf8] px-5 text-center font-mono text-2xl tracking-[0.22em] outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
                  placeholder="Paste code"
                  disabled={busy}
                  required
                  autoFocus
                />
              </label>
            )}

            <div className="min-h-12 pt-3 text-sm" aria-live="polite">
              {error && <p className="text-[#a4432b]">{error}</p>}
              {!error && message && <p className="text-[#52655b]">{message}</p>}
            </div>

            <button type="submit" disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#1d3930] px-5 text-base font-semibold text-[#fffdf8] shadow-[0_12px_30px_rgba(29,57,48,0.2)] transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-65">
              {busy && <span className="inline-block animate-spin text-lg" aria-hidden="true">↻</span>}
              {stage === 'email' ? 'Email me a code' : 'Open Evening Note'}
            </button>

            {stage === 'code' && (
              <button type="button" onClick={() => void sendCode()} disabled={busy || cooldown > 0} className="mt-3 min-h-12 w-full rounded-xl text-sm font-semibold text-[#52625a] disabled:opacity-55">
                {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
              </button>
            )}
          </form>
        </section>

        <p className="text-center text-xs leading-5 text-[#5d6963]">Your entries stay private to your signed-in account.</p>
      </div>
    </main>
  );
}
