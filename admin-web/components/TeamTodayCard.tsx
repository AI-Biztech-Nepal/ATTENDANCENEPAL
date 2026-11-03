'use client';

import { formatAdDate, type CalendarSystem } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { useTeamToday, type NextHoliday } from '@/lib/teamToday';
import type { Employee } from '@/lib/types';

/** "22–26 Kartik", "28 Kartik – 2 Mangsir", "26 Kartik" — in whichever calendar is active. */
function holidayDates(h: NextHoliday, system: CalendarSystem) {
  const part = (key: string) => {
    const [day, month] = formatAdDate(key, system).split(' ');
    return { day, month };
  };
  const a = part(h.start);
  if (h.end === h.start) return `${a.day} ${a.month}`;
  const b = part(h.end);
  return a.month === b.month ? `${a.day}–${b.day} ${a.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

/**
 * Who is in, late, absent or on leave today, as one bar and four counts, with the next holiday under
 * it. The numbers follow the same rules as the dashboard's attendance bar (see lib/teamToday.ts).
 */
export default function TeamTodayCard({ employees }: { employees: Employee[] }) {
  const { system } = useCalendarSystem();
  const { summary, nextHoliday } = useTeamToday(employees);
  const today = nepalTodayIso();

  const parts = [
    { key: 'in', label: 'In', value: summary?.onTime, dot: 'bg-good', bar: 'bg-good' },
    { key: 'late', label: 'Late', value: summary?.late, dot: 'bg-warning', bar: 'bg-warning' },
    { key: 'absent', label: 'Absent', value: summary?.absent, dot: 'bg-critical', bar: 'bg-critical' },
    { key: 'leave', label: 'On leave', value: summary?.onLeave, dot: 'bg-info', bar: 'bg-info' },
  ];
  const people = summary?.people ?? 0;
  const counted = parts.reduce((n, p) => n + (p.value ?? 0), 0);
  const summaryText = summary ? parts.map(p => `${p.value} ${p.label.toLowerCase()}`).join(', ') : 'Loading';

  return (
    <section aria-label="Team today" className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-extrabold text-ink">Team today</h2>
        <span className="text-sm font-semibold text-slate-500">{summary ? `${people} ${people === 1 ? 'person' : 'people'}` : '…'}</span>
      </div>

      <div role="img" aria-label={summaryText} className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {summary &&
          people > 0 &&
          parts
            .filter(p => (p.value ?? 0) > 0)
            .map(p => <span key={p.key} className={p.bar} style={{ flex: p.value }} />)}
        {/* Segments are sized by weight, like the dashboard's bar, so the gaps between them don't squeeze a small one away. People who are off today (a week-off or a holiday) are in none of the four, so the bar leaves their share open. */}
        {summary && people > 0 && counted < people && <span className="bg-slate-200" style={{ flex: people - counted }} />}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        {parts.map(p => (
          <div key={p.key} className="flex items-center justify-between gap-1.5 rounded-2xl bg-slate-50 px-3 py-3">
            <dt className="flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold text-slate-600">
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${p.dot}`} />
              {p.label}
            </dt>
            <dd className="m-0 text-lg font-extrabold tabular-nums text-ink">{p.value ?? '–'}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-start gap-2.5 border-t border-slate-100 pt-4 text-sm">
        <FlagIcon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-purple-600" />
        <p className="min-w-0 leading-5">
          {nextHoliday ? (
            <>
              <span className="font-semibold text-slate-500">{nextHoliday.start <= today ? 'Holiday today' : 'Next holiday'} · </span>
              <span className="font-extrabold text-ink">
                {nextHoliday.name}, {holidayDates(nextHoliday, system)}
              </span>
            </>
          ) : (
            <span className="font-semibold text-slate-500">{summary ? 'No holiday coming up' : 'Loading…'}</span>
          )}
        </p>
      </div>
    </section>
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}
