'use client';

import { useEffect, useRef, useState } from 'react';

export type DepartmentOption = { value: string; label: string; count: number };

/** A department filter as a dropdown menu instead of a row of pills — pills
 * stop scaling once a company has more than 3-4 departments (they either
 * wrap onto a second line or get clipped), while a menu holds any number
 * the same way. Each row shows how many employees are in it, and the
 * trigger button always names the active one so the current filter is
 * visible without opening the menu. Closes on an outside click or Escape,
 * matching ComboBox's own dropdown affordance elsewhere in the app. */
export default function DepartmentDropdown({
  options,
  value,
  onChange,
}: {
  /** First entry is always "All" (value `'all'`). */
  options: DepartmentOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = options.find(o => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-semibold text-ink shadow-sm transition-colors ${
          open ? 'border-accent ring-2 ring-accent/20' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="whitespace-nowrap">{active.label}</span>
        <ChevronIcon className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Department"
          className="absolute right-0 top-full z-20 mt-1.5 max-h-72 w-56 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          {options.map(o => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  selected ? 'bg-good-bg font-semibold text-good-text' : 'font-medium text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-good-text">
                  {selected && <CheckIcon className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-grow truncate">{o.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{o.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
