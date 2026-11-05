'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { timeAgo } from '@/lib/pendingApprovals';
import { notificationLines, notificationTitle, type EmployeeNotification } from '@/lib/employeeNotifications';

type Notifications = { items: EmployeeNotification[]; unread: number; markAllRead: () => Promise<void> };

/** The employee portal's bell: what HR has done about them — today, changes to their exit. The badge counts what
 * they have not read; the unread ones are highlighted, and "Mark all as read" clears both. `notes` comes from the
 * shell so the phone and computer headers share one fetch. */
export default function EmployeeBell({ notes, variant }: { notes: Notifications; variant: 'onDark' | 'portal' }) {
  const pathname = usePathname();
  const { system } = useCalendarSystem();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { items, unread, markAllRead } = notes;

  function toggle() {
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Moving to another page closes the panel.
  useEffect(() => setOpen(false), [pathname]);

  const buttonClass =
    variant === 'onDark'
      ? 'h-9 w-9 rounded-full bg-white/15 text-white hover:bg-white/25'
      : 'h-[42px] w-[42px] rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative flex items-center justify-center ${buttonClass}`}
      >
        <BellIcon className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-[5px] -top-[5px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#dc2626] px-[5px] text-[10px] font-extrabold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-3 top-[72px] z-40 max-h-[calc(100vh-88px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white text-ink shadow-[0_16px_48px_rgba(15,23,42,0.18)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[390px] sm:max-h-[min(640px,calc(100vh-110px))]"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
            <h2 className="text-sm font-extrabold text-ink">Notifications</h2>
            {unread > 0 && (
              <span className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500">{unread} new</span>
                <button type="button" onClick={() => markAllRead()} className="text-xs font-extrabold text-accent hover:underline">
                  Mark all as read
                </button>
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-ink">Nothing new</p>
              <p className="mt-1 text-xs text-slate-500">When HR updates something about you, it shows up here.</p>
            </div>
          ) : (
            <ul>
              {items.map(n => {
                const lines = notificationLines(n, system);
                const fresh = !n.read_at;
                return (
                  <li key={n.id} className="border-b border-slate-100 last:border-b-0">
                    <Link href="/my-profile?tab=exit" onClick={() => setOpen(false)} className={`block px-4 py-3 hover:bg-slate-50 ${fresh ? 'bg-accent/5' : ''}`}>
                      <span className="flex items-start gap-2">
                        <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${fresh ? 'bg-accent' : 'bg-transparent'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold text-ink">{notificationTitle(n)}</span>
                            <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(n.created_at)}</span>
                          </span>
                          {lines.map((line, i) => (
                            <span key={i} className="mt-0.5 block text-xs text-slate-600">
                              {line}
                            </span>
                          ))}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
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
