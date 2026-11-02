'use client';

import { useEffect, useRef, useState } from 'react';

/** A "⋯" button that opens a small menu of actions for one row of a list. */
export default function RowMenu({
  label,
  items,
}: {
  /** Names the row for screen readers: "More actions for Bachelors". */
  label: string;
  items: { label: string; danger?: boolean; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative -mr-2 -mt-2 shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={`More actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full px-3.5 py-2.5 text-left text-[13px] font-bold hover:bg-slate-50 ${item.danger ? 'text-[#b91c1c]' : 'text-slate-700'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
