'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  KPI_IDS,
  KPI_INFO,
  NAME_MAX,
  PEOPLE_WORDS,
  defaultKpiLabel,
  draftFromSettings,
  settingsFromDraft,
  toRow,
  wordsFor,
  type KpiId,
  type PeopleWord,
  type SettingsDraft,
} from '@/lib/kpiSettings';
import { publishKpiSettings, useKpiSettings } from '@/lib/useKpiSettings';
import { OWN_MAX, OWN_NAME_MAX, draftFromOwn, ownDirty, ownKpisFromRows, ownSaveProblem, planOwnSave, type OwnDraftRow, type OwnKpi } from '@/lib/ownKpi';
import { publishOwnKpis, useOwnKpis } from '@/lib/useOwnKpis';
import { useConfirm } from '@/components/ConfirmDialog';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const INPUT = 'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:bg-slate-50 disabled:text-slate-500';
const COLUMNS = 'sm:grid-cols-[72px_minmax(0,1fr)_230px_190px]';

// KPI settings (for the whole company: the same on every person's page): what the company calls the people it serves, which KPIs it uses and what it calls them, and the
// numbers the KPIs are worked out with. Saved to kpi_settings; every KPI page reads it (useKpiSettings). Each KPI
// still stands on its own: there is no total score, no ranking and no weighting to set here.
export default function KpiSettingsPage() {
  const { settings, loaded } = useKpiSettings();
  const { employeeId } = useParams<{ employeeId: string }>();
  const date = useSearchParams().get('date');
  const confirm = useConfirm();
  // The KPIs the company added itself. They are rows of their own in the database; the draft below is what the page shows
  // while they are edited, and Save writes the changes (a removal is separate: it deletes numbers, so it asks first).
  const own = useOwnKpis();
  const [ownDraft, setOwnDraft] = useState<OwnDraftRow[]>(() => draftFromOwn(own.kpis));
  const ownDraftNow = useRef(ownDraft);
  ownDraftNow.current = ownDraft;
  const ownSavedBefore = useRef<OwnKpi[]>(own.kpis);
  const newCount = useRef(0);
  const [focusKey, setFocusKey] = useState('');
  const [removed, setRemoved] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromSettings(settings));
  // What the draft was last made from, so a settings change that arrives while nothing has been edited is taken in.
  const baseline = useRef(JSON.stringify(draft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
      if (live) setCompanyId((data?.company_id as string | null) ?? null);
    })();
    return () => {
      live = false;
    };
  }, []);

  const draftNow = useRef(draft);
  draftNow.current = draft;
  useEffect(() => {
    // Nothing edited yet: take the settings in. Edited: leave the person's changes alone.
    if (JSON.stringify(draftNow.current) !== baseline.current) return;
    const next = draftFromSettings(settings);
    baseline.current = JSON.stringify(next);
    setDraft(next);
  }, [settings]);

  useEffect(() => {
    // Nothing edited: take the list in. Edited: leave the person's changes alone.
    if (!ownDirty(ownSavedBefore.current, ownDraftNow.current)) setOwnDraft(draftFromOwn(own.kpis));
    ownSavedBefore.current = own.kpis;
  }, [own.kpis]);

  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`own-name-${focusKey}`)?.focus();
    setFocusKey('');
  }, [focusKey, ownDraft]);

  const settingsDirty = JSON.stringify(draft) !== baseline.current;
  const ownIsDirty = ownDirty(own.kpis, ownDraft);
  const dirty = settingsDirty || ownIsDirty;
  const words = useMemo(() => wordsFor(draft.word), [draft.word]);
  const change = (patch: Partial<SettingsDraft>) => {
    setDraft(d => ({ ...d, ...patch }));
    setSaved(false);
    setError('');
  };
  const setName = (id: KpiId, text: string | undefined) => {
    setDraft(d => {
      const names = { ...d.names };
      if (text === undefined) delete names[id];
      else names[id] = text;
      return { ...d, names };
    });
    setSaved(false);
    setError('');
  };
  const toggle = (id: KpiId) => change({ off: draft.off.includes(id) ? draft.off.filter(x => x !== id) : [...draft.off, id] });

  const editOwn = (key: string, patch: Partial<Pick<OwnDraftRow, 'name' | 'on'>>) => {
    setOwnDraft(rows => rows.map(r => (r.key === key ? { ...r, ...patch } : r)));
    setSaved(false);
    setError('');
    setRemoved('');
  };
  const addOwn = () => {
    if (ownDraft.length >= OWN_MAX) return;
    const key = `new-${++newCount.current}`;
    setOwnDraft(rows => [...rows, { key, id: null, name: '', on: true }]);
    setFocusKey(key);
    setSaved(false);
    setError('');
    setRemoved('');
  };
  // A KPI that was never saved just goes. A saved one is deleted for good with everything typed in for it, so it asks first.
  async function removeOwn(row: OwnDraftRow) {
    if (!row.id) {
      setOwnDraft(rows => rows.filter(r => r.key !== row.key));
      return;
    }
    const id = row.id;
    const name = own.kpis.find(k => k.id === id)?.name ?? row.name;
    const sure = await confirm(`Remove "${name}"? Every number typed in for it, for every person and month, is deleted too. This cannot be undone. To hide it and keep its numbers, switch it off instead.`, {
      title: 'Remove this KPI?',
      confirmLabel: 'Remove and delete its numbers',
      tone: 'danger',
    });
    if (!sure) return;
    setError('');
    const { data, error: e } = await supabase.from('custom_kpis').delete().eq('id', id).select('id');
    if (e || !((data as unknown[] | null) ?? []).length) {
      setError(e ? ownSaveProblem(e, name).replace('Could not save:', 'Could not remove:') : 'Could not remove: nothing was removed.');
      return;
    }
    setOwnDraft(rows => rows.filter(r => r.key !== row.key));
    publishOwnKpis(own.kpis.filter(k => k.id !== id));
    setSaved(false);
    setRemoved(`Removed "${name}" and its numbers.`);
  }

  async function save() {
    if (saving) return;
    const result = settingsFromDraft(draft);
    if ('error' in result) {
      setError(result.error);
      setSaved(false);
      return;
    }
    // A KPI of your own cannot share a name with one of the ten, as they are called now.
    const usual = KPI_IDS.map(id => result.settings.names[id] ?? defaultKpiLabel(id, result.settings.word));
    const ownPlan = planOwnSave(own.kpis, ownDraft, usual);
    if ('error' in ownPlan) {
      setError(ownPlan.error);
      setSaved(false);
      return;
    }
    if (!companyId) {
      setError('Could not save: your company was not found.');
      return;
    }
    setSaving(true);
    setError('');
    setRemoved('');
    // The ten KPIs and the rules are one row; it is written only when it changed, so adding a KPI of your own does not
    // depend on the newest settings columns being there.
    if (settingsDirty) {
      // .select() so a save the security rules turn away is noticed instead of "saving" nothing.
      const { data, error: e } = await supabase.from('kpi_settings').upsert(toRow(result.settings, companyId), { onConflict: 'company_id' }).select('company_id');
      if (e || !((data as unknown[] | null) ?? []).length) {
        setSaving(false);
        const why = e?.message ?? 'nothing was saved';
        setError(`Could not save: ${why}${/column|schema cache/i.test(why) ? '. The database is missing the newest KPI settings columns: run the migration 20261122200000_kpi_settings_options.sql.' : ''}`);
        return;
      }
      const next = draftFromSettings(result.settings);
      baseline.current = JSON.stringify(next);
      setDraft(next);
      publishKpiSettings(result.settings);
    }
    // Then the KPIs of your own: renames and switches first (a name may be freed for a new KPI), then the new ones. It stops at
    // the first one the database turns away, and keeps what was done, so saving again carries on from there.
    let list = own.kpis;
    let rows = ownDraft;
    let failure = '';
    for (const u of ownPlan.plan.updates) {
      const { data, error: e } = await supabase.from('custom_kpis').update({ name: u.name, is_on: u.on }).eq('id', u.id).select('id');
      if (e || !((data as unknown[] | null) ?? []).length) {
        failure = e ? ownSaveProblem(e, u.name) : `Could not save "${u.name}": nothing was saved.`;
        break;
      }
      list = list.map(k => (k.id === u.id ? { ...k, name: u.name, on: u.on } : k));
      rows = rows.map(r => (r.id === u.id ? { ...r, name: u.name, on: u.on } : r));
    }
    if (!failure) {
      for (const n of ownPlan.plan.inserts) {
        const { data, error: e } = await supabase.from('custom_kpis').insert({ name: n.name, is_on: n.on }).select('id, name, is_on');
        const made = e ? [] : ownKpisFromRows(data as Record<string, unknown>[] | null);
        if (e || made.length === 0) {
          failure = e ? ownSaveProblem(e, n.name) : `Could not save "${n.name}": nothing was saved.`;
          break;
        }
        list = [...list, made[0]];
        rows = rows.map(r => (r.key === n.key ? { key: made[0].id, id: made[0].id, name: made[0].name, on: made[0].on } : r));
      }
    }
    setSaving(false);
    if (list !== own.kpis) publishOwnKpis(list);
    setOwnDraft(rows);
    if (failure) {
      setError(failure);
      setSaved(false);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 max-w-[760px] text-[13.5px] leading-relaxed text-slate-600">
        Every company is different. Choose which KPIs you use and what you call them. Each KPI is shown on its own: there is no total score, no ranking and no weighting.
      </p>

      <section aria-labelledby="words-heading" className={`${CARD} px-7 py-6`}>
        <h2 id="words-heading" className="m-0 mb-1 text-[17px] font-extrabold text-ink">
          Words your company uses
        </h2>
        <p className="m-0 mb-3.5 text-[13px] text-slate-600">This changes the names on every KPI page.</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label htmlFor="st-word" className="text-sm font-bold text-ink">
            What do you call the people you serve?
          </label>
          <select id="st-word" value={draft.word} onChange={e => change({ word: e.target.value as PeopleWord })} className={`${INPUT} min-w-[200px] sm:w-auto`}>
            {PEOPLE_WORDS.map(w => (
              <option key={w} value={w}>
                {wordsFor(w).One}
              </option>
            ))}
          </select>
        </div>
        <p className="m-0 mt-3 text-[13px] text-slate-600">
          Your pages will read: {words.One} feedback · {words.One} code · {words.Many} who came back
        </p>
      </section>

      <section aria-labelledby="kpis-heading" className={`${CARD} overflow-hidden pt-6`}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-7">
          <div className="min-w-0">
            <h2 id="kpis-heading" className="m-0 text-[17px] font-extrabold text-ink">
              Your KPIs
            </h2>
            <p className="m-0 mb-3.5 mt-1 text-[13px] text-slate-600">Turn off any that you do not use. They disappear from every page.</p>
          </div>
          <button
            type="button"
            onClick={addOwn}
            disabled={ownDraft.length >= OWN_MAX}
            title={ownDraft.length >= OWN_MAX ? `You can add up to ${OWN_MAX} KPIs of your own` : undefined}
            className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-teal-700 bg-white px-[18px] text-sm font-extrabold text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add your own KPI
          </button>
        </div>
        <div aria-hidden="true" className={`hidden gap-x-3 border-y border-slate-200 bg-slate-50 px-7 py-2.5 text-xs font-extrabold uppercase tracking-wider text-slate-600 sm:grid ${COLUMNS}`}>
          <span>Use</span>
          <span>Name</span>
          <span>Where the data comes from</span>
          <span>Shown as</span>
        </div>
        <ul aria-label="KPIs" className="m-0 list-none p-0">
          {KPI_IDS.map(id => {
            const on = !draft.off.includes(id);
            const info = KPI_INFO[id];
            return (
              <li key={id} className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5 last:border-0 sm:px-7 ${COLUMNS}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Use ${info.label}`}
                  onClick={() => toggle(id)}
                  className="flex h-11 w-14 items-center justify-start rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden="true" className={`relative block h-[26px] w-[44px] rounded-full transition-colors ${on ? 'bg-teal-700' : 'bg-slate-300'}`}>
                    <span className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? 21 : 3 }} />
                  </span>
                </button>
                <input
                  aria-label={`Name for ${info.label}`}
                  value={draft.names[id] ?? defaultKpiLabel(id, draft.word)}
                  maxLength={NAME_MAX}
                  disabled={!on}
                  onChange={e => setName(id, e.target.value)}
                  onBlur={e => {
                    if (e.target.value.trim() === '') setName(id, undefined);
                  }}
                  className={INPUT}
                />
                <span className="col-start-2 text-[13px] text-slate-700 sm:hidden">
                  {info.source} · {info.shownAs}
                </span>
                <span className="hidden text-[13.5px] text-slate-700 sm:block">{info.source}</span>
                <span className="hidden text-[13.5px] text-slate-700 sm:block">{info.shownAs}</span>
              </li>
            );
          })}
          {ownDraft.map((row, i) => {
            const label = row.name.trim() || `your own KPI ${i + 1}`;
            return (
              <li key={row.key} data-own-kpi className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5 last:border-0 sm:px-7 ${COLUMNS}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.on}
                  aria-label={`Use ${label}`}
                  onClick={() => editOwn(row.key, { on: !row.on })}
                  className="flex h-11 w-14 items-center justify-start rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden="true" className={`relative block h-[26px] w-[44px] rounded-full transition-colors ${row.on ? 'bg-teal-700' : 'bg-slate-300'}`}>
                    <span className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: row.on ? 21 : 3 }} />
                  </span>
                </button>
                <input
                  id={`own-name-${row.key}`}
                  aria-label={`Name for your own KPI ${i + 1}`}
                  placeholder="Name of your KPI, like Quality checks passed"
                  value={row.name}
                  maxLength={OWN_NAME_MAX}
                  disabled={!row.on}
                  onChange={e => editOwn(row.key, { name: e.target.value })}
                  className={INPUT}
                />
                <span className="col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-700 sm:hidden">
                  Typed in by you, each month · A number
                  <OwnBadge />
                  <RemoveButton label={label} onClick={() => removeOwn(row)} />
                </span>
                <span className="hidden text-[13.5px] text-slate-700 sm:block">
                  Typed in by you, each month <OwnBadge />
                </span>
                <span className="hidden items-center justify-between gap-2 text-[13.5px] text-slate-700 sm:flex">
                  A number
                  <RemoveButton label={label} onClick={() => removeOwn(row)} />
                </span>
              </li>
            );
          })}
        </ul>
        {ownDraft.some(r => r.id) && (
          <p className="m-0 border-t border-slate-100 px-7 py-3 text-[13px] text-slate-600">
            The numbers for your own KPIs are typed in each month, for everyone at once, on the{' '}
            <Link href={`/kpis/${employeeId}/own${date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''}`} className="font-bold text-teal-700 hover:underline">
              Your own KPIs
            </Link>{' '}
            tab.
          </p>
        )}
      </section>

      <section aria-labelledby="rules-heading" className={`${CARD} px-7 py-6`}>
        <h2 id="rules-heading" className="m-0 mb-3 text-[17px] font-extrabold text-ink">
          Rules
        </h2>
        <div className="flex flex-col">
          <Rule id="st-hours" label="Hours in a working day" hint="Used for hour utilisation" value={draft.hours} onChange={v => change({ hours: v })} inputMode="decimal" />
          <Rule
            id="st-min"
            label={words.t('Responses needed before customer feedback and NPS show')}
            hint="Stops one or two forms from standing for a whole month"
            value={draft.minResponses}
            onChange={v => change({ minResponses: v })}
            inputMode="numeric"
          />
          <Rule
            id="st-days"
            label={words.t('A customer counts as back if they return within')}
            hint="Used for the rebooking rate, in days"
            value={draft.repeatDays}
            onChange={v => change({ repeatDays: v })}
            inputMode="numeric"
            suffix="days"
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || !loaded}
          className="min-h-[44px] rounded-[10px] bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {dirty && !error && <span className="text-[13px] font-semibold text-slate-600">You have changes that are not saved.</span>}
        {removed && !dirty && (
          <span role="status" className="text-[13px] font-semibold text-emerald-800">
            {removed}
          </span>
        )}
        {saved && !dirty && (
          <span role="status" className="text-[13px] font-semibold text-emerald-800">
            Saved. Every KPI page now uses these settings.
          </span>
        )}
        {error && (
          <span role="alert" className="text-sm font-semibold text-critical-text">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/** The "Your own" tag next to a KPI the company added itself. */
function OwnBadge() {
  return <span className="ml-1.5 inline-block rounded-full bg-teal-100 px-2 py-px text-[11.5px] font-extrabold text-teal-800">Your own</span>;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${label}`}
      className="min-h-[36px] rounded-lg px-2.5 text-[13px] font-bold text-critical-text hover:bg-critical-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      Remove
    </button>
  );
}

function Rule({ id, label, hint, value, onChange, inputMode, suffix }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void; inputMode: 'numeric' | 'decimal'; suffix?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-slate-100 py-3.5 first:border-0">
      <div className="min-w-0 flex-[1_1_320px]">
        <label htmlFor={id} className="block text-sm font-bold text-ink">
          {label}
        </label>
        <div className="mt-0.5 text-[13px] text-slate-600">{hint}</div>
      </div>
      <div className="flex items-center gap-2.5 text-[13px] text-slate-700">
        <input id={id} type="text" inputMode={inputMode} value={value} onChange={e => onChange(e.target.value)} className="h-11 w-[88px] rounded-[10px] border border-slate-300 bg-white px-3 text-center text-sm font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
        {suffix}
      </div>
    </div>
  );
}
