'use client';

import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HeroPanel, ChevronLeftIcon, ChevronRightIcon, StatusTag, type TagTone } from '@/components/employee/parts';
import { dayFlags, type DayFlags } from '@/components/MonthCalendar';
import type { LogRow } from '@/components/AttendanceLogTable';
import type { CardEntry, CardKey } from '@/components/EmployeeCalendarView';
import { buildMonth, formatAdDate, formatDdMmYyyy, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatHoursMinutes, type DayStatus } from '@/lib/shift';
import type { LeaveRequest } from '@/lib/types';

/** The employee pages' Calendar layout (the green hero with a month stepper, a
 * month grid, the "This month" tiles, the day-by-day log and the hours trend).
 * It only draws — every figure comes from EmployeeCalendarView, which the
 * owner console's Attendance Calendar also uses with its own layout. */
export type PortalCalendarProps = {
  dayStatus: Map<string, DayStatus>;
  leaveDates: Set<string>;
  weekOffDates: Set<string>;
  selectedDate: string | null;
  onSelectDate: (adKey: string) => void;
  /** Same contract as MonthCalendar's: the AD keys of the month in view. */
  onMonthChange: (adKeys: string[]) => void;
  todayKey: string;
  summary: { totalWorkMinutes: number; overtimeMinutes: number; entries: Record<CardKey, CardEntry[]> };
  tableRows: LogRow[];
  chartData: { label: string; hours: number }[];
  selectedDaySummary: DayStatus | null;
  selectedLeave: LeaveRequest | null;
  dayLoading: boolean;
  expandedCard: CardKey | null;
  onExpandCard: (key: CardKey | null) => void;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TILES: Record<CardKey, { label: string; bg: string; text: string }> = {
  hours: { label: 'Total Work Hours', bg: 'bg-[#e2f3e8]', text: 'text-[#14532d]' },
  late: { label: 'Late In', bg: 'bg-[#ffedd5]', text: 'text-[#c2410c]' },
  early: { label: 'Early Out', bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]' },
  overtime: { label: 'Overtime', bg: 'bg-[#dbeafe]', text: 'text-[#1d4ed8]' },
  present: { label: 'Present Days', bg: 'bg-[#e3f4ec]', text: 'text-[#047857]' },
  absent: { label: 'Absent Days', bg: 'bg-slate-100', text: 'text-slate-600' },
};
const TILE_ORDER: CardKey[] = ['hours', 'late', 'early', 'overtime', 'present', 'absent'];

const fmtTime = (t: string) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtHrs = (hours: number) => formatHoursMinutes(Math.round(hours * 60));
/** 32 -> "32m", 80 -> "1h 20m" — short enough to sit beside a time. */
const shortDur = (minutes: number) => (minutes < 60 ? `${minutes}m` : formatHoursMinutes(minutes));

/** Weekday from an AD date key — the same in either calendar. */
function weekday(key: string, style: 'short' | 'long' = 'short') {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: style });
}

/** What a grid cell shows: its fill, the word under the number and the dot used on a phone. */
function cellLook(flags: DayFlags): { bg: string; word: string | null; wordColor: string; dot: string } {
  if (flags.leave) return { bg: 'bg-[#f3e8ff]', word: 'Leave', wordColor: 'text-[#7e22ce]', dot: 'bg-[#a855f7]' };
  if (flags.weekOff) return { bg: 'bg-slate-100', word: 'Week off', wordColor: 'text-slate-600', dot: 'bg-slate-400' };
  if (flags.absent) return { bg: 'bg-[#fee2e2]', word: 'Absent', wordColor: 'text-[#b91c1c]', dot: 'bg-[#ef4444]' };
  if (flags.checkedInOnly) return { bg: 'bg-[#dbeafe]', word: 'In only', wordColor: 'text-[#1d4ed8]', dot: 'bg-[#2563eb]' };
  if (flags.present || flags.late || flags.early) {
    const dot = flags.late ? 'bg-[#f97316]' : flags.early ? 'bg-[#ef4444]' : 'bg-[#15803d]';
    return { bg: 'bg-[#e2f3e8]', word: flags.late || flags.early ? null : 'Present', wordColor: 'text-[#14532d]', dot };
  }
  return { bg: 'bg-slate-50', word: null, wordColor: '', dot: '' };
}

