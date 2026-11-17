'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildMonth, formatAdDate, formatDdMmYyyy, parseTypedDate, stepAnchor, todayAnchor, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPOVER_WIDTH = 288; // matches w-72
const POPOVER_HEIGHT = 340; // header + weekday row + up to 6 grid rows + footer

function parseAdKey(value: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/** Puts the slashes in while plain digits are typed ("25072056" -> "25/07/2056"). Anything with
 * other separators ("2056-07-25") is left exactly as typed. */
function shapeTyped(raw: string): string {
  if (!/^[\d/]*$/.test(raw)) return raw;
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d.length <= 2 ? d : d.length <= 4 ? `${d.slice(0, 2)}/${d.slice(2)}` : `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * A date box you can either type into (DD/MM/YYYY, in whichever calendar is active) or fill by
 * clicking the calendar icon — the same date-grid model (lib/calendar.ts) the Attendance calendar
 * already uses, reused here so every date field in the app can toggle to the Nepali (Bikram
 * Sambat) calendar instead of just the Gregorian one. Typing is the fast way to a date far from
 * today (a date of birth is dozens of months of clicking away).
 *
 * The AD/BS system itself isn't chosen here — it comes from the one global
 * switch in the page header (CalendarSystemSwitch), so every date picker
 * and every displayed date on the page changes together.
 *
 * The popover renders through a portal into document.body, positioned by
 * the trigger's viewport coordinates — a plain absolutely-positioned child
 * would get clipped by any ancestor with overflow-y-auto (every modal on
 * desktop uses that for its scrollable body), which is how a native
 * <input type="date"> never behaved since its picker is a browser-level
 * overlay, not a DOM node inside the page.
 */
export default function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  className,
  ariaLabel = 'Date',
}: {
  /** AD date as YYYY-MM-DD (what's actually stored/sent), or '' for unset. */
  value: string;
  onChange: (adKey: string) => void;
  placeholder?: string;
  className?: string;
  /** What a screen reader calls the box ("Date of birth"). */
  ariaLabel?: string;
}) {
  const { system } = useCalendarSystem();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(todayAnchor);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  // While the box has focus it shows what is being typed; otherwise the friendly "25 Kartik 2056".
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [badDate, setBadDate] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justFocused = useRef(false);
  const ownSlashes = useRef(false); // true once the person types a "/" themselves
  const popoverRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    setAnchor(parseAdKey(value) ?? todayAnchor());
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8);
      // Flip above the trigger when there isn't room below (e.g. a field
      // near the bottom of a modal) instead of letting the popover run off
      // the bottom of the viewport.
      const top =
        rect.bottom + 4 + POPOVER_HEIGHT > window.innerHeight
          ? Math.max(8, rect.top - POPOVER_HEIGHT - 4)
          : rect.bottom + 4;
      setCoords({ top, left: Math.max(8, left) });
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

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  function selectCell(adKey: string) {
    onChange(adKey);
    setOpen(false);
  }

  function startTyping() {
    setText(value ? formatDdMmYyyy(value, system) : '');
    setBadDate(false);
    ownSlashes.current = false;
    setEditing(true);
  }
  // Select what is there so the first key typed replaces it.
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function handleType(typed: string) {
    let raw = typed.slice(0, 10);
    // What was just put in, and where: the first place the old and new text differ.
    let at = 0;
    while (at < text.length && at < typed.length && text[at] === typed[at]) at++;
    const inserted = typed.length > text.length ? typed.slice(at, at + typed.length - text.length) : '';
    if (typed.length === text.length + 1 && raw.replace(/\D/g, '').length > 8) {
      // A digit typed after a complete date starts a new date instead of being lost at the end of it.
      raw = inserted;
      ownSlashes.current = false;
    } else if (inserted.includes('/')) {
      ownSlashes.current = true; // they are typing the separators themselves (5/7/2056): leave them be
    } else if (!typed) {
      ownSlashes.current = false;
    }
    const next = ownSlashes.current ? raw : shapeTyped(raw);
    setText(next);
    const adKey = parseTypedDate(next, system);
    // Only call it wrong once it is a full-length date; "25/07" is just unfinished.
    setBadDate(!adKey && next.replace(/\D/g, '').length >= 8);
    if (!adKey) return;
    if (adKey !== value) onChange(adKey);
    setAnchor(parseAdKey(adKey) ?? anchor); // an open calendar follows what is typed
  }

  function stopTyping() {
    // A date that was typed in full is already saved as it became valid; anything half-typed or
    // wrong is dropped, and clearing the box clears the date.
    if (!text.trim() && value) onChange('');
    setEditing(false);
    setBadDate(false);
  }

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const displayValue = value ? formatAdDate(value, system) : '';

  return (
    <>
      <div
        ref={triggerRef}
        className={`flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm shadow-sm ${
          badDate ? 'border-critical-text' : 'border-slate-200 hover:border-accent/40 focus-within:border-accent'
        } ${className ?? ''}`}
      >
        {/* The input comes first in the page so a <label> around the field would focus it; the icon is shown first. */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={badDate || undefined}
          value={editing ? text : displayValue}
          placeholder={editing ? 'DD/MM/YYYY' : placeholder}
          onFocus={() => {
            justFocused.current = true;
            startTyping();
          }}
          // The click that focuses the box would otherwise drop the select-all on mouse-up.
          onMouseUp={e => {
            if (justFocused.current) e.preventDefault();
            justFocused.current = false;
          }}
          onBlur={() => {
            justFocused.current = false;
            stopTyping();
          }}
          onChange={e => handleType(e.target.value)}
          onKeyDown={e => {
            // Enter keeps the date and moves on; it should not submit the whole form behind it.
            if (e.key === 'Enter') {
              e.preventDefault();
              inputRef.current?.blur();
            }
          }}
          className="order-2 min-w-0 flex-1 truncate bg-transparent text-ink outline-none placeholder:text-slate-400"
        />
        <button
          type="button"
          aria-label={open ? 'Close calendar' : 'Open calendar'}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="order-1 shrink-0 rounded text-accent hover:text-accent/80"
        >
          <CalendarGlyph className="h-4 w-4" />
        </button>
        {editing && <span className="order-3 shrink-0 text-[10px] font-semibold text-slate-400">{system}</span>}
      </div>
      {badDate && (
        <p role="alert" className="mt-1 text-[11px] font-medium text-critical-text">
          Not a real {system} date — type it as day/month/year.
        </p>
      )}
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH }}
            className="z-[1000] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => go(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
                ‹
              </button>
              <span className="text-sm font-semibold text-ink">{month.label}</span>
              <button type="button" onClick={() => go(1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
              {WEEKDAY_LABELS.map(w => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {month.weeks.flat().map((cell, i) => {
                const isSelected = cell.adKey === value;
                return (
                  <button
                    key={`${cell.adKey}-${i}`}
                    type="button"
                    onClick={() => selectCell(cell.adKey)}
                    className={`h-7 w-7 rounded-full text-xs ${
                      !cell.inMonth
                        ? 'text-slate-300'
                        : isSelected
                          ? 'bg-accent font-semibold text-white'
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

            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
              <span className="text-[11px] text-slate-400">Today: {formatAdDate(todayIso, system)}</span>
              <button type="button" onClick={() => selectCell(todayIso)} className="text-[11px] font-medium text-accent hover:underline">
                Select today
              </button>
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
