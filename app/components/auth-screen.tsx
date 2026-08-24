'use client';

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PASSWORD_MIN_LENGTH,
  type AuthFlowMode,
  getAuthRedirectUrl,
  isPlausibleEmail,
  isValidPassword,
  normalizeEmail,
  passwordValidationMessage,
  recoveryRequestErrorMessage,
  signInErrorMessage,
  signUpErrorMessage,
} from '@/lib/auth';
import { publicConfig } from '@/lib/config';
import {
  requestPasswordRecovery,
  signInWithPassword,
  signUpWithPassword,
} from '@/lib/password-auth';
import { withBasePath } from '@/lib/paths';

type AuthScreenProps = {
  client: SupabaseClient;
  initialMode?: AuthFlowMode;
};

function currentSiteUrl(): string {
  if (publicConfig.siteUrl) return publicConfig.siteUrl;
  return `${window.location.origin}${withBasePath('/', publicConfig.basePath)}`;
}

type PasswordFieldProps = {
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: string) => void;
  show: boolean;
  toggleShow: () => void;
  value: string;
};

function PasswordField({ autoComplete, disabled, label, name, onChange, show, toggleShow, value }: PasswordFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-[#45524c]">{label}</span>
      <span className="relative block">
        <input
          type={show ? 'text' : 'password'}
          name={name}
          autoComplete={autoComplete}
          minLength={PASSWORD_MIN_LENGTH}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-14 w-full rounded-2xl border border-[#d4ccbf] bg-[#fffdf8] px-4 py-3 pr-20 text-base outline-none transition focus:border-[#637970] focus:ring-4 focus:ring-[#637970]/10"
          disabled={disabled}
          required
        />
        <button
          type="button"
          onClick={toggleShow}
          className="absolute inset-y-1 right-1 min-w-16 rounded-xl px-3 text-xs font-semibold text-[#52625a]"
          aria-label={`${show ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  );
}

export function AuthScreen({ client, initialMode = 'sign-in' }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthFlowMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function changeMode(nextMode: AuthFlowMode) {
    setMode(nextMode);
    setPassword('');
    setConfirmation('');
    setShowPassword(false);
    setMessage('');
    setError('');
  }

  async function submit() {
    const normalizedEmail = normalizeEmail(email);
    if (!isPlausibleEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    if (mode === 'sign-in' && !isValidPassword(password)) {
      setError(`Enter your password of at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    if (mode === 'sign-up') {
      const validationError = passwordValidationMessage(password, confirmation);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'sign-in') {
        const { error: authError } = await signInWithPassword(client, normalizedEmail, password);
        if (authError) setError(signInErrorMessage(authError));
        return;
      }

      if (mode === 'sign-up') {
        const { data, error: authError } = await signUpWithPassword(
          client,
          normalizedEmail,
          password,
          getAuthRedirectUrl(currentSiteUrl()),
        );
        if (authError) {
          setError(signUpErrorMessage(authError));
          return;
        }
        if (!data.session) {
          setPassword('');
          setConfirmation('');
          setMessage('Check your email to confirm your account, then return to Evening Note.');
        }
        return;
      }

      const { error: authError } = await requestPasswordRecovery(
        client,
        normalizedEmail,
        getAuthRedirectUrl(currentSiteUrl(), 'recovery'),
      );
      if (authError) {
        setError(recoveryRequestErrorMessage(authError));
        return;
      }
      setMessage('If an account exists for that email, we sent a password reset link.');
    } catch (caughtError) {
      if (mode === 'sign-in') setError(signInErrorMessage(caughtError));
      else if (mode === 'sign-up') setError(signUpErrorMessage(caughtError));
      else setError(recoveryRequestErrorMessage(caughtError));
    } finally {
      setBusy(false);
    }
  }

  const isForgot = mode === 'forgot';
  const heading = isForgot
    ? 'Find your way back.'
    : mode === 'sign-up'
      ? 'Begin your evening ritual.'
      : 'A quiet moment, every evening.';

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

        <section className="my-auto py-12">
          {isForgot && (
            <button type="button" onClick={() => changeMode('sign-in')} className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-[#52625a]">
              <span className="text-lg" aria-hidden="true">←</span> Back to sign in
            </button>
          )}

          <p className="mb-3 text-sm font-medium text-[#5d6963]">
            {isForgot ? 'Reset your password' : mode === 'sign-up' ? 'Create an account' : 'Welcome back'}
          </p>
          <h1 className="max-w-sm font-serif text-[2.65rem] leading-[1.03] tracking-[-0.035em]">{heading}</h1>
          <p className="mt-4 max-w-sm text-[15px] leading-6 text-[#5d6963]">
            {isForgot
              ? 'Enter your email and we will send a secure password reset link.'
              : mode === 'sign-up'
                ? 'Create one private account for notes that follow you between devices.'
                : 'Sign in to write today’s note and revisit the evenings before it.'}
          </p>

          {!isForgot && (
            <div className="mt-7 grid grid-cols-2 rounded-2xl bg-[#e9e4da] p-1" aria-label="Authentication mode">
              {(['sign-in', 'sign-up'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => changeMode(item)}
                  disabled={busy}
                  className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition ${mode === item ? 'bg-[#fffdf8] text-[#1d3930] shadow-sm' : 'text-[#68736d]'}`}
                  aria-pressed={mode === item}
                >
                  {item === 'sign-in' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#45524c]">Email address</span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-[#5d6963]" aria-hidden="true">@</span>
                <input
                  type="email"
                  name="email"
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

            {!isForgot && (
              <PasswordField
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                disabled={busy}
                label="Password"
                name="password"
                onChange={setPassword}
                show={showPassword}
                toggleShow={() => setShowPassword((value) => !value)}
                value={password}
              />
            )}

            {mode === 'sign-up' && (
              <>
                <PasswordField
                  autoComplete="new-password"
                  disabled={busy}
                  label="Confirm password"
                  name="password-confirmation"
                  onChange={setConfirmation}
                  show={showPassword}
                  toggleShow={() => setShowPassword((value) => !value)}
                  value={confirmation}
                />
                <p className="text-xs leading-5 text-[#68736d]">Use at least {PASSWORD_MIN_LENGTH} characters.</p>
              </>
            )}

            {mode === 'sign-in' && (
              <button type="button" onClick={() => changeMode('forgot')} disabled={busy} className="min-h-11 rounded-xl text-sm font-semibold text-[#52625a]">
                Forgot password?
              </button>
            )}

            <div className="min-h-12 text-sm" aria-live="polite">
              {error && <p className="text-[#a4432b]">{error}</p>}
              {!error && message && <p className="leading-5 text-[#52655b]">{message}</p>}
            </div>

            <button type="submit" disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#1d3930] px-5 text-base font-semibold text-[#fffdf8] shadow-[0_12px_30px_rgba(29,57,48,0.2)] transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-65">
              {busy && <span className="inline-block animate-spin text-lg" aria-hidden="true">↻</span>}
              {isForgot ? 'Send reset link' : mode === 'sign-up' ? 'Create account' : 'Open Evening Note'}
            </button>
          </form>
        </section>

        <p className="text-center text-xs leading-5 text-[#5d6963]">Your entries stay private to your signed-in account.</p>
      </div>
    </main>
  );
}
