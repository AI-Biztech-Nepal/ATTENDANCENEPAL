'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
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
import KpiTabs from '@/components/kpi/KpiTabs';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const INPUT = 'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:bg-slate-50 disabled:text-slate-500';
const COLUMNS = 'sm:grid-cols-[72px_minmax(0,1fr)_230px_190px]';

// KPIs > Settings: what the company calls the people it serves, which KPIs it uses and what it calls them, and the
// numbers the KPIs are worked out with. Saved to kpi_settings; every KPI page reads it (useKpiSettings). Each KPI
// still stands on its own: there is no total score, no ranking and no weighting to set here.
export default function KpiSettingsPage() {
  usePageTitle('KPIs');
  const { settings, loaded } = useKpiSettings();
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

  const dirty = JSON.stringify(draft) !== baseline.current;
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

  async function save() {
    if (saving) return;
    const result = settingsFromDraft(draft);
    if ('error' in result) {
      setError(result.error);
      setSaved(false);
      return;
    }
    if (!companyId) {
      setError('Could not save: your company was not found.');
      return;
    }
    setSaving(true);
    setError('');
    // .select() so a save the security rules turn away is noticed instead of "saving" nothing.
    const { data, error: e } = await supabase.from('kpi_settings').upsert(toRow(result.settings, companyId), { onConflict: 'company_id' }).select('company_id');
    setSaving(false);
    if (e || !((data as unknown[] | null) ?? []).length) {
      const why = e?.message ?? 'nothing was saved';
      setError(`Could not save: ${why}${/column|schema cache/i.test(why) ? '. The database is missing the newest KPI settings columns: run the migration 20261122200000_kpi_settings_options.sql.' : ''}`);
      return;
    }
    const next = draftFromSettings(result.settings);
    baseline.current = JSON.stringify(next);
    setDraft(next);
    publishKpiSettings(result.settings);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <KpiTabs />

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
        <h2 id="kpis-heading" className="m-0 px-7 text-[17px] font-extrabold text-ink">
          Your KPIs
        </h2>
        <p className="m-0 mb-3.5 mt-1 px-7 text-[13px] text-slate-600">Turn off any that you do not use. They disappear from every page.</p>
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
        </ul>
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
