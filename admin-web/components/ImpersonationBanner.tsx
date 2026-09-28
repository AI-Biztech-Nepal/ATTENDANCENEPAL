'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ReturnSession = {
  returnAccessToken: string;
  returnRefreshToken: string;
  companyName: string;
  asEmail: string;
  asRole: string;
};

const STORAGE_KEY = 'impersonation_return';

// Shown across every tenant page while the current session is actually a
// superadmin's real "View their account" session — see
// CompanyDetailModal.handleImpersonate(), which stashes the superadmin's own
// tokens here (sessionStorage: tab-scoped, so it never leaks into another
// tab's session) right before switching this tab to the tenant login's
// session. "Return to Superadmin" restores those stashed tokens via
// supabase.auth.setSession() rather than a fresh sign-in.
export default function ImpersonationBanner() {
  const [info, setInfo] = useState<ReturnSession | null>(null);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setInfo(JSON.parse(raw));
    } catch {
      // sessionStorage unavailable (private window, blocked storage) — the
      // impersonated session still works, there's just no banner/way back
      // other than logging in again as the superadmin.
    }
  }, []);

  if (!info) return null;

  async function handleReturn() {
    setReturning(true);
    try {
      await supabase.auth.setSession({ access_token: info!.returnAccessToken, refresh_token: info!.returnRefreshToken });
    } finally {
      sessionStorage.removeItem(STORAGE_KEY);
      window.location.href = '/superadmin';
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-violet-600 px-4 py-2 text-xs text-white sm:px-6 sm:text-sm print:hidden">
      <span className="truncate">
        Viewing as <strong>{info.asEmail}</strong> ({info.asRole}) at <strong>{info.companyName}</strong> — actions here affect their real data.
      </span>
      <button
        onClick={handleReturn}
        disabled={returning}
        className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
      >
        {returning ? 'Returning…' : 'Return to Superadmin'}
      </button>
    </div>
  );
}
