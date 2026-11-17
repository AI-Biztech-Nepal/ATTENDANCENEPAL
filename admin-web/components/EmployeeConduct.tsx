'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from './Badge';
import { AreaField, DateField, RecordDialog, SelectField, TextField } from './RecordForm';
import { useConfirm } from './ConfirmDialog';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  CONDUCT_KINDS,
  CONDUCT_STATUSES,
  WARNING_LEVELS,
  statusLabel,
  warningLevelLabel,
  type ConductKind,
  type ConductRecord,
  type ConductStatus,
  type WarningLevel,
} from '@/lib/employeeRecords';

const EMPTY_FORM = { kind: 'warning', record_date: '', title: '', details: '', warning_level: '', status: 'open', final_decision: '', decided_on: '' };

const KIND_TONE: Record<ConductKind, 'warning' | 'critical' | 'info'> = { warning: 'warning', disciplinary: 'critical', grievance: 'info' };
const STATUS_TONE: Record<ConductStatus, 'warning' | 'info' | 'neutral'> = { open: 'warning', under_review: 'info', closed: 'neutral' };

/** Warnings, disciplinary actions and grievances on an employee's file, each with
 * what was decided in the end. Admin / HR only. */
export default function EmployeeConduct({ employeeId }: { employeeId: string }) {
  const confirm = useConfirm();
  const { system } = useCalendarSystem();
  const [records, setRecords] = useState<ConductRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [filter, setFilter] = useState<'all' | ConductKind>('all');

  const [dialog, setDialog] = useState<{ editing: ConductRecord | null } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('employee_conduct_records')
      .select('*')
      .eq('employee_id', employeeId)
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setRecords((data ?? []) as ConductRecord[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<'all' | ConductKind, number> = { all: records.length, warning: 0, disciplinary: 0, grievance: 0 };
    for (const r of records) c[r.kind]++;
    return c;
  }, [records]);
  const openCount = records.filter(r => r.status !== 'closed').length;
  const shown = filter === 'all' ? records : records.filter(r => r.kind === filter);

  function openDialog(editing: ConductRecord | null) {
    setFormError('');
    setForm(
      editing
        ? {
            kind: editing.kind,
            record_date: editing.record_date,
            title: editing.title,
            details: editing.details ?? '',
            warning_level: editing.warning_level ?? '',
            status: editing.status,
            final_decision: editing.final_decision ?? '',
            decided_on: editing.decided_on ?? '',
          }
        : // Adding while a kind is selected starts on that kind.
          { ...EMPTY_FORM, kind: filter === 'all' ? 'warning' : filter }
    );
    setDialog({ editing });
  }

  function change(patch: Partial<typeof EMPTY_FORM>) {
    setForm(f => {
      const next = { ...f, ...patch };
      // Closing a record dates the decision as of today unless a date was given.
      if (patch.status === 'closed' && !next.decided_on) next.decided_on = localDateKey(new Date().toISOString());
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog) return;
    if (!form.title.trim()) return setFormError('Give it a short title.');
    if (!form.record_date) return setFormError('Pick the date.');
    if (form.status === 'closed' && !form.final_decision.trim()) return setFormError('Say how it was decided before closing it.');
    setSaving(true);
    setFormError('');
    const row = {
      kind: form.kind,
      record_date: form.record_date,
      title: form.title.trim(),
      details: form.details.trim() || null,
      // A level only means something for a warning.
      warning_level: form.kind === 'warning' && form.warning_level ? form.warning_level : null,
      status: form.status,
      final_decision: form.final_decision.trim() || null,
      decided_on: form.final_decision.trim() ? form.decided_on || null : null,
    };
    const { error } = dialog.editing
      ? await supabase.from('employee_conduct_records').update(row).eq('id', dialog.editing.id)
      : await supabase.from('employee_conduct_records').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setDialog(null);
    load();
  }

  async function remove(r: ConductRecord) {
    if (!(await confirm(`Delete "${r.title}"? This can't be undone.`, { title: 'Delete record?', confirmLabel: 'Delete', tone: 'danger' }))) return;
    setActionError('');
    const { error } = await supabase.from('employee_conduct_records').delete().eq('id', r.id);
    if (error) return setActionError(`Could not delete: ${error.message}`);
    load();
  }

  const kindWord = (k: ConductKind) => CONDUCT_KINDS.find(x => x.value === k)!.label;

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="employee-conduct-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="employee-conduct-heading" className="text-sm font-semibold text-ink">
            Conduct records
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Warnings, disciplinary actions and grievances, with the final decision. Only admins and HR of your company can edit these; the employee sees their own, read only.
          </p>
        </div>
        {status === 'ready' && (
          <button type="button" onClick={() => openDialog(null)} className="shrink-0 text-xs font-medium text-accent hover:underline">
            + Add record
          </button>
        )}
      </div>

      {status === 'unavailable' && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-text" role="alert">
          This can&apos;t be loaded yet. If this is the first time, run the latest database migration
          (20261101200000_employee_performance_conduct.sql) in Supabase. <span className="opacity-70">({loadError})</span>
        </div>
      )}
      {actionError && (
        <p className="mt-3 text-xs text-critical" role="alert">
          {actionError}
        </p>
      )}

      {status === 'ready' && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter records">
            {(
              [
                ['all', 'All'],
                ['warning', 'Warnings'],
                ['disciplinary', 'Disciplinary'],
                ['grievance', 'Grievances'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  filter === value ? 'border-accent bg-accent/10 text-accent' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label} ({counts[value]})
              </button>
            ))}
            {openCount > 0 && <span className="ml-auto text-xs font-semibold text-warning-text">{openCount} still open</span>}
          </div>

          {shown.length === 0 && (
            <p className="mt-3 text-xs text-slate-400">
              {records.length === 0 ? 'Nothing on file.' : `No ${CONDUCT_KINDS.find(k => k.value === filter)?.plural.toLowerCase()} on file.`}
            </p>
          )}
          <ul className="mt-2 divide-y divide-slate-100">
            {shown.map(r => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{formatAdDate(r.record_date, system)}</span>
                  <Badge tone={KIND_TONE[r.kind]}>{r.kind === 'warning' ? warningLevelLabel(r.warning_level as WarningLevel | null) : kindWord(r.kind)}</Badge>
                  <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge>
                </div>
                <p className="mt-1 text-sm font-medium text-ink">{r.title}</p>
                {r.details && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{r.details}</p>}
                {r.final_decision && (
                  <p className="mt-1.5 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="text-xs font-semibold text-slate-500">
                      Final decision{r.decided_on ? ` · ${formatAdDate(r.decided_on, system)}` : ''}:{' '}
                    </span>
                    {r.final_decision}
                  </p>
                )}
                <div className="mt-1.5 flex gap-3 text-xs">
                  <button type="button" onClick={() => openDialog(r)} className="font-medium text-accent hover:underline">
                    Edit
                  </button>
                  <button type="button" onClick={() => remove(r)} className="font-medium text-critical hover:underline">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {dialog && (
        <RecordDialog
          title={dialog.editing ? 'Edit record' : 'Add a conduct record'}
          onClose={() => setDialog(null)}
          onSubmit={save}
          saving={saving}
          submitLabel={dialog.editing ? 'Save changes' : 'Add record'}
          error={formError}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Kind" value={form.kind} onChange={v => change({ kind: v })}>
              {CONDUCT_KINDS.map(k => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </SelectField>
            <DateField label="Date" value={form.record_date} onChange={v => change({ record_date: v })} />
          </div>
          <TextField label="Title" value={form.title} onChange={v => change({ title: v })} placeholder="A short summary, e.g. Late three times in a week" />
          {form.kind === 'warning' && (
            <SelectField label="Warning level" value={form.warning_level} onChange={v => change({ warning_level: v })}>
              <option value="">Not stated</option>
              {WARNING_LEVELS.map(l => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </SelectField>
          )}
          <AreaField label="Details" value={form.details} onChange={v => change({ details: v })} placeholder="What happened, who was involved" />
          <SelectField label="Status" value={form.status} onChange={v => change({ status: v })}>
            {CONDUCT_STATUSES.map(s => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectField>
          <AreaField label="Final decision" value={form.final_decision} onChange={v => change({ final_decision: v })} rows={2} placeholder="How it was decided (required to close it)" />
          {(form.final_decision.trim() || form.status === 'closed') && <DateField label="Decided on" value={form.decided_on} onChange={v => change({ decided_on: v })} />}
        </RecordDialog>
      )}
    </section>
  );
}
