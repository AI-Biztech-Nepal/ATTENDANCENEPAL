'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CalendarSystemSwitch from './CalendarSystemSwitch';
import AccountMenu from './AccountMenu';
import { usePendingApprovals } from '@/lib/pendingApprovals';

export default function TopBar({
  title,
  eyebrow,
  onOpenMenu,
  adminName,
  role,
}: {
  title: string;
  eyebrow?: string;
  onOpenMenu: () => void;
  adminName: string;
  role: 'admin' | 'hr';
}) {
  const router = useRouter();
  const pending = usePendingApprovals();
  const [query, setQuery] = useState('');
  // The bell opens whichever page holds what's waiting — GPS check-ins and
  // corrections are both reviewed on Corrections.
  const bellHref = pending.gps.count + pending.corrections.count > 0 ? '/corrections' : '/leave';

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/employees?search=${encodeURIComponent(q)}` : '/employees');
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-7">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            aria-label="Open menu"
            onClick={onOpenMenu}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            {eyebrow && <div className="text-xs font-extrabold uppercase tracking-[0.06em] text-[#586474]">{eyebrow}</div>}
            <h1 className="truncate text-lg font-extrabold tracking-tight text-ink sm:text-2xl">{title}</h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3.5">
          <form onSubmit={search} className="hidden md:block">
            <label className="flex h-[42px] w-[300px] items-center gap-2 rounded-xl bg-slate-100 px-3.5 text-[#586474]">
              <SearchIcon className="h-4 w-4 shrink-0" />
              <span className="sr-only">Search employees</span>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search employees, code, branch"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-slate-500"
              />
            </label>
          </form>

          <CalendarSystemSwitch variant="pill" />

          <Link
            href={bellHref}
            aria-label={pending.total > 0 ? `Notifications, ${pending.total} waiting` : 'Notifications'}
            className="relative flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <BellIcon className="h-[18px] w-[18px]" />
            {pending.total > 0 && (
              <span className="absolute -right-[5px] -top-[5px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#dc2626] px-[5px] text-[10px] font-extrabold text-white">
                {pending.total}
              </span>
            )}
          </Link>

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

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
