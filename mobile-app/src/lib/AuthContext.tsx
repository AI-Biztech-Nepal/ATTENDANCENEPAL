import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { registerForPushNotifications } from './pushNotifications';
import { API_BASE } from './accountsApi';
import type { Profile } from '../types';

type FullProfile = Profile & {
  full_name: string | null;
  company_name: string | null;
  location: string | null;
  photo_url: string | null;
  created_at: string | null;
};

type AuthContextValue = {
  session: Session | null;
  profile: FullProfile | null;
  loading: boolean;
  /** null while the superadmin allowlist check for this session is in flight. */
  isSuperadmin: boolean | null;
  refreshProfile: () => void;
  /** True for the one render right after an interactive sign-in (the user
   * just typed their password) — false for a session restored on cold
   * start. Lets the biometric lock skip itself right after login (already
   * proved identity once) while still locking when the app is reopened
   * with a session left over from before. Consumed via clearJustSignedIn
   * so it doesn't linger true for the rest of the session. */
  justSignedIn: boolean;
  clearJustSignedIn: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  isSuperadmin: null,
  refreshProfile: () => {},
  justSignedIn: false,
  clearJustSignedIn: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState<boolean | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [justSignedIn, setJustSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN') setJustSignedIn(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as FullProfile));
  }, [session, refreshTick]);

  // Superadmin is a server-side email allowlist (SUPERADMIN_EMAILS), not a
  // profiles.role, so the only way to know is to ask the same endpoint the
  // web app uses. Superadmins have no tenant data, so without this they
  // landed in an empty employee/admin shell.
  useEffect(() => {
    if (!session) {
      setIsSuperadmin(null);
      return;
    }
    let active = true;
    setIsSuperadmin(null);
    fetch(`${API_BASE}/api/superadmin/me`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(res => res.json())
      .then(body => active && setIsSuperadmin(body?.isSuperadmin === true))
      .catch(() => active && setIsSuperadmin(false));
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  // Best-effort — registers this device for Week-off (and future) push
  // notifications once we know which employee is logged in. No-ops quietly
  // on simulators or before a real EAS projectId is configured (see
  // lib/pushNotifications.ts), so it never blocks login on an incomplete
  // push setup.
  useEffect(() => {
    if (profile?.employee_id) registerForPushNotifications(profile.employee_id).catch(() => {});
  }, [profile?.employee_id]);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        isSuperadmin,
        refreshProfile: () => setRefreshTick(t => t + 1),
        justSignedIn,
        clearJustSignedIn: () => setJustSignedIn(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