type LogKind = 'present' | 'absent' | 'leave' | 'dayoff' | 'upcoming';
function kindOf(row: LogRow): LogKind {
  if (row.onLeave) return row.offKind === 'leave' ? 'leave' : 'dayoff';
  if (row.present) return 'present';
  if (row.absent) return 'absent';
  return 'upcoming';
}
const KIND_TAG: Record<Exclude<LogKind, 'upcoming'>, { label: string; tone: TagTone }> = {
  present: { label: 'Present', tone: 'good' },
  absent: { label: 'Absent', tone: 'critical' },
  leave: { label: 'On leave', tone: 'purple' },
  dayoff: { label: 'Day off', tone: 'neutral' },
};

type LogItem = { kind: 'day'; row: LogRow } | { kind: 'gap'; from: string; to: string; count: number };

export default function PortalCalendar(props: PortalCalendarProps) {
  const {
    dayStatus,
    leaveDates,
    weekOffDates,
    selectedDate,
    onSelectDate,
    onMonthChange,
    todayKey,
    summary,
    tableRows,
    chartData,
    selectedDaySummary,
    selectedLeave,
    dayLoading,
    expandedCard,
    onExpandCard,
  } = props;
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayAnchor);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const range = useMemo(() => monthDateRange(system, anchor), [system, anchor]);

  useEffect(() => {
    onMonthChange(month.weeks.flat().filter(c => c.inMonth).map(c => c.adKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  function tileValue(key: CardKey) {
    if (key === 'hours') return formatHoursMinutes(summary.totalWorkMinutes);
    if (key === 'overtime') return formatHoursMinutes(summary.overtimeMinutes);
    const count = summary.entries[key].length;
    return `${count} day${count === 1 ? '' : 's'}`;
  }

  const dayLabel = (date: string) => formatDdMmYyyy(date, system).slice(0, 5);

  // Runs of future days with nothing on them collapse to one line.
  const logItems = useMemo(() => {
    const out: LogItem[] = [];
    for (const row of tableRows) {
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
  }, [tableRows]);

  const totals = useMemo(() => {
    let hours = 0;
    let overtime = 0;
    let late = 0;
    let early = 0;
    let present = 0;
    let absent = 0;
    for (const row of tableRows) {
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
  }, [tableRows]);

  const gapText = (g: Extract<LogItem, { kind: 'gap' }>) =>
    g.count === 1 ? `Upcoming · ${dayLabel(g.from)}` : `${g.count} upcoming days · ${dayLabel(g.from)} – ${dayLabel(g.to)}`;

  function outText(row: LogRow) {
    if (row.checkOut) return fmtTime(row.checkOut);
    return row.date === todayKey ? 'Not yet' : 'Missing';
  }

  const th = 'h-10 bg-slate-100 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-600';
  const dash = <span className="text-slate-300">–</span>;

  return (
    <div className="lg:px-8 lg:pb-10 lg:pt-7">
      <HeroPanel pad="inner">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <div className="hidden min-w-0 lg:block">
            <h1 className="text-4xl font-extrabold leading-[44px] tracking-[-0.02em]">Calendar</h1>
            <p className="mt-0.5 text-[15px] font-semibold leading-[22px] text-white/90">
              {formatDdMmYyyy(range.start, system)} to {formatDdMmYyyy(range.end, system)}
            </p>
          </div>
          <div className="flex items-center rounded-[14px] bg-white/15 p-1">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous month"
              className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10"
            >
              <ChevronLeftIcon className="h-[18px] w-[18px]" />
            </button>
            <div aria-live="polite" className="min-w-0 flex-1 px-3 text-center text-lg font-extrabold lg:w-44 lg:flex-none">
              {month.label}
            </div>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next month"
              className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10"
            >
              <ChevronRightIcon className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </HeroPanel>

      <div className="relative mx-4 -mt-10 flex flex-col gap-4 lg:mx-5 lg:-mt-11 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
        {/* On a phone the two columns dissolve so the picked day can sit right under the grid. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
        {/* Month grid */}
        <section className="order-1 min-w-0 rounded-[20px] border border-slate-200 bg-white p-3 shadow-[0_10px_24px_rgba(6,78,59,0.10)] lg:order-none lg:p-6">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-600 lg:gap-2">
            {WEEKDAY_LABELS.map(w => (
              <div key={w} className="py-1.5">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 lg:gap-2">
            {month.weeks.flat().map((cell, i) => {
              const status = dayStatus.get(cell.adKey);
              const onLeave = leaveDates.has(cell.adKey);
              const onWeekOff = weekOffDates.has(cell.adKey);
              const selected = selectedDate === cell.adKey;
              const flags = cell.inMonth
                ? dayFlags(status, onLeave, onWeekOff, cell.adKey <= todayKey)
                : dayFlags(undefined, false, false, false);
              const look = cell.inMonth ? cellLook(flags) : { bg: '', word: null, wordColor: '', dot: '' };
              const pills = [
                flags.late && { text: 'Late', cls: 'bg-[#f97316]' },
                flags.early && { text: 'Early', cls: 'bg-[#ef4444]' },
                flags.overtime && { text: 'OT', cls: 'bg-[#2563eb]' },
              ].filter(Boolean) as { text: string; cls: string }[];
              return (
                <button
                  key={`${cell.adKey}-${i}`}
                  type="button"
                  onClick={() => onSelectDate(cell.adKey)}
                  aria-pressed={selected}
                  aria-label={`${formatAdDate(cell.adKey, system)}${look.word ? `, ${look.word}` : ''}${pills.length ? `, ${pills.map(p => p.text).join(' and ')}` : ''}`}
                  className={`flex min-h-[56px] flex-col items-start justify-between rounded-xl p-1.5 text-left lg:min-h-[88px] lg:rounded-2xl lg:p-2.5 ${look.bg} ${
                    cell.inMonth ? 'hover:brightness-[0.97]' : 'opacity-60'
                  } ${selected ? 'ring-2 ring-brand ring-offset-1' : ''}`}
                >
                  <span
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-extrabold lg:text-sm ${
                      cell.isToday ? 'bg-brand text-white' : cell.inMonth ? 'text-ink' : 'text-slate-300'
                    }`}
                  >
                    {cell.displayDay}
                  </span>
                  {cell.inMonth && (
                    <>
                      {/* Phone: just a dot, there is no room for words */}
                      {look.dot && <span className={`ml-1 h-1.5 w-1.5 rounded-full lg:hidden ${look.dot}`} />}
                      <span className="hidden flex-wrap items-center gap-1 lg:flex">
                        {look.word && <span className={`text-[11px] font-bold ${look.wordColor}`}>{look.word}</span>}
                        {pills.map(p => (
                          <span key={p.text} className={`rounded-full px-1.5 py-px text-[9px] font-extrabold uppercase leading-[14px] text-white ${p.cls}`}>
                            {p.text}
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-semibold text-slate-600">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#e2f3e8]" /> Present</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#dbeafe]" /> Checked in</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#f3e8ff]" /> On leave</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" /> Week off</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#fee2e2]" /> Absent</span>
            <span className="flex items-center gap-1.5"><span className="rounded-full bg-[#f97316] px-1.5 py-px text-[9px] font-extrabold uppercase leading-[14px] text-white">Late</span> Late in</span>
            <span className="flex items-center gap-1.5"><span className="rounded-full bg-[#ef4444] px-1.5 py-px text-[9px] font-extrabold uppercase leading-[14px] text-white">Early</span> Early out</span>
            <span className="flex items-center gap-1.5"><span className="rounded-full bg-[#2563eb] px-1.5 py-px text-[9px] font-extrabold uppercase leading-[14px] text-white">OT</span> Overtime</span>
          </div>
        </section>

        {/* Hours trend */}
        <section className="order-4 min-w-0 rounded-[20px] border border-slate-200 bg-white p-5 lg:order-none lg:p-6">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-xl font-extrabold leading-6">Hours trend</h2>
            <span className="text-[11px] font-semibold text-slate-500 lg:hidden">Scroll to see all days →</span>
          </div>
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No data to chart yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ width: Math.max(chartData.length * 18, 320), height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#586474' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval={0} />
                    <YAxis tick={{ fontSize: 10, fill: '#047857' }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                      formatter={(v: number) => [fmtHrs(v), 'Hours']}
                    />
                    <Line type="monotone" dataKey="hours" name="hours" stroke="#047857" strokeWidth={2.5} dot={{ r: 2.5, fill: '#047857' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </section>

        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
        {/* This month */}
        <section className="order-3 rounded-[20px] border border-slate-200 bg-white p-5 lg:order-none lg:p-6">
          <h2 className="mb-3 text-xl font-extrabold leading-6">This month</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {TILE_ORDER.map(key => {
              const tile = TILES[key];
              const open = expandedCard === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onExpandCard(open ? null : key)}
                  aria-pressed={open}
                  className={`rounded-2xl p-3.5 text-left ${tile.bg} ${open ? 'ring-2 ring-brand' : ''}`}
                >
                  <div className={`text-[11px] font-extrabold uppercase tracking-[0.5px] ${tile.text}`}>{tile.label}</div>
                  <div className="mt-1 text-[22px] font-extrabold leading-7">{tileValue(key)}</div>
                </button>
              );
            })}
          </div>

          {expandedCard && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h3 className="mb-1 text-sm font-extrabold">{TILES[expandedCard].label}</h3>
              {summary.entries[expandedCard].length === 0 ? (
                <p className="text-sm text-slate-500">Nothing to show for this month.</p>
              ) : (
                <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                  {summary.entries[expandedCard].map(entry => {
                    const day = dayStatus.get(entry.date);
                    return (
                      <div key={entry.date} className="py-2.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold">{formatAdDate(entry.date, system)}</span>
                          {!day && <StatusTag tone="critical">Absent</StatusTag>}
                          {day?.isLate && <StatusTag tone="warning">Late</StatusTag>}
                        </div>
                        {day && (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-semibold text-slate-600">
                            <span>In {fmtTime(day.checkIn.punch_time)}</span>
                            <span>Out {day.checkOut ? fmtTime(day.checkOut.punch_time) : '–:–'}</span>
                            {day.isLate && <span className="text-[#c2410c]">Late {formatHoursMinutes(day.lateMinutes)}</span>}
                            {day.isEarly && <span className="text-[#b91c1c]">Early {formatHoursMinutes(day.earlyMinutes)}</span>}
                            <span>{formatHoursMinutes(day.totalMinutes)}</span>
                            {day.overtimeMinutes > 0 && <span className="text-[#1d4ed8]">OT {formatHoursMinutes(day.overtimeMinutes)}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* The picked day (right under the grid on a phone) */}
        {selectedDate && (
          <section className="order-2 rounded-[20px] border border-slate-200 bg-white p-5 lg:order-none lg:p-6">
            <h2 className="text-lg font-extrabold leading-6">{formatAdDate(selectedDate, system)}</h2>
            <p className="mb-3 text-[13px] font-semibold text-slate-600">{weekday(selectedDate, 'long')}</p>
            {selectedLeave && (
              <div className="mb-3 rounded-2xl bg-[#f3e8ff] p-3.5">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-[#7e22ce]">On leave</div>
                <div className="text-base font-extrabold capitalize">{selectedLeave.leave_type}</div>
              </div>
            )}
            {dayLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : !selectedDaySummary ? (
              !selectedLeave && <p className="text-sm text-slate-500">No punches recorded.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl bg-[#e2f3e8] p-3.5">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-[#14532d]">In</div>
                  <div className="text-lg font-extrabold">{fmtTime(selectedDaySummary.checkIn.punch_time)}</div>
                  <div className="text-xs font-semibold capitalize text-slate-600">{selectedDaySummary.checkIn.method}</div>
                  {selectedDaySummary.isLate && (
                    <div className="mt-1 text-xs font-bold text-[#c2410c]">Late by {formatHoursMinutes(selectedDaySummary.lateMinutes)}</div>
                  )}
                </div>
                <div className="rounded-2xl bg-[#ffedd5] p-3.5">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-[#c2410c]">Out</div>
                  {selectedDaySummary.checkOut ? (
                    <>
                      <div className="text-lg font-extrabold">{fmtTime(selectedDaySummary.checkOut.punch_time)}</div>
                      <div className="text-xs font-semibold capitalize text-slate-600">{selectedDaySummary.checkOut.method}</div>
                      {selectedDaySummary.isEarly && (
                        <div className="mt-1 text-xs font-bold text-[#b91c1c]">Early by {formatHoursMinutes(selectedDaySummary.earlyMinutes)}</div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm font-semibold text-slate-600">Not yet</div>
                  )}
                </div>
                <div className="rounded-2xl bg-[#e3f4ec] p-3.5">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-[#047857]">Total hours</div>
                  <div className="text-lg font-extrabold">{formatHoursMinutes(selectedDaySummary.totalMinutes)}</div>
                </div>
                <div className="rounded-2xl bg-[#dbeafe] p-3.5">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-[#1d4ed8]">Overtime</div>
                  <div className="text-lg font-extrabold">{formatHoursMinutes(selectedDaySummary.overtimeMinutes)}</div>
                </div>
              </div>
            )}
          </section>
        )}
        </div>
      </div>

      <div className="mx-4 mt-4 lg:mx-5 lg:mt-6">
        {/* Daily log */}
        <section className="min-w-0 rounded-[20px] border border-slate-200 bg-white p-5 lg:p-6">
          <h2 className="mb-4 text-xl font-extrabold leading-6">Daily log</h2>
          {tableRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Nothing to show yet.</p>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] table-fixed text-left text-sm">
                  <thead>
                    <tr className={th}>
                      <th className="w-[22%] pl-4">Date</th>
                      <th className="w-[14%]">Status</th>
                      <th className="w-[20%]">Check-in</th>
                      <th className="w-[20%]">Check-out</th>
                      <th className="w-[12%] text-right">Worked</th>
                      <th className="w-[12%] pr-4 text-right">Overtime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logItems.map(item => {
                      if (item.kind === 'gap') {
                        return (
                          <tr key={`gap-${item.from}`} className="border-t border-slate-100 bg-slate-50">
                            <td colSpan={6} className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">
                              {gapText(item)}
                            </td>
                          </tr>
                        );
                      }
                      const { row } = item;
                      const kind = kindOf(row) as Exclude<LogKind, 'upcoming'>;
                      const isToday = row.date === todayKey;
                      return (
                        <tr key={row.date} className={`h-12 border-t border-slate-100 ${isToday ? 'bg-brand-light/60' : ''}`}>
                          <td className="whitespace-nowrap pl-4">
                            <span className="font-extrabold tabular-nums">{dayLabel(row.date)}</span>
                            <span className="ml-2 text-xs font-semibold text-slate-500">{weekday(row.date)}</span>
                            {isToday && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">Today</span>}
                          </td>
                          <td>
                            <StatusTag tone={KIND_TAG[kind].tone}>{KIND_TAG[kind].label}</StatusTag>
                          </td>
                          {kind === 'present' ? (
                            <>
                              <td>
                                <span className="font-semibold tabular-nums">{row.checkIn ? fmtTime(row.checkIn) : dash}</span>
                                {row.lateMinutes > 0 && (
                                  <span className="ml-2 text-xs font-bold text-[#c2410c]">{shortDur(row.lateMinutes)} late</span>
                                )}
                              </td>
                              <td>
                                <span className={`font-semibold tabular-nums ${row.checkOut ? '' : 'text-[#c2410c]'}`}>{outText(row)}</span>
                                {row.earlyMinutes > 0 && (
                                  <span className="ml-2 text-xs font-bold text-[#b91c1c]">{shortDur(row.earlyMinutes)} early</span>
                                )}
                              </td>
                              <td className="text-right font-extrabold tabular-nums">{row.hours > 0 ? fmtHrs(row.hours) : dash}</td>
                              <td className="pr-4 text-right font-semibold tabular-nums text-[#1d4ed8]">{row.overtime > 0 ? fmtHrs(row.overtime) : dash}</td>
                            </>
                          ) : (
                            <td colSpan={4} className="text-xs font-semibold text-slate-500">
                              {kind === 'absent' ? 'No punches recorded' : ''}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="h-12 border-t-2 border-slate-200 bg-slate-100 font-extrabold">
                      <td colSpan={2} className="pl-4">
                        Month total
                        <span className="ml-2 text-xs font-semibold text-slate-600">
                          {totals.present} present · {totals.absent} absent
                        </span>
                      </td>
                      <td>{totals.late > 0 ? <span className="text-[#c2410c]">{formatHoursMinutes(totals.late)} late</span> : dash}</td>
                      <td>{totals.early > 0 ? <span className="text-[#b91c1c]">{formatHoursMinutes(totals.early)} early</span> : dash}</td>
                      <td className="text-right tabular-nums">{fmtHrs(totals.hours)}</td>
                      <td className="pr-4 text-right tabular-nums text-[#1d4ed8]">{fmtHrs(totals.overtime)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Phones: one block per day */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {logItems.map(item => {
                  if (item.kind === 'gap') {
                    return (
                      <li key={`gap-${item.from}`} className="bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-500">
                        {gapText(item)}
                      </li>
                    );
                  }
                  const { row } = item;
                  const kind = kindOf(row) as Exclude<LogKind, 'upcoming'>;
                  const isToday = row.date === todayKey;
                  return (
                    <li key={row.date} className={`grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-1 py-3 ${isToday ? 'bg-brand-light/60' : ''}`}>
                      <div>
                        <div className="text-sm font-extrabold tabular-nums">{dayLabel(row.date)}</div>
                        <div className="text-xs font-semibold text-slate-500">{isToday ? 'Today' : weekday(row.date)}</div>
                      </div>
                      {kind === 'present' ? (
                        <>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold tabular-nums">
                              {row.checkIn ? fmtTime(row.checkIn) : '–'} – {outText(row)}
                            </div>
                            {(row.lateMinutes > 0 || row.earlyMinutes > 0) && (
                              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs font-bold">
                                {row.lateMinutes > 0 && <span className="text-[#c2410c]">{shortDur(row.lateMinutes)} late</span>}
                                {row.earlyMinutes > 0 && <span className="text-[#b91c1c]">{shortDur(row.earlyMinutes)} early</span>}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-extrabold tabular-nums">{row.hours > 0 ? fmtHrs(row.hours) : dash}</div>
                            {row.overtime > 0 && <div className="text-xs font-bold tabular-nums text-[#1d4ed8]">+{fmtHrs(row.overtime)} OT</div>}
                          </div>
                        </>
                      ) : (
                        <div className="col-span-2 flex items-center gap-2">
                          <StatusTag tone={KIND_TAG[kind].tone}>{KIND_TAG[kind].label}</StatusTag>
                          {kind === 'absent' && <span className="text-xs font-semibold text-slate-500">No punches recorded</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
                <li className="rounded-xl bg-slate-100 px-3 py-3 text-sm">
                  <div className="flex items-baseline justify-between font-extrabold">
                    <span>Month total</span>
                    <span className="tabular-nums">{fmtHrs(totals.hours)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs font-semibold text-slate-600">
                    <span>
                      {totals.present} present · {totals.absent} absent
                    </span>
                    {totals.late > 0 && <span className="text-[#c2410c]">{formatHoursMinutes(totals.late)} late</span>}
                    {totals.early > 0 && <span className="text-[#b91c1c]">{formatHoursMinutes(totals.early)} early</span>}
                    <span className="text-[#1d4ed8]">{fmtHrs(totals.overtime)} overtime</span>
                  </div>
                </li>
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
