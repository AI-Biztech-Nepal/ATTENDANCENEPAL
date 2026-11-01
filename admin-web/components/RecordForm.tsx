'use client';

import { useEffect } from 'react';
import DatePicker from './DatePicker';

const INPUT_CLASS = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';

/** The add / edit dialog the profile page's record lists share: a titled form in
 * a scrollable panel, closed by Escape, the backdrop or Cancel (never while saving). */
export function RecordDialog({
  title,
  subtitle,
  onClose,
  onSubmit,
  saving,
  submitLabel,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  submitLabel: string;
  error?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4" onClick={() => !saving && onClose()}>
      <form
        onSubmit={onSubmit}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-lg"
      >
        <div className="space-y-3 overflow-y-auto p-6">
          <div>
            <h3 className="text-lg font-semibold text-ink">{title}</h3>
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
          {children}
          {error && (
            <p className="text-sm text-critical" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = 'text',
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  min?: string;
  max?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
        step={step}
        className={INPUT_CLASS}
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function AreaField({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={INPUT_CLASS} />
    </label>
  );
}

export function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className={INPUT_CLASS}>
        {children}
      </select>
    </label>
  );
}

export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <DatePicker value={value} onChange={onChange} />
    </div>
  );
}
