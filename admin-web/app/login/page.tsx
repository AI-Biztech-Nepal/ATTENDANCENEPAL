'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AuthCard from '@/components/AuthCard';

// Sign-in is the AIBIZTECH portal's: signed in already means straight in, otherwise go there and come back
export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/');
      else window.location.href = '/login?next=' + encodeURIComponent('/attendance');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AuthCard>
      <p className="text-center text-sm text-slate-500">Signing you in…</p>
    </AuthCard>
  );
}
