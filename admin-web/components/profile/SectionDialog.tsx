'use client';

import { useEffect, useRef } from 'react';

/** A pop-up for editing one section of a record: title, the fields, and Cancel / Save at the bottom.
 * Same look as the app's other pop-ups. Closing it (×, Cancel, Escape, a click outside) goes through
 * `onClose`, so the page can ask first when there are unsaved changes. */
export default function SectionDialog({
  title,
  hint,
  tone = 'default',
  changed,
  changedLabels,
  saving,
  error,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  hint?: string;
  tone?: 'default' | 'danger';
  changed: number;
  changedLabels: string[];
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLFormElement>(null);
  // Kept in a ref so the keyboard listener is set up once, not on every render of the page.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input:not([readonly]), select, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const summary = changedLabels.slice(0, 3).join(', ') + (changedLabels.length > 3 ? ` and ${changedLabels.length - 3} more` : '');
  return (
    <div className="fixed inset-0 z-[45] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${title}`}
        onSubmit={onSubmit}
        className={`my-auto flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl ${tone === 'danger' ? 'ring-1 ring-rose-200' : ''}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-ink">Edit {title}</h2>
            {hint && <p className="mt-1 text-[13px] font-semibold text-slate-500">{hint}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl leading-none text-slate-500 hover:bg-slate-100">
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-4">
          <div className="min-w-[200px] flex-1">
            {error ? (
              <p role="alert" className="text-[13px] font-bold text-critical-text">
                {error}
              </p>
            ) : (
              <p role="status" className={`flex flex-wrap items-center gap-2 text-[13px] font-bold ${changed > 0 ? 'text-warning-text' : 'text-slate-500'}`}>
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${changed > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} />
                {changed > 0 ? (
                  <>
                    {changed} unsaved change{changed === 1 ? '' : 's'}
                    <span className="font-semibold text-slate-500">· {summary}</span>
                  </>
                ) : (
                  'No changes yet'
                )}
              </p>
            )}
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-[42px] rounded-xl px-4 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || changed === 0}
              className="h-[42px] rounded-xl bg-accent px-5 text-sm font-extrabold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
