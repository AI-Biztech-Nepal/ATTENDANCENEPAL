'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from './Badge';
import DatePicker from './DatePicker';
import { useConfirm } from './ConfirmDialog';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  HISTORY_FIELDS,
  buildManualChanges,
  entryTags,
  formatMoney,
  percentChange,
  type EmployeeHistoryEntry,
  type HistoryChange,
  type HistoryField,
} from '@/lib/employeeHistory';

type Pair = { from: string; to: string };
type Pairs = Partial<Record<HistoryField, Pair>>;
type Kind = 'transfer' | 'promotion' | 'increment';

// What each kind of past record asks for.
const KINDS: { value: Kind; label: string; fields: HistoryField[] }[] = [
  { value: 'transfer', label: 'Transfer', fields: ['branch'] },
  { value: 'promotion', label: 'Promotion', fields: ['designation', 'department', 'reports_to'] },
  { value: 'increment', label: 'Salary increment', fields: ['salary', 'allowance'] },
];

const INPUT_CLASS = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';

/** The log of an employee's transfers, promotions and pay changes. Entries are
 * written by the database whenever branch, designation, department,
 * reporting-to, basic salary or allowance is edited; this card shows them and
 * lets HR fill in the reason, correct the effective date, or add a record of
 * something that happened before the system was used. What was recorded as
 * changed can't be edited — only the note and the date. */
