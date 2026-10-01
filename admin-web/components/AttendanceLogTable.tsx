'use client';

import { useMemo } from 'react';
import { formatDdMmYyyy } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatHoursMinutes } from '@/lib/shift';

/** One day of the month, as the Attendance Calendar's day-by-day log needs it. */
export type LogRow = {
  /** AD date key, YYYY-MM-DD. */
  date: string;
  /** Leave, roster Week Off, or a company-wide day off. */
  onLeave: boolean;
  /** Which of those it is — only set when `onLeave`. */
  offKind: 'leave' | 'dayoff' | null;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  overtime: number;
  lateMinutes: number;
  earlyMinutes: number;
  present: boolean;
  absent: boolean;
};

type Kind = 'present' | 'absent' | 'leave' | 'dayoff' | 'upcoming';

const PILL: Record<Exclude<Kind, 'upcoming'>, { label: string; cls: string }> = {
  present: { label: 'Present', cls: 'bg-good-bg text-good-text' },
  absent: { label: 'Absent', cls: 'bg-critical-bg text-critical-text' },
  leave: { label: 'On leave', cls: 'bg-purple-100 text-purple-700' },
  dayoff: { label: 'Day off', cls: 'bg-slate-100 text-slate-600' },
};

function kindOf(row: LogRow): Kind {
  if (row.onLeave) return row.offKind === 'leave' ? 'leave' : 'dayoff';
  if (row.present) return 'present';
  if (row.absent) return 'absent';
  return 'upcoming';
}

const fmtTime = (t: string) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtHrs = (hours: number) => formatHoursMinutes(Math.round(hours * 60));

/** Weekday from the AD date key — the same whichever calendar the labels use. */
function weekday(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' });
}

type Item = { kind: 'day'; row: LogRow } | { kind: 'gap'; from: string; to: string; count: number };

/**
 * The day-by-day table under the Attendance Calendar's "This Month" cards.
 *
 * A table from 768px up, a stacked list below. Late and early sit beside the
 * time they belong to instead of in columns that are empty on most days, and a
 * run of future days with nothing on them collapses to one line instead of a
 * page of dashes.
 */
