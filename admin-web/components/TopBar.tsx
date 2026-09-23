'use client';

import CalendarSystemSwitch from './CalendarSystemSwitch';
import AccountMenu from './AccountMenu';

export default function TopBar({
  title,
  onOpenMenu,
  adminName,
  role,
}: {
  title: string;
  onOpenMenu: () => void;
  adminName: string;
  role: 'admin' | 'hr';
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            aria-label="Open menu"
            onClick={onOpenMenu}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <h1 className="truncate text-lg font-bold text-ink sm:text-2xl">{title}</h1>
          <CalendarSystemSwitch />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-5">
          <button aria-label="Notifications" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <BellIcon className="h-5 w-5" />
          </button>

          <div className="hidden h-8 w-px bg-slate-200 sm:block" />

          <AccountMenu adminName={adminName} role={role} />
        </div>
      </div>
    </header>
  );
}
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
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