export default function EmployeeHistory({
  employeeId,
  joinedOn,
  reloadKey = 0,
}: {
  employeeId: string;
  joinedOn: string | null;
  /** Change it to make the card re-read the log (the page does after saving an edit). */
  reloadKey?: number;
}) {
  const confirm = useConfirm();
  const { system } = useCalendarSystem();
  const [entries, setEntries] = useState<EmployeeHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ date: '', reason: '', remark: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>('transfer');
  const [pairs, setPairs] = useState<Pairs>({});
  const [addForm, setAddForm] = useState({ date: '', reason: '', remark: '' });
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('employee_history')
      .select('*')
      .eq('employee_id', employeeId)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setEntries((data ?? []) as EmployeeHistoryEntry[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  function startEdit(entry: EmployeeHistoryEntry) {
    setEditingId(entry.id);
    setEditForm({ date: entry.effective_date, reason: entry.reason ?? '', remark: entry.remark ?? '' });
    setActionError('');
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editForm.date) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from('employee_history')
      .update({
        effective_date: editForm.date,
        reason: editForm.reason.trim() || null,
        remark: editForm.remark.trim() || null,
      })
      .eq('id', editingId);
    setSavingEdit(false);
    if (error) {
      setActionError(`Could not save: ${error.message}`);
      return;
    }
    setEditingId(null);
    load();
  }

  async function handleDelete(entry: EmployeeHistoryEntry) {
    if (
      !(await confirm('Delete this history entry? Use this for an entry made by a typo fix, not to hide a real change.', {
        title: 'Delete entry?',
        confirmLabel: 'Delete',
        tone: 'danger',
      }))
    )
      return;
    setActionError('');
    const { error } = await supabase.from('employee_history').delete().eq('id', entry.id);
    if (error) {
      setActionError(`Could not delete: ${error.message}`);
      return;
    }
    load();
  }

  function openAdd() {
    setAdding(true);
    setKind('transfer');
    setPairs({});
    setAddForm({ date: '', reason: '', remark: '' });
    setAddError('');
  }

  function setPair(field: HistoryField, side: 'from' | 'to', value: string) {
    setPairs(p => ({ ...p, [field]: { from: '', to: '', ...p[field], [side]: value } }));
  }

  async function saveAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    const fields = KINDS.find(k => k.value === kind)!.fields;
    const used: Pairs = {};
    for (const f of fields) used[f] = pairs[f];
    const changes = buildManualChanges(used);
    if (!addForm.date) {
      setAddError('Pick the date it took effect.');
      return;
    }
    if (!Object.values(changes).some(c => c.to !== null && c.to !== '')) {
      setAddError('Fill in what it changed to.');
      return;
    }
    const badNumber = HISTORY_FIELDS.some(f => {
      const c = changes[f.key];
      return f.money && c && [c.from, c.to].some(v => v !== null && (typeof v !== 'number' || Number.isNaN(v) || v < 0));
    });
    if (badNumber) {
      setAddError('Salary and allowance must be numbers, zero or more.');
      return;
    }
    setSavingAdd(true);
    const { error } = await supabase.from('employee_history').insert({
      employee_id: employeeId,
      changes,
      effective_date: addForm.date,
      reason: addForm.reason.trim() || null,
      remark: addForm.remark.trim() || null,
      source: 'manual',
    });
    setSavingAdd(false);
    if (error) {
      setAddError(`Could not save: ${error.message}`);
      return;
    }
    setAdding(false);
    load();
  }

  const activeFields = KINDS.find(k => k.value === kind)!.fields;

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="employee-history-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="employee-history-heading" className="text-sm font-semibold text-ink">
            Transfers, promotions &amp; increments
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Recorded automatically when the branch, designation, department, reporting-to or pay is edited. Add the reason and
            the date it took effect here.
          </p>
        </div>
        {status === 'ready' && (
          <button type="button" onClick={openAdd} className="shrink-0 text-xs font-medium text-accent hover:underline">
            + Add past record
          </button>
        )}
      </div>

      {status === 'unavailable' && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-text" role="alert">
          History can&apos;t be loaded yet. If this is the first time, run the latest database migration
          (20261101160000_employee_history.sql) in Supabase. <span className="opacity-70">({loadError})</span>
        </div>
      )}
      {actionError && (
        <p className="mt-3 text-xs text-critical" role="alert">
          {actionError}
        </p>
      )}

      {status === 'ready' && (
        <ol className="mt-4">
          {entries.length === 0 && (
            <li className="pb-3 text-xs text-slate-400">
              Nothing recorded yet. When this person is transferred, promoted or given a pay change, it appears here by itself.
            </li>
          )}
          {entries.map(entry => {
            const tags = entryTags(entry.changes);
            const editing = editingId === entry.id;
            return (
              <li key={entry.id} className="relative border-l-2 border-slate-200 pb-5 pl-4">
                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{formatAdDate(entry.effective_date, system)}</span>
                  {tags.map(t => (
                    <Badge key={t.label} tone={t.tone}>
                      {t.label}
                    </Badge>
                  ))}
                </div>

                <ul className="mt-1.5 space-y-0.5 text-sm">
                  {HISTORY_FIELDS.map(field => {
                    const change = entry.changes[field.key];
                    if (!change) return null;
                    return <ChangeLine key={field.key} label={field.label} money={field.money} change={change} />;
                  })}
                </ul>

                {!editing && (entry.reason || entry.remark) && (
                  <div className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                    {entry.reason && (
                      <p>
                        <span className="font-semibold text-slate-500">Reason:</span> {entry.reason}
                      </p>
                    )}
                    {entry.remark && (
                      <p>
                        <span className="font-semibold text-slate-500">Remark:</span> {entry.remark}
                      </p>
                    )}
                  </div>
                )}

                {editing ? (
                  <form onSubmit={saveEdit} className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
                    <div>
                      <span className="mb-1 block text-xs font-medium text-slate-600">Effective date</span>
                      <DatePicker value={editForm.date} onChange={v => setEditForm(f => ({ ...f, date: v }))} />
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Reason</span>
                      <input
                        value={editForm.reason}
                        onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="e.g. Annual review, opening of new outlet"
                        className={INPUT_CLASS}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Remark</span>
                      <textarea
                        value={editForm.remark}
                        onChange={e => setEditForm(f => ({ ...f, remark: e.target.value }))}
                        rows={2}
                        className={INPUT_CLASS}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={savingEdit || !editForm.date}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <span className="text-slate-400">
                      {entry.source === 'manual' ? 'Added by hand' : 'Recorded automatically'} ·{' '}
                      {formatAdDate(localDateKey(entry.created_at), system)}
                    </span>
                    <button type="button" onClick={() => startEdit(entry)} className="font-medium text-accent hover:underline">
                      Edit reason &amp; date
                    </button>
                    <button type="button" onClick={() => handleDelete(entry)} className="font-medium text-critical hover:underline">
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}

          {joinedOn && (
            <li className="relative border-l-2 border-transparent pl-4">
              <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
              <span className="text-sm font-semibold text-ink">{formatAdDate(joinedOn, system)}</span>
              <span className="ml-2 text-xs text-slate-500">Joined</span>
            </li>
          )}
        </ol>
      )}

      {adding && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4" onClick={() => !savingAdd && setAdding(false)}>
          <form
            onSubmit={saveAdd}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-label="Add a past record"
            className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-lg"
          >
            <div className="overflow-y-auto p-6">
              <h3 className="text-lg font-semibold text-ink">Add a past record</h3>
              <p className="mb-4 text-sm text-slate-500">
                For something that happened before this system was used. It doesn&apos;t change the employee&apos;s current details.
              </p>

              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-medium text-slate-600">What happened</span>
                <select
                  value={kind}
                  onChange={e => {
                    setKind(e.target.value as Kind);
                    setAddError('');
                  }}
                  className={INPUT_CLASS}
                >
                  {KINDS.map(k => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mb-3">
                <span className="mb-1 block text-xs font-medium text-slate-600">Effective date</span>
                <DatePicker value={addForm.date} onChange={v => setAddForm(f => ({ ...f, date: v }))} />
              </div>

              <div className="space-y-3">
                {activeFields.map(key => {
                  const field = HISTORY_FIELDS.find(f => f.key === key)!;
                  const pair = pairs[key] ?? { from: '', to: '' };
                  // The new manager is all that's worth recording; "who did they report to before" is rarely known.
                  const toOnly = key === 'reports_to';
                  return (
                    <div key={key}>
                      <span className="mb-1 block text-xs font-semibold text-slate-600">{field.label}</span>
                      <div className={`grid gap-2 ${toOnly ? '' : 'grid-cols-2'}`}>
                        {!toOnly && (
                          <input
                            aria-label={`${field.label} — from`}
                            type={field.money ? 'number' : 'text'}
                            min={field.money ? '0' : undefined}
                            step={field.money ? '0.01' : undefined}
                            value={pair.from}
                            onChange={e => setPair(key, 'from', e.target.value)}
                            placeholder="From"
                            className={INPUT_CLASS}
                          />
                        )}
                        <input
                          aria-label={`${field.label} — ${toOnly ? 'name' : 'to'}`}
                          type={field.money ? 'number' : 'text'}
                          min={field.money ? '0' : undefined}
                          step={field.money ? '0.01' : undefined}
                          value={pair.to}
                          onChange={e => setPair(key, 'to', e.target.value)}
                          placeholder={toOnly ? 'Name' : 'To'}
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <label className="mb-3 mt-4 block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Reason</span>
                <input
                  value={addForm.reason}
                  onChange={e => setAddForm(f => ({ ...f, reason: e.target.value }))}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Remark</span>
                <textarea
                  value={addForm.remark}
                  onChange={e => setAddForm(f => ({ ...f, remark: e.target.value }))}
                  rows={2}
                  className={INPUT_CLASS}
                />
              </label>

              {addError && (
                <p className="mt-3 text-sm text-critical" role="alert">
                  {addError}
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setAdding(false)}
                disabled={savingAdd}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAdd}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingAdd ? 'Saving…' : 'Add record'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function ChangeLine({ label, money, change }: { label: string; money?: boolean; change: HistoryChange }) {
  const show = (v: string | number | null) => (money ? formatMoney(v) : v === null || v === '' ? '(none)' : String(v));
  const pct = money ? percentChange(change) : null;
  const hadBefore = change.from !== null && change.from !== '';
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-slate-500">{label}:</span>
      {hadBefore && (
        <>
          <span className="text-slate-500">{show(change.from)}</span>
          <span className="text-slate-400" aria-label="changed to">
            →
          </span>
        </>
      )}
      <span className="font-semibold text-ink">{show(change.to)}</span>
      {pct && (
        <span className={`text-xs font-semibold ${pct.startsWith('+') ? 'text-good-text' : 'text-critical-text'}`}>({pct})</span>
      )}
    </li>
  );
}
