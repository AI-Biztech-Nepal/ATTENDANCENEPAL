'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_PEER_LIMIT, type ReviewGiver, type ReviewPerson } from '@/lib/colleagueReviews';

type Relation = 'c_level' | 'training';

/**
 * "Who gives feedback to whom": how many colleagues in the same department review each person, and who the C-level
 * and the training-and-compliance people are. The manager comes from each person's profile ("Reports to"), so there is
 * nothing to choose for that. The rules apply to the next round; a round that has started keeps the reviews it asked for.
 */
export default function ReviewRulesDialog({ people, peerLimit, givers, companyId, onClose, onSaved }: {
  people: ReviewPerson[];
  peerLimit: number;
  givers: ReviewGiver[];
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [limit, setLimit] = useState(String(peerLimit || DEFAULT_PEER_LIMIT));
  const [chosen, setChosen] = useState<Record<Relation, Set<string>>>(() => ({
    c_level: new Set(givers.filter(g => g.relation === 'c_level').map(g => g.employee_id)),
    training: new Set(givers.filter(g => g.relation === 'training').map(g => g.employee_id)),
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
    const chosenIds = new Set([...chosen.c_level, ...chosen.training, ...givers.map(g => g.employee_id)]);
    return people
      .filter(p => p.status === 'active' || chosenIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [people, chosen, givers]);

  function toggle(rel: Relation, id: string) {
    setChosen(c => {
      const next = new Set(c[rel]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...c, [rel]: next };
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const n = /^\d{1,2}$/.test(limit.trim()) ? Number(limit.trim()) : NaN;
    if (!(n >= 1 && n <= 20)) return setError('Peers for each person must be a whole number from 1 to 20.');
    setSaving(true);
    setError('');
    const settings = await supabase.from('review_settings').upsert({ company_id: companyId, peer_limit: n, updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
    if (settings.error) {
      setSaving(false);
      return setError(`Could not save: ${settings.error.message}`);
    }
    // Add the newly chosen first, then take off the ones no longer chosen, so a failure never leaves a role empty.
    for (const rel of ['c_level', 'training'] as Relation[]) {
      const before = new Set(givers.filter(g => g.relation === rel).map(g => g.employee_id));
      const toAdd = [...chosen[rel]].filter(id => !before.has(id));
      const toRemove = [...before].filter(id => !chosen[rel].has(id));
      if (toAdd.length > 0) {
        const added = await supabase.from('review_givers').insert(toAdd.map(employee_id => ({ employee_id, relation: rel })));
        if (added.error) {
          setSaving(false);
          return setError(`Could not save: ${added.error.message}`);
        }
      }
      if (toRemove.length > 0) {
        const removed = await supabase.from('review_givers').delete().eq('relation', rel).in('employee_id', toRemove);
        if (removed.error) {
          setSaving(false);
          return setError(`Could not save: ${removed.error.message}`);
        }
      }
    }
    setSaving(false);
    onSaved();
  }

  const list = (rel: Relation, title: string, hint: string) => (
    <fieldset className="m-0 mb-4 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-extrabold text-ink">{title}</legend>
      <p className="m-0 mb-2 text-xs text-slate-600">{hint}</p>
      <div className="max-h-44 overflow-y-auto rounded-[10px] border border-slate-300 bg-white p-1">
        {choices.length === 0 && <p className="m-0 p-2 text-sm text-slate-600">No employees yet.</p>}
        {choices.map(p => (
          <label key={p.id} className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-ink hover:bg-slate-50">
            <input type="checkbox" checked={chosen[rel].has(p.id)} onChange={() => toggle(rel, p.id)} className="h-4 w-4 accent-teal-700" />
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
        aria-label="Who gives feedback to whom"
        className="my-auto w-full max-w-[560px] rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 className="m-0 text-lg font-extrabold text-ink">Who gives feedback to whom</h2>
        <p className="m-0 mb-4 mt-1 text-[13px] leading-normal text-slate-600">
          These rules apply to the next round you start. A round that has already started keeps the reviews it asked for. Only people who have a login can give feedback.
        </p>

        <div className="mb-4">
          <label htmlFor="rules-peers" className="mb-1 block text-sm font-extrabold text-ink">
            Peers for each person
          </label>
          <p className="m-0 mb-2 text-xs text-slate-600">People in the same department. Each person is reviewed by this many of them, and gives the same number.</p>
          <input
            id="rules-peers"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={limit}
            onChange={e => setLimit(e.target.value)}
            className="h-11 w-28 rounded-[10px] border border-slate-300 bg-white px-3 text-base font-extrabold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>

        {list('c_level', 'C-level executives', 'Each person chosen here gives feedback on everyone else.')}
        {list('training', 'Training and compliance', 'Each person chosen here gives feedback on everyone else.')}

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
