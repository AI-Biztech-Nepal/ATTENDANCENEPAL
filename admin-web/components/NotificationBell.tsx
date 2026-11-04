'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Avatar from './Avatar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { usePendingApprovals, timeAgo } from '@/lib/pendingApprovals';
import { BIRTHDAY_LOOKAHEAD_DAYS, exitLabel, formatDayMonth, useHrAlerts } from '@/lib/hrAlerts';
import { formatAdDate } from '@/lib/calendar';

const BIRTHDAYS_SHOWN = 8;

const EXIT_TONES = {
  bad: 'bg-critical-bg text-critical-text',
  warn: 'bg-warning-bg text-warning-text',
  info: 'bg-info-bg text-info-text',
  neutral: 'bg-slate-100 text-slate-600',
} as const;

/** The top bar's bell. Its badge counts what needs doing — approvals waiting,
 * contracts ending or already ended, resignations HR has not started on, and
 * birthdays that are today; the panel also lists everyone with an exit under
 * way and the birthdays coming up this month. */
export default function NotificationBell() {
  const pathname = usePathname();
  const { system } = useCalendarSystem();
  const pending = usePendingApprovals();
  const { contracts, birthdays, exits } = useHrAlerts(system, pathname);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const birthdaysToday = birthdays.filter(b => b.daysAway === 0).length;
  const newResignations = exits.filter(e => e.kind === 'handed_in').length;
  const badge = pending.total + contracts.length + newResignations + birthdaysToday;

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

  const approvals = [
    { label: 'GPS check-ins', href: '/corrections', queue: pending.gps },
    { label: 'Missed-punch corrections', href: '/corrections', queue: pending.corrections },
    { label: 'Leave requests', href: '/leave', queue: pending.leave },
  ].filter(a => a.queue.count > 0);
  const nothing = approvals.length === 0 && contracts.length === 0 && exits.length === 0 && birthdays.length === 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={badge > 0 ? `Notifications, ${badge} waiting` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      >
        <BellIcon className="h-[18px] w-[18px]" />
        {badge > 0 && (
          <span className="absolute -right-[5px] -top-[5px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#dc2626] px-[5px] text-[10px] font-extrabold text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-3 top-[72px] z-40 max-h-[calc(100vh-88px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_16px_48px_rgba(15,23,42,0.18)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[390px] sm:max-h-[min(760px,calc(100vh-110px))]"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
            <h2 className="text-sm font-extrabold text-ink">Notifications</h2>
            {badge > 0 && <span className="text-xs font-semibold text-slate-500">{badge} need attention</span>}
          </div>

          {nothing && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-ink">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-slate-500">No approvals waiting, no resignations, no contracts ending and no birthdays coming up.</p>
            </div>
          )}

          {approvals.length > 0 && (
            <Section title="Needs your approval" count={pending.total}>
              {approvals.map(a => (
                <Row key={a.label} href={a.href} onNavigate={() => setOpen(false)}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-bg text-sm font-extrabold text-warning-text">
                    {a.queue.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{a.label}</span>
                    {a.queue.oldest && (
                      <span className="block text-xs text-slate-500">Oldest waiting {timeAgo(a.queue.oldest.created_at)}</span>
                    )}
                  </span>
                  <Chevron />
                </Row>
              ))}
            </Section>
          )}

          {exits.length > 0 && (
            <Section title="Resignations & exits" count={exits.length}>
              {exits.map(e => {
                const label = exitLabel(e);
                const when = e.lastWorkingOn ? `Last day ${formatAdDate(e.lastWorkingOn, system)}` : e.handedInOn ? `Handed in ${formatAdDate(e.handedInOn, system)}` : '';
                return (
                  <Row key={e.id} href={`/employees/${e.id}?tab=exit`} onNavigate={() => setOpen(false)}>
                    <Avatar name={e.name} photoUrl={e.photoUrl} className="h-8 w-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{e.name}</span>
                      <span className="block truncate text-xs text-slate-500">{e.designation ?? 'Employee'}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold ${EXIT_TONES[label.tone]}`}>{label.text}</span>
                      {when && <span className="mt-0.5 block text-[11px] text-slate-500">{when}</span>}
                    </span>
                  </Row>
                );
              })}
            </Section>
          )}

          {contracts.length > 0 && (
            <Section title="Contracts ending" count={contracts.length}>
              {contracts.map(c => {
                const ended = c.daysLeft < 0;
                return (
                  <Row key={c.id} href={`/employees/${c.id}`} onNavigate={() => setOpen(false)}>
                    <Avatar name={c.name} photoUrl={c.photoUrl} className="h-8 w-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                      <span className="block truncate text-xs text-slate-500">{c.designation ?? 'Contract'}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                          ended ? 'bg-critical-bg text-critical-text' : 'bg-warning-bg text-warning-text'
                        }`}
                      >
                        {contractLabel(c.daysLeft)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">{formatAdDate(c.endKey, system)}</span>
                    </span>
                  </Row>
                );
              })}
            </Section>
          )}

          {birthdays.length > 0 && (
            <Section title={`Birthdays · next ${BIRTHDAY_LOOKAHEAD_DAYS} days`} count={birthdays.length}>
              {birthdays.slice(0, BIRTHDAYS_SHOWN).map(b => (
                <Row key={b.id} href={`/employees/${b.id}`} onNavigate={() => setOpen(false)}>
                  <Avatar name={b.name} photoUrl={b.photoUrl} className="h-8 w-8 text-xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{b.name}</span>
                    <span className="block truncate text-xs text-slate-500">Turns {b.turning}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                        b.daysAway === 0 ? 'bg-good-bg text-good-text' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {birthdayLabel(b.daysAway)}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">{formatDayMonth(b.dateKey, system)}</span>
                  </span>
                </Row>
              ))}
              {birthdays.length > BIRTHDAYS_SHOWN && (
                <p className="px-4 pb-1 pt-2 text-xs text-slate-500">
                  and {birthdays.length - BIRTHDAYS_SHOWN} more in the next {BIRTHDAY_LOOKAHEAD_DAYS} days
                </p>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function contractLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const ago = -daysLeft;
    return `Ended ${ago} day${ago === 1 ? '' : 's'} ago`;
  }
  if (daysLeft === 0) return 'Ends today';
  if (daysLeft === 1) return 'Ends tomorrow';
  return `Ends in ${daysLeft} days`;
}

function birthdayLabel(daysAway: number): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return `In ${daysAway} days`;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-100 py-2 last:border-b-0">
      <h3 className="flex items-center justify-between px-4 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-500">
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-600">{count}</span>
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function Row({ href, onNavigate, children }: { href: string; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} onClick={onNavigate} className="flex items-center gap-3 px-4 py-1.5 hover:bg-slate-50">
        {children}
      </Link>
    </li>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
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