export default function AttendanceLogTable({ rows, todayKey }: { rows: LogRow[]; todayKey: string }) {
  const { system } = useCalendarSystem();
  const dayLabel = (date: string) => formatDdMmYyyy(date, system).slice(0, 5);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const row of rows) {
      if (kindOf(row) !== 'upcoming') {
        out.push({ kind: 'day', row });
        continue;
      }
      const last = out[out.length - 1];
      if (last?.kind === 'gap') {
        last.to = row.date;
        last.count += 1;
      } else {
        out.push({ kind: 'gap', from: row.date, to: row.date, count: 1 });
      }
    }
    return out;
  }, [rows]);

  const totals = useMemo(() => {
    let hours = 0;
    let overtime = 0;
    let late = 0;
    let early = 0;
    let present = 0;
    let absent = 0;
    for (const row of rows) {
      if (row.present) {
        hours += row.hours;
        overtime += row.overtime;
        late += row.lateMinutes;
        early += row.earlyMinutes;
        present += 1;
      } else if (row.absent) {
        absent += 1;
      }
    }
    return { hours, overtime, late, early, present, absent };
  }, [rows]);

  const dash = <span className="text-slate-300">–</span>;
  const gapText = (g: Extract<Item, { kind: 'gap' }>) =>
    g.count === 1 ? `Upcoming · ${dayLabel(g.from)}` : `${g.count} upcoming days · ${dayLabel(g.from)} – ${dayLabel(g.to)}`;

  function outCell(row: LogRow) {
    if (row.checkOut) {
      return (
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="tabular-nums text-ink">{fmtTime(row.checkOut)}</span>
          {row.earlyMinutes > 0 && <span className="text-xs font-medium text-critical-text">{formatHoursMinutes(row.earlyMinutes)} early</span>}
        </div>
      );
    }
    if (row.date === todayKey) return <span className="text-slate-500">Not yet</span>;
    return (
      <span className="text-xs font-medium text-warning-text" title="No check-out punch was recorded for this day">
        Missing
      </span>
    );
  }

  const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600';

  return (
    <>
      <h2 className="mb-2 mt-6 text-sm font-semibold text-ink">Daily Log</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="divide-x divide-slate-200 border-b border-slate-300 bg-slate-100">
              <th scope="col" className={`${th} w-48`}>Date</th>
              <th scope="col" className={`${th} w-36`}>Status</th>
              <th scope="col" className={th}>Check-in</th>
              <th scope="col" className={th}>Check-out</th>
              <th scope="col" className={`${th} text-right`}>Worked</th>
              <th scope="col" className={`${th} pr-6 text-right`}>Overtime</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {items.map(item => {
              if (item.kind === 'gap') {
                return (
                  <tr key={`gap-${item.from}`} className="bg-slate-50/60">
                    <td colSpan={6} className="px-4 py-2 text-center text-xs text-slate-500">
                      {gapText(item)}
                    </td>
                  </tr>
                );
              }
              const { row } = item;
              const kind = kindOf(row) as Exclude<Kind, 'upcoming'>;
              const isToday = row.date === todayKey;
              return (
                <tr key={row.date} className={`divide-x divide-slate-200 hover:bg-slate-50 ${isToday ? 'bg-accent/5' : ''}`}>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="font-semibold tabular-nums text-ink">{dayLabel(row.date)}</span>
                    <span className="ml-2 text-xs text-slate-500">{weekday(row.date)}</span>
                    {isToday && (
                      <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Today</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${PILL[kind].cls}`}>{PILL[kind].label}</span>
                  </td>
                  {kind === 'present' ? (
                    <>
                      <td className="px-4 py-2.5">
                        <div className="flex items-baseline gap-2 whitespace-nowrap">
                          <span className="tabular-nums text-ink">{row.checkIn ? fmtTime(row.checkIn) : dash}</span>
                          {row.lateMinutes > 0 && (
                            <span className="text-xs font-medium text-warning-text">{formatHoursMinutes(row.lateMinutes)} late</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">{outCell(row)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-ink">{row.hours > 0 ? fmtHrs(row.hours) : dash}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 pr-6 text-right tabular-nums text-info-text">
                        {row.overtime > 0 ? fmtHrs(row.overtime) : dash}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{kind === 'absent' ? 'No punches recorded' : ''}</td>
                      <td className="px-4 py-2.5" />
                      <td className="px-4 py-2.5" />
                      <td className="px-4 py-2.5" />
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="divide-x divide-slate-200 border-t-2 border-slate-300 bg-slate-100 font-semibold text-ink">
              <td colSpan={2} className="px-4 py-3">
                Month total
                <span className="ml-2 text-xs font-medium text-slate-500">
                  {totals.present} present · {totals.absent} absent
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {totals.late > 0 ? <span className="text-warning-text">{formatHoursMinutes(totals.late)} late</span> : dash}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {totals.early > 0 ? <span className="text-critical-text">{formatHoursMinutes(totals.early)} early</span> : dash}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtHrs(totals.hours)}</td>
              <td className="whitespace-nowrap px-4 py-3 pr-6 text-right tabular-nums text-info-text">{fmtHrs(totals.overtime)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Phones: one block per day — a seven-column table would need
            sideways scrolling to read anything. */}
        <ul className="divide-y divide-slate-100 md:hidden">
          {items.map(item => {
            if (item.kind === 'gap') {
              return (
                <li key={`gap-${item.from}`} className="bg-slate-50/60 px-4 py-2 text-center text-xs text-slate-500">
                  {gapText(item)}
                </li>
              );
            }
            const { row } = item;
            const kind = kindOf(row) as Exclude<Kind, 'upcoming'>;
            const isToday = row.date === todayKey;
            return (
              <li key={row.date} className={`grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 ${isToday ? 'bg-accent/5' : ''}`}>
                <div>
                  <div className="text-sm font-semibold tabular-nums text-ink">{dayLabel(row.date)}</div>
                  <div className="text-xs text-slate-500">{isToday ? 'Today' : weekday(row.date)}</div>
                </div>
                {kind === 'present' ? (
                  <>
                    <div className="min-w-0">
                      <div className="text-sm tabular-nums text-ink">
                        {row.checkIn ? fmtTime(row.checkIn) : '–'} – {row.checkOut ? fmtTime(row.checkOut) : isToday ? 'Not yet' : 'Missing'}
                      </div>
                      {(row.lateMinutes > 0 || row.earlyMinutes > 0) && (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs font-medium">
                          {row.lateMinutes > 0 && <span className="text-warning-text">{formatHoursMinutes(row.lateMinutes)} late</span>}
                          {row.earlyMinutes > 0 && <span className="text-critical-text">{formatHoursMinutes(row.earlyMinutes)} early</span>}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums text-ink">{row.hours > 0 ? fmtHrs(row.hours) : dash}</div>
                      {row.overtime > 0 && <div className="text-xs tabular-nums text-info-text">+{fmtHrs(row.overtime)} OT</div>}
                    </div>
                  </>
                ) : (
                  <div className="col-span-2 flex items-center gap-2">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${PILL[kind].cls}`}>{PILL[kind].label}</span>
                    {kind === 'absent' && <span className="text-xs text-slate-500">No punches recorded</span>}
                  </div>
                )}
              </li>
            );
          })}
          <li className="space-y-1 bg-slate-50 px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between font-semibold text-ink">
              <span>Month total</span>
              <span className="tabular-nums">{fmtHrs(totals.hours)}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs font-medium text-slate-500">
              <span>
                {totals.present} present · {totals.absent} absent
              </span>
              {totals.late > 0 && <span className="text-warning-text">{formatHoursMinutes(totals.late)} late</span>}
              {totals.early > 0 && <span className="text-critical-text">{formatHoursMinutes(totals.early)} early</span>}
              <span className="text-info-text">{fmtHrs(totals.overtime)} overtime</span>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
}
