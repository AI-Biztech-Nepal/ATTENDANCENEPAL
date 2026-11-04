'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { manrope } from '@/lib/fonts';
import { PageTitleProvider, usePageTitle } from '@/lib/pageTitle';
import { formatTodayLine } from '@/lib/calendar';
import { nepalTodayIso } from '@/lib/shift';
import ConfigWarning from './ConfigWarning';
import CalendarSystemSwitch from './CalendarSystemSwitch';
import EmployeeBell from './EmployeeBell';
import { useMyNotifications } from '@/lib/employeeNotifications';
import BodyFontClass from './BodyFontClass';

const TABS = [
  { href: '/checkin', label: 'Check In/Out', icon: CheckInIcon },
  { href: '/my-calendar', label: 'Calendar', icon: CalendarTabIcon },
  { href: '/my-payroll', label: 'Payroll', icon: PayrollTabIcon },
  { href: '/my-tasks', label: 'My Tasks', icon: TaskTabIcon },
  { href: '/my-profile', label: 'Profile', icon: ProfileTabIcon },
];

/**
 * The employee pages' frame, mounted ONCE by app/(employee)/layout.tsx and kept
 * across page changes — like the owner console's AppShellLayout, so the sidebar
 * (and whether it is open) and the header survive a navigation instead of being
 * rebuilt by every page. Pages call `usePageTitle('Payroll')` to set the header's
 * title; a sub-page passes the page it came from as the second argument
 * (`usePageTitle('Leave Requests', 'Check In/Out')`) and the header shows it as a
 * breadcrumb before the title.
 *
 * From `lg` up it wears the owner console's shell — the dark sidebar and a white
 * top header (page name, AD/BS switch, account menu). Below `lg` it is the mobile
 * app's look: a green header and a bottom tab bar with a dot under the open tab.
 * Pages draw their own green panel edge to edge on a phone and manage their own
 * padding.
 */
export default function EmployeeShell({ children }: { children: React.ReactNode }) {
  return (
    <PageTitleProvider>
      <EmployeeShellInner>{children}</EmployeeShellInner>
    </PageTitleProvider>
  );
}

function EmployeeShellInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { title, eyebrow } = usePageTitle();
  const [status, setStatus] = useState<'loading' | 'ready' | 'redirecting'>('loading');
  const [name, setName] = useState('Employee');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [designation, setDesignation] = useState<string | null>(null);
  const [linked, setLinked] = useState(true);
  const [isHr, setIsHr] = useState(false);
  // One fetch for both headers (phone and computer); reloaded as the person moves around the portal.
  const notifications = useMyNotifications(pathname);

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
  const account = { name, designation, photoUrl, initials, isHr, onSignOut: handleSignOut };

  return (
    // `theme-employee` (app/globals.css) is what makes the accent / good / info colours one green and slate
    // for the whole portal; it is also put on <body> so dialogs and pickers rendered outside this div match.
    <div className={`theme-employee ${manrope.className} flex min-h-screen flex-col bg-slate-100 text-ink lg:h-screen lg:flex-row lg:overflow-hidden`}>
      <BodyFontClass className={`${manrope.className} theme-employee`} />

      {/* Computer: the sidebar, the owner console's look and behaviour */}
      <DesktopSidebar pathname={pathname} />

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
              <h1 className="sr-only">{title}</h1>
            </div>
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold text-white">{title}</h1>
          )}
          <CalendarSystemSwitch variant="onDark" />
          <EmployeeBell notes={notifications} variant="onDark" />
          <AccountMenu variant="phone" {...account} />
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
        {/* Computer: the owner console's white top header */}
        <header className="hidden shrink-0 border-b border-slate-200 bg-white lg:flex lg:items-center lg:justify-between lg:gap-4 lg:px-7 lg:py-4">
          <div className="flex min-w-0 items-center gap-1.5">
            {eyebrow && (
              <>
                <span className="shrink-0 text-base font-bold text-slate-600">{eyebrow}</span>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
              </>
            )}
            <h1 className="truncate text-2xl font-extrabold leading-8 tracking-[-0.01em]">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3.5">
            <span className="hidden text-[13px] font-semibold tabular-nums text-slate-600 xl:inline">{formatTodayLine(nepalTodayIso())}</span>
            <CalendarSystemSwitch variant="portal" />
            <EmployeeBell notes={notifications} variant="portal" />
            <span aria-hidden="true" className="h-8 w-px bg-slate-200" />
            <AccountMenu variant="desktop" {...account} />
          </div>
        </header>

        {!linked && (
          <div className="mx-4 mt-4 rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning-text lg:mx-8">
            Your account isn&apos;t linked to an employee record yet. Ask an admin or HR to fix this from the Employees
            page before you can check in.
          </div>
        )}

        <main className="flex-1 pb-24 lg:min-h-0 lg:overflow-y-auto lg:pb-0">{children}</main>
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

