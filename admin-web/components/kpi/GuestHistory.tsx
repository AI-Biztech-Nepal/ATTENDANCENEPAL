'use client';

import { createContext, useContext, useState } from 'react';
import ReportDialog from './ReportDialog';
import { KPI_COLORS } from './KpiCharts';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatAdDate } from '@/lib/calendar';
import { useKpiSettings } from '@/lib/useKpiSettings';
import { summariseGuest, useGuestHistory, type GuestAnchor } from '@/lib/guestHistory';

// A guest's name, clickable, and the history it opens: every visit from the bookings file and every feedback form for that
// guest. A page puts <GuestHistoryProvider> around its content so a click opens the history in a pop-up; inside a KPI report
// pop-up, the report swaps itself for the history instead (see KpiReportDialog), through the same context.

type OpenGuest = (anchor: GuestAnchor, name: string) => void;

export const GuestOpenContext = createContext<OpenGuest | null>(null);

/** A guest's name. With somewhere to open the history (a provider) and a record to open it from, it is a button. */
export function GuestName({ name, anchor, className = '' }: { name: string; anchor: GuestAnchor | null; className?: string }) {
  const open = useContext(GuestOpenContext);
  if (!open || !anchor) return <span className={`font-extrabold text-ink ${className}`}>{name}</span>;
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        open(anchor, name);
      }}
      title={`See ${name}'s history`}
      className={`-my-2 inline-flex items-center py-2 text-left font-extrabold text-teal-800 underline decoration-teal-700/40 decoration-1 underline-offset-[3px] hover:text-teal-900 hover:decoration-teal-800 focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${className}`}
    >
      {name}
    </button>
  );
}

/** Lets every <GuestName> inside open the guest's history in a pop-up. */
export function GuestHistoryProvider({ children }: { children: React.ReactNode }) {
  const { words } = useKpiSettings();
  const [guest, setGuest] = useState<{ anchor: GuestAnchor; name: string } | null>(null);
  return (
    <GuestOpenContext.Provider value={(anchor, name) => setGuest({ anchor, name })}>
      {children}
      {guest && (
        <ReportDialog eyebrow={words.One} title={guest.name} onClose={() => setGuest(null)}>
          <GuestHistoryBody anchor={guest.anchor} />
        </ReportDialog>
      )}
    </GuestOpenContext.Provider>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The history itself: who the guest is, a few numbers, then every visit and feedback form, newest first. */
export function GuestHistoryBody({ anchor }: { anchor: GuestAnchor }) {
  const { system } = useCalendarSystem();
  const { words } = useKpiSettings();
  const { loading, history, error } = useGuestHistory(anchor);
  const day = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return `${new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short' })}, ${formatAdDate(d, system)}`;
  };

  if (loading) return <p className="m-0 py-8 text-center text-sm text-slate-600">Loading…</p>;
  if (error || !history) {
    return (
      <p role="alert" className="m-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-700">
        {error || 'Could not load the history.'}
      </p>
    );
  }
  const s = summariseGuest(history);
  const contact = [history.phone, history.email].filter(Boolean);
  return (
    <div data-guest-history>
      {contact.length > 0 && <p className="m-0 mb-3 text-[13.5px] font-semibold text-slate-700">{contact.join(' · ')}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Visits', value: String(s.visits) },
          { label: 'Feedback forms', value: String(s.forms) },
          { label: 'Average rating', value: s.average != null ? `${s.average.toFixed(1)} / 5` : '–' },
          { label: 'Last seen', value: s.lastDay ? formatAdDate(s.lastDay, system) : '–', small: true },
        ].map(t => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className={`${t.small ? 'text-[17px]' : 'text-[26px]'} font-extrabold leading-tight tabular-nums text-ink`}>{t.value}</div>
            <div className="mt-1.5 text-[12.5px] font-bold text-ink">{t.label}</div>
          </div>
        ))}
      </div>

      {s.entries.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600">{words.t('Nothing on file for this customer yet.')}</p>
      ) : (
        <>
          <h3 className="m-0 mb-1.5 mt-5 text-[13px] font-extrabold text-ink">History</h3>
          <ol aria-label={`${history.name ?? words.One}'s history`} className="m-0 list-none p-0">
            {s.entries.map(e => (
              <li key={`${e.kind}-${e.id}`} className="border-b border-slate-100 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-600">
                  <span className="font-bold text-slate-700">{day(e.day)}</span>
                  {e.kind === 'visit' ? (
                    <>
                      <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-[12px] font-bold text-teal-800">Visit</span>
                      <span className="font-semibold text-ink">{e.service ?? 'Service not named'}</span>
                      {e.minutes != null && <span>{plural(e.minutes, 'minute', 'minutes')}</span>}
                    </>
                  ) : (
                    <>
                      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-bold text-amber-800">Feedback form</span>
                      {e.rating != null ? (
                        <span role="img" aria-label={`Rating ${e.rating} of 5`} className="text-[15px] tracking-wider" style={{ color: KPI_COLORS.warn }}>
                          {'★'.repeat(e.rating)}
                          <span className="text-slate-300">{'★'.repeat(5 - e.rating)}</span>
                        </span>
                      ) : (
                        <span>No rating</span>
                      )}
                      {e.recommend != null && <span>Would recommend: {e.recommend} out of 10</span>}
                      {e.reference && <span>{e.reference}</span>}
                    </>
                  )}
                  {e.employee_name && <span>with {e.employee_name}</span>}
                </div>
                {e.kind === 'form' && e.comment && <p className="m-0 mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{e.comment}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
