'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SuperadminAccountMenu from './SuperadminAccountMenu';

// Deliberately NOT built on AppShell/Sidebar/TopBar — those are structurally
// tied to the tenant role: 'admin' | 'hr' union, and reusing them here would
// entangle a platform-level view with tenant-scoped chrome. This is its own
// small, separate shell, styled to match the mockup's visual language
// (icon badges, card layout) but kept in violet — never teal — so it's
// never confusable with a tenant's own admin dashboard.
const NAV_ITEMS = [
  { href: '/superadmin', label: 'Dashboard', icon: HomeIcon },
  { href: '/superadmin/companies', label: 'Companies', icon: BuildingIcon },
];

export default function SuperadminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <aside className="flex h-screen w-64 shrink-0 flex-col bg-slate-950 text-slate-300">
        <div className="flex flex-col gap-0.5 px-5 pb-4 pt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Attendance Nepal" className="h-12 w-12" />
          <span className="mt-2 text-base font-semibold text-white">Attendance Nepal</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">Super Admin</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active ? 'bg-slate-800 font-medium text-violet-400' : 'hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-3 py-4">
          <Link href="/" className="block rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-white">
            ← Back to my dashboard
          </Link>
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-end gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
          <button aria-label="Notifications" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <BellIcon className="h-5 w-5" />
          </button>
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />
          <SuperadminAccountMenu />
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5M5 10v10h14V10" />
    </svg>
  );
}
function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path strokeLinecap="round" d="M8 7h1M8 11h1M8 15h1M15 7h1M15 11h1M15 15h1M10 21v-3h4v3" />
    </svg>
  );
}
function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path strokeLinecap="round" d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