/**
 * The computer's sidebar, built the way the owner console's Sidebar is: at rest a
 * 64px icon rail; clicking an icon opens it to the full width, pushing the page
 * across, and it folds back when the pointer leaves. The animation is the same:
 * the width slides over 200ms, the labels fade (out at once, back in once it is
 * about half open, so they are never drawn clipped), the logo shrinks and its
 * name closes with it, and each row's left padding moves the icon from the rail's
 * centre to the open position instead of jumping.
 *
 * Two additions the console doesn't need: a click or tap anywhere else folds it
 * (a touch screen never sends a mouse-leave), and tabbing into the rail opens it.
 */
function DesktopSidebar({ pathname }: { pathname: string }) {
  const [expanded, setExpanded] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const rail = !expanded;

  useEffect(() => {
    if (!expanded) return;
    function handlePointerDown(e: PointerEvent) {
      if (!asideRef.current?.contains(e.target as Node)) setExpanded(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [expanded]);

  const hideWhenRail = `transition-opacity ${rail ? 'pointer-events-none opacity-0 duration-100' : 'delay-100 duration-150'}`;
  // Rows keep one left-aligned position and only their padding animates, landing
  // where centring would put the icon in the 64px rail (16 + 20 + 16 = 52px).
  const rowPadding = rail ? 'pl-4' : 'pl-3';

  return (
    <aside
      ref={asideRef}
      onMouseLeave={() => setExpanded(false)}
      onFocus={e => {
        if ((e.target as Element).matches(':focus-visible')) setExpanded(true);
      }}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExpanded(false);
      }}
      className={`hidden h-screen shrink-0 flex-col overflow-hidden bg-sidebar text-slate-300 transition-[width] duration-200 lg:flex ${
        rail ? 'w-16' : 'w-60'
      }`}
    >
      <Link href="/checkin" onClick={() => setExpanded(true)} className="flex flex-col items-center gap-0.5 overflow-hidden px-3 pb-1 pt-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-mark.png"
          alt=""
          className={`shrink-0 object-contain transition-all duration-200 ${rail ? 'h-[30px] w-[30px]' : 'h-28 w-28'}`}
        />
        {/* Its height closes with the width so the pages don't jump up when the name goes. */}
        <span className={`block overflow-hidden transition-[height,margin] duration-200 ${rail ? '-mt-0.5 h-0' : 'h-7'}`}>
          <span className={`block whitespace-nowrap text-lg font-semibold leading-7 text-white ${hideWhenRail}`}>Attendance Nepal</span>
        </span>
      </Link>

      <nav
        aria-label="Employee pages"
        className={`sidebar-scroll mt-2 flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pb-4 transition-[padding] duration-200 ${
          rail ? 'px-1.5' : 'px-3'
        }`}
      >
        {TABS.map(tab => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => setExpanded(true)}
              title={tab.label}
              aria-current={active ? 'page' : undefined}
              className={`flex h-11 min-w-0 items-center gap-3 overflow-hidden rounded-lg pr-3 text-sm transition-[padding,background-color,color] duration-200 ${rowPadding} ${
                active ? 'bg-emerald-400/[0.16] font-bold text-emerald-300' : 'font-medium text-slate-300 hover:bg-sidebar-active/60 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className={`whitespace-nowrap ${hideWhenRail}`}>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * Who you are, with the way out: the avatar on a phone's green header, the
 * name + designation chip on a computer's white one. Same dropdown for both —
 * Sign out, and for HR the way back to the admin console.
 */
function AccountMenu({
  variant,
  name,
  designation,
  photoUrl,
  initials,
  isHr,
  onSignOut,
}: {
  variant: 'phone' | 'desktop';
  name: string;
  designation: string | null;
  photoUrl: string | null;
  initials: string;
  isHr: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const avatar = (className: string) => (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full font-extrabold ${className}`}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );

  return (
    <div ref={ref} className="relative shrink-0">
      {variant === 'phone' ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label="Account menu"
          aria-expanded={open}
          className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-extrabold text-brand"
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label="Account menu"
          aria-expanded={open}
          className="flex h-11 items-center gap-2.5 rounded-full py-1 pl-1.5 pr-2.5 hover:bg-slate-100"
        >
          {avatar('h-8 w-8 bg-brand-light text-sm text-brand')}
          <span className="text-left leading-tight">
            <span className="block max-w-[10rem] truncate text-sm font-semibold">{name}</span>
            <span className="block max-w-[10rem] truncate text-xs font-medium text-[#586474]">{designation ?? 'Employee'}</span>
          </span>
          <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#586474] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white text-ink shadow-lg">
          <div className="border-b border-slate-100 px-3.5 py-3">
            <div className="truncate text-[13px] font-extrabold">{name}</div>
            {designation && <div className="truncate text-xs font-medium text-[#586474]">{designation}</div>}
          </div>
          {isHr && (
            // HR is staff too, so it can reach both sides; without this link
            // the admin console would be URL-only from here.
            <Link href="/" className="block px-3.5 py-3 text-[13px] font-bold text-slate-700 hover:bg-slate-50">
              Admin Dashboard
            </Link>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="block w-full px-3.5 py-3 text-left text-[13px] font-bold text-critical-text hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
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
function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}
function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}
