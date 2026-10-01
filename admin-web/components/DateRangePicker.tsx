'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildMonth, formatAdDate, monthDateRange, stepAnchor, todayAnchor, type CalendarAnchor, type CalendarSystem } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPOVER_WIDTH = 300; // matches w-[300px]

function parseAdKey(value: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildPresets(system: CalendarSystem): { label: string; from: string; to: string }[] {
  const today = todayAnchor();
  const thisMonth = monthDateRange(system, today);
  const lastMonth = monthDateRange(system, stepAnchor(system, today, -1));
  const todayIso = isoDaysAgo(0);
  return [
    { label: 'Today', from: todayIso, to: todayIso },
    { label: 'Last 7 days', from: isoDaysAgo(6), to: todayIso },
    { label: 'Last 30 days', from: isoDaysAgo(29), to: todayIso },
    { label: 'This month', from: thisMonth.start, to: thisMonth.end },
    { label: 'Last month', from: lastMonth.start, to: lastMonth.end },
  ];
}

/**
 * One calendar for picking a From/To range, instead of two separate
 * DatePicker fields side by side — click a start day, then an end day (or
 * the same day twice for a 1-day range); picking a new start after a range
 * is already set begins a fresh range instead of adjusting one end. Mirrors
 * DatePicker's portal-positioned popover so it isn't clipped by a modal's
 * overflow-y-auto body.
 */
export default function DateRangePicker({
  from,
  to,
  onChange,
}: {
  /** AD dates as YYYY-MM-DD (what's actually stored/sent). */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const { system } = useCalendarSystem();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(todayAnchor);
  const [pickingStart, setPickingStart] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    setAnchor(parseAdKey(from) ?? todayAnchor());
    setPickingStart(null);
    setHoverDate(null);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8);
      setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const presets = useMemo(() => buildPresets(system), [system]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  function goYear(direction: 1 | -1) {
    setAnchor(a => {
      let next = a;
      for (let i = 0; i < 12; i++) next = stepAnchor(system, next, direction);
      return next;
    });
  }

  function applyPreset(from: string, to: string) {
    onChange(from, to);
    setPickingStart(null);
    setHoverDate(null);
    setOpen(false);
  }

  function selectCell(adKey: string) {
    if (!pickingStart) {
      // First click of a fresh range — hold it and wait for the end date,
      // previewing the span live as the pointer moves (see hoverDate below).
      setPickingStart(adKey);
      onChange(adKey, adKey);
      return;
    }
    const start = pickingStart < adKey ? pickingStart : adKey;
    const end = pickingStart < adKey ? adKey : pickingStart;
    onChange(start, end);
    setPickingStart(null);
    setHoverDate(null);
    setOpen(false);
  }

  // While the end date is being picked, preview the full span between the
  // clicked start and wherever the pointer currently is — otherwise the
  // calendar only ever shows two disconnected dots and never looks like a
  // "select a range" control until after the second click.
  const previewAnchor = pickingStart ? (hoverDate ?? pickingStart) : null;
  const liveStart = pickingStart ? (pickingStart < previewAnchor! ? pickingStart : previewAnchor!) : from;
  const liveEnd = pickingStart ? (pickingStart < previewAnchor! ? previewAnchor! : pickingStart) : to;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 text-left text-[13px] shadow-sm hover:border-accent/40"
      >
        <CalendarGlyph className="h-[15px] w-[15px] shrink-0 text-accent" />
        <span className="truncate whitespace-nowrap text-ink">
          {formatAdDate(from, system)} – {formatAdDate(to, system)}
        </span>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH }}
            className="z-[1000] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          >
            <div className="mb-3 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
              {presets.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.from, p.to)}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => goYear(-1)}
                  title="Previous year"
                  className="rounded-md border border-slate-200 px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  title="Previous month"
                  className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50"
                >
                  ‹
                </button>
              </div>
              <span className="text-sm font-semibold text-ink">{month.label}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => go(1)}
                  title="Next month"
                  className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => goYear(1)}
                  title="Next year"
                  className="rounded-md border border-slate-200 px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
                >
                  »
                </button>
              </div>
            </div>

            <p className="mb-1.5 text-center text-[11px] text-slate-400">
              {pickingStart ? 'Pick the end date' : 'Pick the start date'}
            </p>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
              {WEEKDAY_LABELS.map(w => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1" onMouseLeave={() => setHoverDate(null)}>
              {month.weeks.flat().map((cell, i) => {
                const isStart = cell.adKey === liveStart;
                const isEnd = cell.adKey === liveEnd;
                const inRange = cell.adKey > liveStart && cell.adKey < liveEnd;
                return (
                  <button
                    key={`${cell.adKey}-${i}`}
                    type="button"
                    onClick={() => selectCell(cell.adKey)}
                    onMouseEnter={() => pickingStart && setHoverDate(cell.adKey)}
                    className={`h-8 w-8 rounded-full text-xs ${
                      !cell.inMonth
                        ? 'text-slate-300'
                        : isStart || isEnd
                          ? 'bg-accent font-semibold text-white'
                          : inRange
                            ? 'bg-accent/15 text-ink'
                            : cell.isToday
                              ? 'bg-accent/10 font-semibold text-accent'
                              : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {cell.displayDay}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
