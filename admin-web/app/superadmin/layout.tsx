'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import SuperadminShell from '@/components/SuperadminShell';
import ConfigWarning from '@/components/ConfigWarning';

// Mirrors AppShell's loading/check/redirect shape, but the check itself is
// different on purpose: AppShell reads profiles.role, a value RLS lets a
// user read about themselves. There's no equivalent row for "is this user's
// email in SUPERADMIN_EMAILS" — that's a server-only env var — so the client
// has to ask the server via /api/superadmin/me instead of computing it
// itself. That request (and every other /api/superadmin/* call) is the real
// gate; this redirect is UX only.
export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ready' | 'redirecting'>('loading');

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/superadmin/me', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const body = await res.json().catch(() => ({ isSuperadmin: false }));
      if (!active) return;
      if (!body.isSuperadmin) {
        setStatus('redirecting');
        router.replace('/');
        return;
      }
      setStatus('ready');
    });
    return () => {
      active = false;
    };
  }, [router]);

  if (!supabaseConfigured) {
    return <ConfigWarning />;
  }
  if (status !== 'ready') {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  return <SuperadminShell>{children}</SuperadminShell>;
}
