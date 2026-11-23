'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MIGRATION, isMissingTable } from '@/lib/kpiLoad';
import type { FeedbackPerson } from '@/lib/colleagueFeedback';

type Role = 'c_level' | 'training';
export type FeedbackRole = { employee_id: string; role: Role };

/**
 * "Who counts as what": the C-level executives and the training-and-compliance people. Feedback they give counts toward the
 * "C-level" and "Training and compliance" KPIs of the person it is about. The manager needs no choosing: it is whoever the
 * person "Reports to" in their profile. Everyone else counts as a peer. A change applies to feedback given from then on.
 */
export default function FeedbackRolesDialog({ people, roles, onClose, onSaved }: {
  people: FeedbackPerson[];
  roles: FeedbackRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [chosen, setChosen] = useState<Record<Role, Set<string>>>(() => ({
    c_level: new Set(roles.filter(g => g.role === 'c_level').map(g => g.employee_id)),
    training: new Set(roles.filter(g => g.role === 'training').map(g => g.employee_id)),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Everyone active, plus anyone already chosen who has since left, so they can be taken off the list.
  const choices = useMemo(() => {
    const chosenIds = new Set([...chosen.c_level, ...chosen.training, ...roles.map(g => g.employee_id)]);
    return people.filter(p => p.status === 'active' || chosenIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [people, chosen, roles]);

  function toggle(role: Role, id: string) {
    setChosen(c => {
      const next = new Set(c[role]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...c, [role]: next };
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const fail = (e2: { code?: string; message?: string }) => {
      setSaving(false);
      setError(isMissingTable(e2) ? `Colleague feedback is not set up in the database yet: run the migration ${MIGRATION.reviews}.` : `Could not save: ${e2.message}`);
    };
    // Add the newly chosen first, then take off the ones no longer chosen, so a failure never leaves a role empty.
    for (const role of ['c_level', 'training'] as Role[]) {
      const before = new Set(roles.filter(g => g.role === role).map(g => g.employee_id));
      const toAdd = [...chosen[role]].filter(id => !before.has(id));
      const toRemove = [...before].filter(id => !chosen[role].has(id));
      if (toAdd.length > 0) {
        const added = await supabase.from('feedback_roles').insert(toAdd.map(employee_id => ({ employee_id, role }))).select('employee_id');
        if (added.error) return fail(added.error);
      }
      if (toRemove.length > 0) {
        const removed = await supabase.from('feedback_roles').delete().eq('role', role).in('employee_id', toRemove).select('employee_id');
        if (removed.error) return fail(removed.error);
      }
    }
    setSaving(false);
    onSaved();
  }

  const list = (role: Role, title: string, hint: string) => (
    <fieldset className="m-0 mb-4 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-extrabold text-ink">{title}</legend>
      <p className="m-0 mb-2 text-xs text-slate-600">{hint}</p>
      <div className="max-h-44 overflow-y-auto rounded-[10px] border border-slate-300 bg-white p-1">
        {choices.length === 0 && <p className="m-0 p-2 text-sm text-slate-600">No employees yet.</p>}
        {choices.map(p => (
          <label key={p.id} className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-ink hover:bg-slate-50">
            <input type="checkbox" checked={chosen[role].has(p.id)} onChange={() => toggle(role, p.id)} className="h-4 w-4 accent-teal-700" />
            <span className="min-w-0 flex-1 truncate">
              {p.name}
              {p.department ? <span className="text-slate-600"> · {p.department}</span> : null}
            </span>
            {p.status !== 'active' && <span className="text-xs font-semibold text-slate-600">no longer active</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center" onClick={() => !saving && onClose()}>
      <form
        noValidate
        onSubmit={save}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Who counts as C-level and training"
        className="my-auto w-full max-w-[560px] rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 className="m-0 text-lg font-extrabold text-ink">Who counts as C-level and training</h2>
        <p className="m-0 mb-4 mt-1 text-[13px] leading-normal text-slate-600">
          Feedback from the people you choose here counts toward the C-level and the training and compliance KPIs. A person&apos;s manager is whoever they &quot;Report to&quot; in their profile, so there is nothing to choose for that. Everyone else counts as a peer.
          A change applies to feedback given from then on.
        </p>

        {list('c_level', 'C-level executives', 'Feedback they give counts as feedback from C-level.')}
        {list('training', 'Training and compliance', 'Feedback they give counts as feedback from training and compliance.')}

        {error && (
          <p role="alert" className="m-0 mb-3 text-sm font-semibold text-critical-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-[44px] rounded-[10px] px-5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="min-h-[44px] rounded-[10px] bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
