'use client';

import { useEffect, useRef, useState } from 'react';
import type { PayrollReportColumns } from '@/lib/payrollReportColumns';

/** The cog-and-switches menu that hides optional columns, shared by the three
 * payroll surfaces so they look and behave identically: the Salary Structure
 * table (its own PF / SSF / Overtime columns), the monthly Payroll report and
 * the Staff Salary Sheet (their attendance columns).
 *
 * Presentational on purpose — the page owns the value and the save, because
 * the page's own table has to re-render the moment a switch flips. Every
 * surface reads and writes the one localStorage value (lib/payrollReportColumns),
 * so a switch set on one is the same switch on the others; only the subset of
 * keys offered differs, which is what `options` picks.
 *
 * Admin-only at every call site, matching the contribution rates. */
export default function PayrollColumnsMenu({
  cols,
  onToggle,
  options,
  title = 'Columns',
  description,
}: {
  cols: PayrollReportColumns;
  onToggle: (key: keyof PayrollReportColumns) => void;
  /** Which switches to show, in order, as [key, label]. */
  options: [keyof PayrollReportColumns, string][];
  title?: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative print:hidden" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Column settings"
        className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
      >
        <CogIcon className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent px-4 py-3">
            <CogIcon className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-ink">{title}</span>
          </div>
          {description && <p className="px-4 pb-1 pt-2 text-[11px] leading-snug text-slate-400">{description}</p>}
          <div className="p-1.5">
            {options.map(([key, label]) => {
              const on = cols[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggle(key)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-sm text-ink hover:bg-slate-50"
                >
                  {label}
                  <span
                    className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-good' : 'bg-slate-300'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        on ? 'translate-x-[18px]' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
