'use client';

import { useEffect, useRef } from 'react';

/** The small add / request pop-ups on the employee pages — the same dialog the owner console's
 * pages use (redeem points, education, upload, new task, a leave request). */
export default function FormDialog({
  title,
  note,
  onSubmit,
  onClose,
  saving,
  savingLabel,
  submitLabel,
  submitDisabled,
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
  /** Keeps Save off until the form can be sent (a file chosen, say). */
  submitDisabled?: boolean;
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center">
      <form onSubmit={onSubmit} role="dialog" aria-modal="true" aria-label={title} className="my-auto w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        {note && <p className="mb-4 mt-0.5 text-sm text-slate-500">{note}</p>}
        <div className={note ? '' : 'mt-4'}>{children}</div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-critical">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || submitDisabled}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {saving ? savingLabel : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
