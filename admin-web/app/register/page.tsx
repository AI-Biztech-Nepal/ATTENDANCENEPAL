'use client';

import { useEffect } from 'react';
import AuthCard from '@/components/AuthCard';

// Accounts are created in the AIBIZTECH portal
export default function RegisterPage() {
  useEffect(() => {
    window.location.href = '/signup';
  }, []);
  return (
    <AuthCard>
      <p className="text-center text-sm text-slate-500">Taking you to sign up…</p>
    </AuthCard>
  );
}
