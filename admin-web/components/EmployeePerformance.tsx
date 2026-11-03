'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from './Badge';
import { AreaField, DateField, RecordDialog, SelectField, TextField } from './RecordForm';
import { useConfirm } from './ConfirmDialog';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  PERIOD_TYPES,
  averageRating,
  periodLabel,
  ratingLabel,
  starString,
  type Appraisal,
  type Award,
  type PeriodType,
} from '@/lib/employeeRecords';

const EMPTY_APPRAISAL = { date: '', period_type: 'annual', period_start: '', period_end: '', rating: '', evaluated_by: '', remarks: '', skills_assessment: '' };
const EMPTY_AWARD = { title: '', awarded_on: '', description: '' };

type Dialog = { kind: 'appraisal'; editing: Appraisal | null } | { kind: 'award'; editing: Award | null } | null;

/** An employee's appraisals (rating, remarks, who evaluated, skills assessment)
 * and the awards and recognition they have received. Admin / HR only. */
export default function EmployeePerformance({ employeeId, managerName }: { employeeId: string; managerName: string | null }) {
  const confirm = useConfirm();
  const { system } = useCalendarSystem();
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const [dialog, setDialog] = useState<Dialog>(null);
  const [appraisalForm, setAppraisalForm] = useState(EMPTY_APPRAISAL);
  const [awardForm, setAwardForm] = useState(EMPTY_AWARD);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    const [a, w] = await Promise.all([
      supabase.from('employee_appraisals').select('*').eq('employee_id', employeeId).order('appraisal_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('employee_awards').select('*').eq('employee_id', employeeId).order('awarded_on', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    const error = a.error ?? w.error;
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setAppraisals((a.data ?? []) as Appraisal[]);
    setAwards((w.data ?? []) as Award[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAppraisal(editing: Appraisal | null) {
    setFormError('');
    setAppraisalForm(
      editing
        ? {
            date: editing.appraisal_date,
            period_type: editing.period_type,
            period_start: editing.period_start ?? '',
            period_end: editing.period_end ?? '',
            rating: String(editing.rating),
            evaluated_by: editing.evaluated_by ?? '',
            remarks: editing.remarks ?? '',
            skills_assessment: editing.skills_assessment ?? '',
          }
        : { ...EMPTY_APPRAISAL, evaluated_by: managerName ?? '' }
    );
    setDialog({ kind: 'appraisal', editing });
  }

  function openAward(editing: Award | null) {
    setFormError('');
    setAwardForm(editing ? { title: editing.title, awarded_on: editing.awarded_on, description: editing.description ?? '' } : EMPTY_AWARD);
    setDialog({ kind: 'award', editing });
  }

  async function saveAppraisal(e: React.FormEvent) {
    e.preventDefault();
    if (dialog?.kind !== 'appraisal') return;
    const f = appraisalForm;
    const rating = Number(f.rating);
    if (!f.date) return setFormError('Pick the appraisal date.');
    if (f.rating.trim() === '' || Number.isNaN(rating) || rating < 1 || rating > 5 || rating * 2 !== Math.floor(rating * 2)) {
      return setFormError('The rating must be from 1 to 5, in half steps (e.g. 3.5).');
    }
    if (f.period_start && f.period_end && f.period_end < f.period_start) return setFormError('The period ends before it starts.');
    setSaving(true);
    setFormError('');
    const row = {
      appraisal_date: f.date,
      period_type: f.period_type,
      period_start: f.period_start || null,
      period_end: f.period_end || null,
      rating,
      evaluated_by: f.evaluated_by.trim() || null,
      remarks: f.remarks.trim() || null,
      skills_assessment: f.skills_assessment.trim() || null,
    };
    const { error } = dialog.editing
      ? await supabase.from('employee_appraisals').update(row).eq('id', dialog.editing.id)
      : await supabase.from('employee_appraisals').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setDialog(null);
    load();
  }

  async function saveAward(e: React.FormEvent) {
    e.preventDefault();
    if (dialog?.kind !== 'award') return;
    const f = awardForm;
    if (!f.title.trim()) return setFormError('Give the award a title.');
    if (!f.awarded_on) return setFormError('Pick the date it was awarded.');
    setSaving(true);
    setFormError('');
    const row = { title: f.title.trim(), awarded_on: f.awarded_on, description: f.description.trim() || null };
    const { error } = dialog.editing
      ? await supabase.from('employee_awards').update(row).eq('id', dialog.editing.id)
      : await supabase.from('employee_awards').insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (error) return setFormError(`Could not save: ${error.message}`);
    setDialog(null);
    load();
  }

  async function remove(table: 'employee_appraisals' | 'employee_awards', id: string, what: string) {
    if (!(await confirm(`Delete this ${what}? This can't be undone.`, { title: `Delete ${what}?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    setActionError('');
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return setActionError(`Could not delete: ${error.message}`);
    load();
  }

  const average = averageRating(appraisals);
  const latest = appraisals[0];

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="employee-performance-heading">
      <div>
        <h2 id="employee-performance-heading" className="text-sm font-semibold text-ink">
          Performance &amp; recognition
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">Appraisals and awards. Only admins and HR of your company can edit these; the employee sees their own, read only. Training is listed above.</p>
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
          {/* ---- appraisals ---- */}
          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Appraisals</h3>
            <button type="button" onClick={() => openAppraisal(null)} className="text-xs font-medium text-accent hover:underline">
              + Add appraisal
            </button>
          </div>
          {average !== null && latest && (
            <p className="mt-1 text-xs text-slate-500" aria-live="polite">
              Average <span className="font-semibold text-ink">{average} / 5</span> over {appraisals.length} appraisal{appraisals.length === 1 ? '' : 's'} · latest{' '}
              <span className="font-semibold text-ink">{latest.rating}</span> on {formatAdDate(latest.appraisal_date, system)}
            </p>
          )}
          {appraisals.length === 0 && <p className="mt-2 text-xs text-slate-400">No appraisals recorded yet.</p>}
          <ul className="mt-2 divide-y divide-slate-100">
            {appraisals.map(a => (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{formatAdDate(a.appraisal_date, system)}</span>
                  <Badge tone="neutral">{periodLabel(a.period_type)}</Badge>
                  <span className="text-sm text-ink" title={`${a.rating} out of 5`}>
                    <span aria-hidden="true" className="tracking-wider text-warning">
                      {starString(Number(a.rating))}
                    </span>{' '}
                    <span className="font-semibold">{a.rating} / 5</span>
                    <span className="text-slate-500"> · {ratingLabel(Number(a.rating))}</span>
                  </span>
                </div>
                {(a.period_start || a.period_end) && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Period: {a.period_start ? formatAdDate(a.period_start, system) : '—'} – {a.period_end ? formatAdDate(a.period_end, system) : '—'}
                  </p>
                )}
                {a.evaluated_by && <p className="mt-1 text-xs text-slate-500">Evaluated by {a.evaluated_by}</p>}
                {a.remarks && (
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    <span className="text-xs font-semibold text-slate-500">Remarks: </span>
                    {a.remarks}
                  </p>
                )}
                {a.skills_assessment && (
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    <span className="text-xs font-semibold text-slate-500">Skills assessment: </span>
                    {a.skills_assessment}
                  </p>
                )}
                <div className="mt-1.5 flex gap-3 text-xs">
                  <button type="button" onClick={() => openAppraisal(a)} className="font-medium text-accent hover:underline">
                    Edit
                  </button>
                  <button type="button" onClick={() => remove('employee_appraisals', a.id, 'appraisal')} className="font-medium text-critical hover:underline">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* ---- awards ---- */}
          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Awards &amp; recognition</h3>
            <button type="button" onClick={() => openAward(null)} className="text-xs font-medium text-accent hover:underline">
              + Add award
            </button>
          </div>
          {awards.length === 0 && <p className="mt-2 text-xs text-slate-400">No awards recorded yet.</p>}
          <ul className="mt-2 divide-y divide-slate-100">
            {awards.map(w => (
              <li key={w.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-ink">{w.title}</span>
                  <span className="text-xs text-slate-500">{formatAdDate(w.awarded_on, system)}</span>
                </div>
                {w.description && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{w.description}</p>}
                <div className="mt-1.5 flex gap-3 text-xs">
                  <button type="button" onClick={() => openAward(w)} className="font-medium text-accent hover:underline">
                    Edit
                  </button>
                  <button type="button" onClick={() => remove('employee_awards', w.id, 'award')} className="font-medium text-critical hover:underline">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {dialog?.kind === 'appraisal' && (
        <RecordDialog
          title={dialog.editing ? 'Edit appraisal' : 'Add appraisal'}
          onClose={() => setDialog(null)}
          onSubmit={saveAppraisal}
          saving={saving}
          submitLabel={dialog.editing ? 'Save changes' : 'Add appraisal'}
          error={formError}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField label="Appraisal date" value={appraisalForm.date} onChange={v => setAppraisalForm(f => ({ ...f, date: v }))} />
            <SelectField label="Period" value={appraisalForm.period_type} onChange={v => setAppraisalForm(f => ({ ...f, period_type: v as PeriodType }))}>
              {PERIOD_TYPES.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </SelectField>
            <DateField label="Period from (optional)" value={appraisalForm.period_start} onChange={v => setAppraisalForm(f => ({ ...f, period_start: v }))} />
            <DateField label="Period to (optional)" value={appraisalForm.period_end} onChange={v => setAppraisalForm(f => ({ ...f, period_end: v }))} />
            <TextField
              label="Rating (1–5)"
              type="number"
              min="1"
              max="5"
              step="0.5"
              value={appraisalForm.rating}
              onChange={v => setAppraisalForm(f => ({ ...f, rating: v }))}
              hint={appraisalForm.rating && !Number.isNaN(Number(appraisalForm.rating)) && Number(appraisalForm.rating) >= 1 && Number(appraisalForm.rating) <= 5 ? ratingLabel(Number(appraisalForm.rating)) : '1 poor · 3 meets expectations · 5 outstanding'}
            />
            <TextField label="Evaluated by" value={appraisalForm.evaluated_by} onChange={v => setAppraisalForm(f => ({ ...f, evaluated_by: v }))} placeholder="Reporting manager" />
          </div>
          <AreaField label="Remarks" value={appraisalForm.remarks} onChange={v => setAppraisalForm(f => ({ ...f, remarks: v }))} placeholder="Strengths, areas to improve, goals" />
          <AreaField label="Skills assessment" value={appraisalForm.skills_assessment} onChange={v => setAppraisalForm(f => ({ ...f, skills_assessment: v }))} placeholder="Job-related skills and how they were assessed" />
        </RecordDialog>
      )}

      {dialog?.kind === 'award' && (
        <RecordDialog
          title={dialog.editing ? 'Edit award' : 'Add award'}
          onClose={() => setDialog(null)}
          onSubmit={saveAward}
          saving={saving}
          submitLabel={dialog.editing ? 'Save changes' : 'Add award'}
          error={formError}
        >
          <TextField label="Award / recognition" value={awardForm.title} onChange={v => setAwardForm(f => ({ ...f, title: v }))} placeholder="e.g. Employee of the month" />
          <DateField label="Awarded on" value={awardForm.awarded_on} onChange={v => setAwardForm(f => ({ ...f, awarded_on: v }))} />
          <AreaField label="Achievement" value={awardForm.description} onChange={v => setAwardForm(f => ({ ...f, description: v }))} placeholder="What it was for" />
        </RecordDialog>
      )}
    </section>
  );
}
