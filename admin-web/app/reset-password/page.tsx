'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import AuthCard from '@/components/AuthCard';
import ConfigWarning from '@/components/ConfigWarning';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    // The recovery link lands here with a token in the URL; supabase-js
    // parses it automatically and fires PASSWORD_RECOVERY once the session
    // from that token is established. Recovery links include `type=recovery`
    // in the URL — checked below so the getSession() fallback (needed for a
    // real race: the shared `supabase` client can parse the token and fire
    // this event before this page's own listener has attached) only trusts
    // an existing session when the URL actually shows this was a recovery
    // link, not just "the visitor happens to already be logged in" (e.g. a
    // stale reset link opened in a tab where they never logged out).
    const cameFromRecoveryLink =
      window.location.hash.includes('type=recovery') || new URLSearchParams(window.location.search).get('type') === 'recovery';
    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && cameFromRecoveryLink) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return <ConfigWarning />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push('/'), 1500);
  }

  return (
    <AuthCard title="Set New Password">
      {!ready && !done && (
        <p className="text-sm text-slate-500">
          Waiting for the reset link&apos;s token… if you opened this page directly instead of from your email, go back
          and use the reset link instead.
        </p>
      )}
      {done && <p className="text-sm text-good-text">Password updated. Redirecting…</p>}
      {ready && !done && (
        <form onSubmit={handleSubmit}>
          <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
          <input
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <label className="mb-1 block text-sm font-medium text-slate-700">Confirm new password</label>
          <input
            type="password"
            required
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {error && <p className="mb-4 text-sm text-critical">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Update password'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
