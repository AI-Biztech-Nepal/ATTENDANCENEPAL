'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { manrope } from '@/lib/fonts';
import ConfigWarning from './ConfigWarning';
import CalendarSystemSwitch from './CalendarSystemSwitch';
import BodyFontClass from './BodyFontClass';

const TABS = [
  { href: '/checkin', label: 'Check In/Out', icon: CheckInIcon },
  { href: '/my-calendar', label: 'Calendar', icon: CalendarTabIcon },
  { href: '/my-payroll', label: 'Payroll', icon: PayrollTabIcon },
  { href: '/my-tasks', label: 'My Tasks', icon: TaskTabIcon },
  { href: '/my-profile', label: 'Profile', icon: ProfileTabIcon },
];

/**
 * The employee pages' frame. From `lg` up it is a deep-green sidebar (profile
 * block, the five pages, AD/BS, Sign out) — deliberately not the owner
 * console's navy sidebar + top bar. Below `lg` it is the mobile app's look: a
 * green header and a bottom tab bar with a dot under the open tab.
 *
 * `flush` is for pages that draw their own green hero panel edge to edge on
 * a phone and manage their own padding (Check In/Out). Pages that haven't
 * been redesigned yet keep the padded column they always had.
 */
export default function EmployeeShell({
  title,
  children,
  flush = false,
}: {
  title: string;
  children: React.ReactNode;
  flush?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'loading' | 'ready' | 'redirecting'>('loading');
  const [name, setName] = useState('Employee');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [designation, setDesignation] = useState<string | null>(null);
  const [linked, setLinked] = useState(true);
  const [isHr, setIsHr] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAccountMenu) return;
    function handlePointerDown(e: MouseEvent) {
      if (accountMenuRef.current?.contains(e.target as Node)) return;
      setShowAccountMenu(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showAccountMenu]);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, employee_id')
        .eq('id', data.session.user.id)
        .single();
      if (!active) return;
      if (!profile || (profile.role !== 'employee' && profile.role !== 'hr')) {
        // Admin has its own dashboard only — HR is also staff, so it gets
        // both this shell (their own check-in) and the admin console.
        setStatus('redirecting');
        router.replace('/');
        return;
      }
      setIsHr(profile.role === 'hr');
      if (!profile.employee_id) {
        setLinked(false);
        setName(data.session.user.email?.split('@')[0] ?? 'Employee');
        setStatus('ready');
        return;
      }
      const { data: emp } = await supabase
        .from('employees')
        .select('name, profile_photo_url, designation')
        .eq('id', profile.employee_id)
        .single();
      if (!active) return;
      setName(emp?.name ?? 'Employee');
      setPhotoUrl(emp?.profile_photo_url ?? null);
      setDesignation(emp?.designation ?? null);
      setStatus('ready');
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!supabaseConfigured) return <ConfigWarning />;
  if (status !== 'ready') {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || 'E';
  const isHome = pathname === '/checkin';

  return (
    <div className={`${manrope.className} flex min-h-screen flex-col bg-slate-100 text-ink lg:flex-row`}>
      <BodyFontClass className={manrope.className} />

      {/* Computer: the sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col self-start overflow-y-auto bg-brand-deep px-4 py-6 text-white lg:flex">
        <Link href="/checkin" className="flex items-center gap-3 px-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="h-8 w-8 object-contain" />
          </span>
          <span className="text-base font-extrabold leading-5">Attendance Nepal</span>
        </Link>

        <Link
          href="/my-profile"
          className="mt-6 flex items-center gap-3 rounded-2xl bg-white/10 p-3.5 hover:bg-white/[0.14]"
        >
          <AvatarCircle photoUrl={photoUrl} name={name} initials={initials} className="h-11 w-11 text-[15px]" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-extrabold">{name}</span>
            <span className="mt-px block truncate text-xs font-semibold text-white/80">{designation ?? 'Employee'}</span>
          </span>
        </Link>

        <nav aria-label="Employee pages" className="mt-6 flex flex-col gap-1">
          {TABS.map(tab => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-12 items-center gap-3 rounded-xl px-3.5 text-sm transition-colors ${
                  active ? 'bg-white font-extrabold text-brand' : 'font-bold text-white/90 hover:bg-white/10'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5 pt-6">
          <CalendarSystemSwitch variant="onDark" />
          {isHr && (
            // HR is staff too, so it can reach both sides; without this link
            // the admin console would be URL-only from here.
            <Link
              href="/"
              className="flex h-11 items-center gap-3 rounded-xl border border-white/30 px-3.5 text-[13px] font-bold hover:bg-white/10"
            >
              <HomeIcon className="h-[18px] w-[18px] shrink-0" />
              Admin Dashboard
            </Link>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="flex h-11 items-center gap-3 rounded-xl px-3.5 text-left text-[13px] font-bold text-white/90 hover:bg-white/10"
          >
            <SignOutIcon className="h-[18px] w-[18px] shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Phone: the green header (the page's own hero continues the band) */}
      <header className="bg-brand lg:hidden">
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          {isHome ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.png" alt="" className="h-8 w-8 object-contain" />
              </span>
              <span className="truncate text-[13px] font-bold text-white/90">Attendance Nepal</span>
            </div>
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold text-white">{title}</h1>
          )}
          <CalendarSystemSwitch variant="onDark" />
          <div ref={accountMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowAccountMenu(v => !v)}
              aria-label="Account menu"
              aria-expanded={showAccountMenu}
              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-extrabold text-brand"
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </button>
            {showAccountMenu && (
              <div className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white text-ink shadow-lg">
                <div className="truncate border-b border-slate-100 px-3.5 py-3 text-[13px] font-extrabold">{name}</div>
                {isHr && (
                  <Link href="/" className="block px-3.5 py-3 text-[13px] font-bold text-slate-700 hover:bg-slate-50">
                    Admin Dashboard
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="block w-full px-3.5 py-3 text-left text-[13px] font-bold text-critical-text hover:bg-slate-50"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col">
        {!linked && (
          <div className="mx-4 mt-4 rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning-text lg:mx-8">
            Your account isn&apos;t linked to an employee record yet. Ask an admin or HR to fix this from the Employees
            page before you can check in.
          </div>
        )}

        <main className={flush ? 'flex-1 pb-24 lg:pb-0' : 'mx-auto w-full max-w-3xl flex-1 p-4 pb-24 lg:max-w-5xl lg:p-8'}>
          {!flush && <h1 className="mb-5 hidden text-2xl font-extrabold tracking-tight lg:block">{title}</h1>}
          {children}
        </main>
      </div>

      {/* Phone: the bottom tab bar */}
      <nav
        aria-label="Employee pages"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] pt-1.5 lg:hidden"
      >
        {TABS.map(tab => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-[3px] py-1 text-[11px] ${
                active ? 'font-extrabold text-brand' : 'font-semibold text-slate-500'
              }`}
            >
              <Icon className="h-[22px] w-[22px]" />
              <span>{tab.label}</span>
              <span className={`h-[5px] w-[5px] rounded-full ${active ? 'bg-brand' : 'bg-transparent'}`} />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function AvatarCircle({
  photoUrl,
  name,
  initials,
  className,
}: {
  photoUrl: string | null;
  name: string;
  initials: string;
  className: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white font-extrabold text-brand ${className}`}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

type IconProps = { className?: string };
function CheckInIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.5 2.5 5-5" />
    </svg>
  );
}
function CalendarTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function PayrollTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path strokeLinecap="round" d="M3 10h18" />
      <circle cx="12" cy="14.5" r="2.25" />
    </svg>
  );
}
function TaskTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}
function ProfileTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </svg>
  );
}
function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5M5 10v10h14V10" />
    </svg>
  );
}
function SignOutIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
