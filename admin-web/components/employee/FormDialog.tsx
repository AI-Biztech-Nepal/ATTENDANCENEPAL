'use client';

import { useEffect, useRef } from 'react';

/** The small add / request pop-ups on the employee pages (redeem points, education, work experience). */
export default function FormDialog({
  title,
  note,
  onSubmit,
  onClose,
  saving,
  savingLabel,
  submitLabel,
  error,
  children,
}: {
  title: string;
  note?: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  saving: boolean;
  savingLabel: string;
  submitLabel: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  // Kept in a ref so the key listener is attached once, not on every render of the page.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <form onSubmit={onSubmit} role="dialog" aria-modal="true" aria-label={title} className="my-auto w-full max-w-sm rounded-[20px] bg-white p-6 shadow-xl">
        <h3 className="text-xl font-extrabold">{title}</h3>
        {note && <p className="mb-4 mt-1 text-[13px] font-medium text-slate-600">{note}</p>}
        <div className={note ? '' : 'mt-4'}>{children}</div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-[#b91c1c]">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-sm font-bold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="h-11 rounded-xl bg-brand px-5 text-sm font-extrabold text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? savingLabel : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
