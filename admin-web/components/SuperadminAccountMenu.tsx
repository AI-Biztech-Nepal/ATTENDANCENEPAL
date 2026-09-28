'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type ProfileSummary = { email: string; full_name: string; created_at: string | null };

// Same dropdown pattern as the tenant AccountMenu (components/AccountMenu.tsx)
// — deliberately not reused/imported directly, since that component's props
// are tied to the tenant role: 'admin' | 'hr' union (see SuperadminShell's
// isolation notes). Scoped down to what's relevant for a platform-owner
// account: no photo upload, no company_name/PAN/location fields — just
// display name, email (read-only), and password.
export default function SuperadminAccountMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data: userData }) => {
      if (!active || !userData.user) return;
      const { data } = await supabase.from('profiles').select('full_name, created_at').eq('id', userData.user.id).single();
      if (!active) return;
      setProfile({ email: userData.user.email ?? '', full_name: data?.full_name ?? '', created_at: data?.created_at ?? null });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const displayName = profile?.full_name || profile?.email || '?';

  function openEditProfile() {
    setOpen(false);
    setError(null);
    setFullName(profile?.full_name ?? '');
    setShowEdit(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSaving(false);
      setError('Your session expired — please sign in again.');
      return;
    }
    const { error: updateError } = await supabase.from('profiles').update({ full_name: fullName.trim() || null }).eq('id', userData.user.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    window.location.reload();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function openPasswordModal() {
    setOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
    setPasswordSuccess(false);
    setShowPassword(true);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setChangingPassword(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (updateError) {
      setPasswordError(updateError.message);
      return;
    }
    setPasswordSuccess(true);
    setNewPassword('');
    setConfirmPassword('');
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
            {displayName[0]?.toUpperCase() ?? '?'}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block max-w-[12rem] truncate text-sm font-semibold text-ink">{displayName}</span>
            <span className="block text-xs text-slate-500">Super Administrator</span>
          </span>
          <ChevronIcon className={`hidden h-4 w-4 shrink-0 text-slate-400 transition-transform sm:block ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-violet-100 via-violet-50 to-transparent p-4">
              <div className="min-w-0 pt-1">
                <div className="truncate text-sm font-semibold text-ink">{displayName}</div>
                <div className="text-xs text-slate-500">Super Administrator</div>
              </div>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 text-lg font-semibold text-white shadow-sm ring-2 ring-white">
                {displayName[0]?.toUpperCase() ?? '?'}
              </span>
            </div>

            <div className="space-y-2.5 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-500">
                  <MailIcon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{profile?.email || '—'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-good-bg text-good-text">
                  <CalendarDotIcon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">
                  Member since{' '}
                  {profile?.created_at
                    ? new Date(profile.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3">
              <button
                onClick={openEditProfile}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
              >
                <EditIcon className="h-3.5 w-3.5" />
                Edit Profile
              </button>
              <button
                onClick={openPasswordModal}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <KeyIcon className="h-3.5 w-3.5" />
                Change Password
              </button>
              <button
                onClick={handleSignOut}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-critical-bg px-3 py-2 text-xs font-semibold text-critical-text transition-colors hover:bg-critical/20"
              >
                <SignOutIcon className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {showEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowEdit(false)}>
          <form onSubmit={handleSave} onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Edit Profile</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  value={profile?.email ?? ''}
                  disabled
                  title="Sign-in email — read-only here"
                  className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Display Name</label>
                <input
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-critical">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowEdit(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showPassword && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowPassword(false)}>
          <form onSubmit={handleChangePassword} onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            {passwordSuccess ? (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Password changed</h3>
                <p className="mb-4 text-sm text-slate-500">Your password has been updated. Use it next time you sign in.</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowPassword(false)}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Change Password</h3>
                <p className="mb-4 text-xs text-slate-500">Sets a new password for your own login — you&apos;ll stay signed in.</p>
                <label className="mb-1 block text-xs font-medium text-slate-600">New password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
                <label className="mb-1 block text-xs font-medium text-slate-600">Confirm new password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
                {passwordError && <p className="mb-3 text-sm text-critical">{passwordError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowPassword(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                  >
                    {changingPassword ? 'Changing…' : 'Change password'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}
function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10.8 12.2 8-8M15.5 3.5l2 2M18.5 6.5l2 2" />
    </svg>
  );
}
function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
    </svg>
  );
}
function CalendarDotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
