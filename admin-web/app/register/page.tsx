'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import AuthCard from '@/components/AuthCard';
import ConfigWarning from '@/components/ConfigWarning';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [location, setLocation] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    // Goes through /api/register (service-role, email_confirm: true) instead
    // of supabase.auth.signUp() so no confirmation email is sent — the
    // account is created already-confirmed and signed in immediately below.
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, companyName, location, email, password }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setSubmitting(false);
      setError(body.error ?? 'Could not create the account.');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push('/');
  }

  return (
    <AuthCard title="Sign Up">
      <form onSubmit={handleSubmit}>
        <label className="mb-0.5 block text-xs font-medium text-slate-700">Company name</label>
        <input
          type="text"
          required
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          className="mb-2.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <label className="mb-0.5 block text-xs font-medium text-slate-700">Location</label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          className="mb-2.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <label className="mb-0.5 block text-xs font-medium text-slate-700">Full name</label>
        <input
          type="text"
          required
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          className="mb-2.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <label className="mb-0.5 block text-xs font-medium text-slate-700">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="mb-2.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <label className="mb-0.5 block text-xs font-medium text-slate-700">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="mb-2.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <label className="mb-0.5 block text-xs font-medium text-slate-700">Confirm password</label>
        <input
          type="password"
          required
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          className="mb-2.5 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {error && <p className="mb-4 text-sm text-critical">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
        <p className="mt-2 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
