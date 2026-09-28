'use client';

import { useEffect, useRef, useState } from 'react';

export type ComboBoxOption = { label: string; sub?: string };

/** A text input that's also a dropdown — types freely (never locked to the
 * suggestion list, unlike a <select>) while offering a clean, consistently
 * -styled chevron button that opens a filtered suggestion panel, matching
 * the app's other icon+pill selects (see the Employee filter on the
 * Attendance Report/Payroll pages) instead of the browser's own
 * inconsistent-looking `<input list>` datalist arrow/panel. */
export default function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboBoxOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const query = value.trim().toLowerCase();
  const filtered = query ? options.filter(o => o.label.toLowerCase().includes(query)) : options;

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className={`w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          // Opening (not closing) with something already picked/typed —
          // clear it first so the full suggestion list shows again instead
          // of staying filtered down to whatever's still in the box, and
          // the field is ready to take a fresh entry right away.
          if (!open && value) onChange('');
          setOpen(o => !o);
        }}
        aria-label="Show suggestions"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-accent"
      >
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {filtered.map(o => (
            <li key={o.label}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onChange(o.label);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left hover:bg-accent/5"
              >
                <span className="text-ink">{o.label}</span>
                {o.sub && <span className="shrink-0 text-xs text-slate-400">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}
