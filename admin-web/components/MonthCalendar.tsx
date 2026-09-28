'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildMonth, localDateKey, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { DayStatus } from '@/lib/shift';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Props = {
  /** AD date (YYYY-MM-DD) -> that day's attendance state. */
  dayStatus: Map<string, DayStatus>;
  /** AD dates (YYYY-MM-DD) covered by an approved leave request. */
  leaveDates?: Set<string>;
  /** AD dates (YYYY-MM-DD) with an explicit Week Off roster entry. */
  weekOffDates?: Set<string>;
  selectedDate: string | null;
  onSelectDate: (adKey: string) => void;
  /** Fires with the AD date keys currently in view (on mount and whenever
   * the visible month changes) — lets a parent aggregate stats for exactly
   * the month this grid is showing, without owning the anchor itself. */
  onMonthChange?: (adKeys: string[]) => void;
};

type DayFlags = {
  late: boolean;
  early: boolean;
  leave: boolean;
  weekOff: boolean;
  present: boolean;
  checkedInOnly: boolean;
  absent: boolean;
  overtime: boolean;
};

/** Late and Early can both apply to the same day (late in AND left early),
 * so they're tracked independently rather than as a single "the" flag — one
 * renders above the day number, the other below. Overtime is also tracked
 * independently since it can co-occur with either — it shares the bottom
 * slot with Early as a two-pill row rather than one silently replacing the
 * other when both apply. Everything else (leave, week off, present,
 * still-clocked-in, absent) is mutually exclusive and gets a single dot —
 * Week Off shares Leave's purple (both mean "nothing expected today"),
 * distinguished only by caption text. A day with no punches, not on
 * leave/week off, that's already happened counts as absent — previously
 * such a day rendered identically to a future day with no way to tell them
 * apart. */
function dayFlags(status: DayStatus | undefined, onLeave: boolean, onWeekOff: boolean, isPastOrToday: boolean): DayFlags {
  if (onLeave || onWeekOff) {
    return {
      late: false,
      early: false,
      leave: onLeave,
      weekOff: onWeekOff,
      present: false,
      checkedInOnly: false,
      absent: false,
      overtime: false,
    };
  }
  if (!status)
    return {
      late: false,
      early: false,
      leave: false,
      weekOff: false,
      present: false,
      checkedInOnly: false,
      absent: isPastOrToday,
      overtime: false,
    };
  return {
    late: status.isLate,
    early: status.isEarly,
    leave: false,
    weekOff: false,
    present: status.hasOut && !status.isLate && !status.isEarly,
    checkedInOnly: status.hasIn && !status.hasOut,
    absent: false,
    overtime: status.overtimeMinutes > 0,
  };
}

function captionFor(flags: DayFlags): string | undefined {
  const parts: string[] = [];
  if (flags.leave) parts.push('On leave');
  if (flags.weekOff) parts.push('Week Off');
  if (flags.late) parts.push('Late in');
  if (flags.early) parts.push('Early out');
  if (flags.present) parts.push('Present');
  if (flags.checkedInOnly) parts.push('Checked in');
  if (flags.absent) parts.push('Absent');
  if (flags.overtime) parts.push('Overtime');
  return parts.length > 0 ? parts.join(' & ') : undefined;
}

export default function MonthCalendar({ dayStatus, leaveDates, weekOffDates, selectedDate, onSelectDate, onMonthChange }: Props) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayAnchor);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const inMonthCells = useMemo(() => month.weeks.flat().filter(c => c.inMonth), [month]);
  const todayKey = useMemo(() => localDateKey(new Date().toISOString()), []);

  useEffect(() => {
    onMonthChange?.(inMonthCells.map(c => c.adKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-center gap-3">
        <button onClick={() => go(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          ←
        </button>
        <span className="min-w-[10ch] text-center text-base font-semibold text-ink">{month.label}</span>
        <button onClick={() => go(1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase text-slate-400">
        {WEEKDAY_LABELS.map(w => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {month.weeks.flat().map((cell, i) => {
          const status = dayStatus.get(cell.adKey);
          const onLeave = leaveDates?.has(cell.adKey) ?? false;
          const onWeekOff = weekOffDates?.has(cell.adKey) ?? false;
          const selected = selectedDate === cell.adKey;
          const flags = cell.inMonth
            ? dayFlags(status, onLeave, onWeekOff, cell.adKey <= todayKey)
            : dayFlags(undefined, false, false, false);
          const caption = cell.inMonth ? captionFor(flags) : undefined;
          // On Leave/Week Off gets its own yellow, distinct from Checked-in's
          // pink — those two used to both read as similar light pastels.
          const attendanceBg = onLeave || onWeekOff
            ? 'bg-yellow-50'
            : flags.present || flags.late || flags.early
              ? 'bg-good-bg'
              : flags.checkedInOnly
                ? 'bg-pink-50'
                : flags.absent
                  ? 'bg-critical-bg'
                  : '';
          return (
            <button
              key={`${cell.adKey}-${i}`}
              onClick={() => onSelectDate(cell.adKey)}
              title={caption}
              className={`relative flex min-h-[52px] flex-col items-center justify-center rounded-lg text-sm sm:min-h-[60px] ${
                !cell.inMonth ? 'text-slate-300' : cell.isToday ? 'font-bold text-accent' : 'text-ink'
              } ${selected ? 'bg-accent text-white' : `${attendanceBg} hover:bg-slate-100`}`}
            >
              {flags.late && (
                <span
                  className={`absolute top-1 rounded-full px-1.5 py-px text-[8px] font-bold uppercase leading-none shadow-sm ${
                    selected ? 'bg-white text-accent' : 'bg-warning text-white'
                  }`}
                >
                  Late
                </span>
              )}
              <span>{cell.displayDay}</span>
              {(flags.overtime || flags.early) && (
                <span className="absolute bottom-1 flex items-center gap-0.5">
                  {flags.overtime && (
                    <span
                      className={`rounded-full px-1.5 py-px text-[8px] font-bold uppercase leading-none shadow-sm ${
                        selected ? 'bg-white text-accent' : 'bg-info text-white'
                      }`}
                    >
                      OT
                    </span>
                  )}
                  {flags.early && (
                    <span
                      className={`rounded-full px-1.5 py-px text-[8px] font-bold uppercase leading-none shadow-sm ${
                        selected ? 'bg-white text-accent' : 'bg-critical text-white'
                      }`}
                    >
                      Early
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-good-bg" /> Present
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-pink-50" /> Checked in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-yellow-50" /> On leave / Week Off
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-critical-bg" /> Absent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-warning px-1.5 py-px text-[8px] font-bold uppercase leading-none text-white">Late</span> Late in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-critical px-1.5 py-px text-[8px] font-bold uppercase leading-none text-white">Early</span> Early out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-info px-1.5 py-px text-[8px] font-bold uppercase leading-none text-white">OT</span> Overtime
        </span>
      </div>
    </div>
  );
}
