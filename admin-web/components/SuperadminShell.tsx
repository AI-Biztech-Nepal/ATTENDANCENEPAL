'use client';

import SuperadminAccountMenu from './SuperadminAccountMenu';
import CalendarSystemSwitch from './CalendarSystemSwitch';

// Deliberately NOT built on AppShell/TopBar — those are structurally tied to
// the tenant role: 'admin' | 'hr' union, and reusing them here would
// entangle a platform-level view with tenant-scoped chrome. This is its own
// small shell: a single top header (brand + calendar toggle + account), no
// side nav rail — the Dashboard's own "All Companies" section already is
// the company browser (search, sort, grid/list toggle), and every company
// card links straight into its own detail view.
export default function SuperadminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Attendance Nepal" className="h-8 w-8 shrink-0 object-contain" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-ink">Attendance Nepal</span>
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-violet-600">Super Admin</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <CalendarSystemSwitch />
          <button aria-label="Notifications" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <BellIcon className="h-5 w-5" />
          </button>
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />
          <SuperadminAccountMenu />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
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
