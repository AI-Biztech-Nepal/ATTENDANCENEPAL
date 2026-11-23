'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildMonth, monthDateRange, stepAnchor, todayAnchor } from '@/lib/calendar';
import { nepalTodayIso } from '@/lib/shift';
import { otherCalendarSpan, parseMonthParam } from '@/lib/kpi';
import { MIGRATION, fetchAllChecked } from '@/lib/kpiLoad';
import { changedCount, effectiveText, ownSaveProblem, planEntry, valueFromRow, type SavedValue } from '@/lib/ownKpi';
import { useMonthInUrl } from '@/lib/useMonthInUrl';
import { useOwnKpis } from '@/lib/useOwnKpis';
import MonthStepper from '@/components/kpi/MonthStepper';
import { useConfirm } from '@/components/ConfirmDialog';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const INPUT = 'h-11 rounded-[10px] border border-slate-300 bg-white px-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

type Person = { id: string; name: string; department: string | null; status: string | null };

// Your own KPIs: where the numbers for the KPIs the company added itself (Settings > "Add your own KPI") are typed in. One
// KPI and one month at a time, every employee in one list with a box each, saved together. A box left empty means there is
// no number for that person (emptying a box that had one removes it). The numbers are for the whole company, so the list
// is the same on every person's page; the person whose page this is has their row marked.
export default function OwnKpisPage() {
  // useSearchParams needs a Suspense boundary, like the other pages that read the address.
  return (
    <Suspense fallback={null}>
      <OwnSection />
    </Suspense>
  );
}

function OwnSection() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const params = useSearchParams();
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const own = useOwnKpis();
  const today = useMemo(nepalTodayIso, []);

  const [anchor, setAnchor] = useState(() => parseMonthParam(params.get('date')) ?? todayAnchor());
  const { start, end } = useMemo(() => monthDateRange(system, anchor), [system, anchor]);
  const label = useMemo(() => buildMonth(system, anchor).label, [system, anchor]);
  const otherSpan = useMemo(() => otherCalendarSpan(system, start, end), [system, start, end]);
  useMonthInUrl(start);

  // Which KPI: the one the link asked for (?kpi=), else the first.
  const [wanted, setWanted] = useState(() => params.get('kpi') ?? '');
  const kpi = own.inUse.find(k => k.id === wanted) ?? own.inUse[0];

  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleError, setPeopleError] = useState('');
  // What is saved for the KPI and month on screen. It belongs to that KPI and month: after a save the same ones are read
  // again without blanking the list, and a different KPI or month shows Loading until its own numbers arrive.
  const [loadedSaved, setLoadedSaved] = useState<{ key: string; map: Map<string, SavedValue>; error: string } | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [find, setFind] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const scrolled = useRef(false);
  // Set by a save: the boxes go back to showing the saved numbers once the fresh ones have been read.
  const clearTypedOnLoad = useRef(false);

  useEffect(() => {
    let live = true;
    supabase
      .from('employees')
      .select('id, name, department, status')
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) setPeopleError(`Could not load the employees: ${e.message}`);
        else setPeople(((data as Person[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      });
    return () => {
      live = false;
    };
  }, []);

  const kpiId = kpi?.id;
  const started = start <= today;
  const dataKey = `${kpiId}|${start}|${end}`;
  const saved = loadedSaved && loadedSaved.key === dataKey ? loadedSaved.map : null;
  const savedError = loadedSaved && loadedSaved.key === dataKey ? loadedSaved.error : '';
  useEffect(() => {
    if (!kpiId || !started) return;
    let live = true;
    fetchAllChecked<{ id: string; employee_id: string; value: unknown }>(
      (a, b) => supabase.from('custom_kpi_values').select('id, employee_id, value').eq('kpi_id', kpiId).eq('period_start', start).eq('period_end', end).order('id', { ascending: true }).range(a, b),
      'the numbers for your own KPIs',
      MIGRATION.own
    ).then(({ rows, error: e }) => {
      if (!live) return;
      const map = new Map<string, SavedValue>();
      for (const r of rows) {
        const v = valueFromRow(r.value);
        if (v != null) map.set(r.employee_id, { id: r.id, value: v });
      }
      setLoadedSaved({ key: `${kpiId}|${start}|${end}`, map, error: e });
      if (clearTypedOnLoad.current) {
        clearTypedOnLoad.current = false;
        setTyped({});
      }
    });
    return () => {
      live = false;
    };
  }, [kpiId, start, end, started, reloadKey]);

  // Everyone who is active, and anyone who has a number for this month (someone who has since left still keeps theirs).
  const rows = useMemo(() => (people ?? []).filter(p => p.status === 'active' || saved?.has(p.id)), [people, saved]);
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? rows.filter(p => p.name.toLowerCase().includes(q) || (p.department ?? '').toLowerCase().includes(q)) : rows;
  }, [rows, find]);
  const ids = useMemo(() => rows.map(p => p.id), [rows]);

  const ready = !!kpi && started && people !== null && saved !== null;
  const plan = useMemo(() => (saved ? planEntry(ids, typed, saved) : null), [ids, typed, saved]);
  const changes = saved ? changedCount(ids, typed, saved) : 0;

  // Opened from someone's card: bring their row into view once.
  useEffect(() => {
    if (!ready || scrolled.current) return;
    scrolled.current = true;
    document.getElementById(`own-row-${employeeId}`)?.scrollIntoView({ block: 'center' });
  }, [ready, employeeId]);

  // Numbers typed and not saved are not thrown away by a click on the arrows or the KPI list without asking.
  async function keepOrDiscard(): Promise<boolean> {
    if (changes === 0) return true;
    return confirm(`You have ${changes} ${changes === 1 ? 'number' : 'numbers'} that ${changes === 1 ? 'is' : 'are'} not saved. Leave ${changes === 1 ? 'it' : 'them'} out?`, {
      title: 'Discard the numbers you typed?',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
  }
  function reset() {
    setTyped({});
    setError('');
    setNote('');
  }
  async function stepMonth(by: 1 | -1) {
    if (!(await keepOrDiscard())) return;
    reset();
    setAnchor(a => stepAnchor(system, a, by));
  }
  async function chooseKpi(id: string) {
    if (id === kpi?.id || !(await keepOrDiscard())) return;
    reset();
    setWanted(id);
  }

  async function save() {
    if (saving || !kpi || !plan || !saved) return;
    if (plan.errors.size > 0) {
      setError(`${plan.errors.size === 1 ? 'One box does' : `${plan.errors.size} boxes do`} not hold a number. Fix ${plan.errors.size === 1 ? 'it' : 'them'} and save again.`);
      setNote('');
      return;
    }
    setSaving(true);
    setError('');
    setNote('');
    let failure = '';
    if (plan.upserts.length > 0) {
      const body = plan.upserts.map(u => ({ kpi_id: kpi.id, employee_id: u.employeeId, period_start: start, period_end: end, value: u.value }));
      // .select() so a save the security rules turn away is noticed instead of "saving" nothing.
      const { data, error: e } = await supabase.from('custom_kpi_values').upsert(body, { onConflict: 'kpi_id,employee_id,period_start,period_end' }).select('id');
      if (e) failure = ownSaveProblem(e);
      else if (((data as unknown[] | null) ?? []).length !== body.length) failure = 'Could not save: not every number was accepted.';
    }
    if (!failure && plan.deletes.length > 0) {
      const { data, error: e } = await supabase.from('custom_kpi_values').delete().in('id', plan.deletes.map(d => d.id)).select('id');
      if (e) failure = ownSaveProblem(e);
      else if (((data as unknown[] | null) ?? []).length !== plan.deletes.length) failure = 'Could not remove: not every number was removed.';
    }
    setSaving(false);
    // Read what is saved again either way, so the boxes always show what the database holds.
    setReloadKey(k => k + 1);
    if (failure) {
      setError(failure);
      return;
    }
    const parts = [plan.upserts.length > 0 ? `${plan.upserts.length} saved` : '', plan.deletes.length > 0 ? `${plan.deletes.length} removed` : ''].filter(Boolean);
    clearTypedOnLoad.current = true;
    setNote(`Saved: ${parts.join(', ')}.`);
  }

  if (!own.loaded) return null;

  if (own.missing) {
    return (
      <p role="alert" className={`${CARD} m-0 px-6 py-5 text-sm font-semibold text-slate-700`}>
        Your own KPIs are not set up in the database yet: run the migration {MIGRATION.own}.
      </p>
    );
  }
  if (own.error) {
    return (
      <p role="alert" className={`${CARD} m-0 px-6 py-5 text-sm font-semibold text-slate-700`}>
        {own.error}
      </p>
    );
  }
  if (!kpi) {
    return (
      <section aria-labelledby="own-heading" className={`${CARD} px-7 py-6`}>
        <h2 id="own-heading" className="m-0 text-[17px] font-extrabold text-ink">
          Your own KPIs
        </h2>
        <p className="m-0 mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-slate-600">
          {own.kpis.length > 0 ? 'Every KPI of your own is switched off.' : 'You have not added a KPI of your own yet.'} Add one, or switch one on, in Settings. Then type in each person&apos;s number here, each month.
        </p>
        <Link href={`/kpis/${employeeId}/settings?date=${start}`} className="mt-4 inline-flex min-h-[44px] items-center rounded-[10px] border border-teal-700 bg-white px-5 text-sm font-extrabold text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          Open Settings
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <MonthStepper label={label} subtitle={otherSpan} onPrevious={() => stepMonth(-1)} onNext={() => stepMonth(1)} />
        <div className="flex items-center gap-2.5">
          <label htmlFor="own-kpi" className="text-sm font-bold text-ink">
            KPI
          </label>
          <select id="own-kpi" value={kpi.id} onChange={e => chooseKpi(e.target.value)} className={`${INPUT} min-w-[220px] pr-9`}>
            {own.inUse.map(k => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section aria-labelledby="own-heading" className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-7 pb-4 pt-6">
          <div className="min-w-0 flex-[1_1_360px]">
            <h2 id="own-heading" className="m-0 text-[17px] font-extrabold text-ink">
              {kpi.name}
            </h2>
            <p className="m-0 mt-1 text-[13px] leading-relaxed text-slate-600">
              Type in each person&apos;s number for {label}. Leave a box empty when there is no number. Press Enter to go to the next box. Nothing is added up or ranked.
            </p>
          </div>
          <input type="search" aria-label="Find a person" placeholder="Find a person" value={find} onChange={e => setFind(e.target.value)} className={`${INPUT} w-full sm:w-[220px]`} />
        </div>

        {!started ? (
          <p className="m-0 border-t border-slate-200 px-7 py-8 text-center text-sm text-slate-600">This month has not started, so there is nothing to type in yet.</p>
        ) : peopleError || savedError ? (
          <p role="alert" className="m-0 border-t border-slate-200 px-7 py-6 text-sm font-semibold text-critical-text">
            {peopleError || savedError}
          </p>
        ) : !ready ? (
          <p className="m-0 border-t border-slate-200 px-7 py-8 text-center text-sm text-slate-600">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="m-0 border-t border-slate-200 px-7 py-8 text-center text-sm text-slate-600">{rows.length === 0 ? 'No employees to show.' : 'Nobody matches that.'}</p>
        ) : (
          <>
            <div aria-hidden="true" className="hidden border-y border-slate-200 bg-slate-50 px-7 py-2.5 text-xs font-extrabold uppercase tracking-wider text-slate-600 sm:grid sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-x-4">
              <span>Employee</span>
              <span>{kpi.name}</span>
            </div>
            <ul aria-label={`${kpi.name}, ${label}`} className="m-0 list-none p-0">
              {shown.map((p, i) => {
                const text = effectiveText(typed, saved!, p.id);
                const problem = plan?.errors.get(p.id);
                const was = saved!.get(p.id);
                const isThis = p.id === employeeId;
                return (
                  <li id={`own-row-${p.id}`} key={p.id} className={`grid grid-cols-1 items-center gap-x-4 gap-y-1.5 border-b border-slate-100 px-4 py-2.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_200px] sm:px-7 ${isThis ? 'bg-teal-50/60' : ''}`}>
                    <div className="min-w-0">
                      <label htmlFor={`own-${p.id}`} className="block truncate text-sm font-bold text-ink">
                        {p.name}
                        {isThis && <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 align-middle text-[11.5px] font-extrabold text-teal-800">This person</span>}
                      </label>
                      <div className="truncate text-xs text-slate-600">
                        {[p.department, p.status !== 'active' ? 'No longer active' : ''].filter(Boolean).join(' · ') || ' '}
                      </div>
                    </div>
                    <div>
                      <input
                        id={`own-${p.id}`}
                        ref={el => {
                          inputs.current[i] = el;
                        }}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={text}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? `own-${p.id}-problem` : undefined}
                        placeholder={was ? undefined : '–'}
                        onChange={e => {
                          setTyped(t => ({ ...t, [p.id]: e.target.value }));
                          setNote('');
                          setError('');
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            inputs.current[i + 1]?.focus();
                            inputs.current[i + 1]?.select();
                          }
                        }}
                        className={`${INPUT} w-full tabular-nums ${problem ? 'border-critical' : ''}`}
                      />
                      {problem && (
                        <div id={`own-${p.id}-problem`} className="mt-1 text-xs font-semibold text-critical-text">
                          {problem}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 bg-slate-50 px-7 py-4">
              <button
                type="button"
                onClick={save}
                disabled={saving || changes === 0}
                className="min-h-[44px] rounded-[10px] bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save numbers'}
              </button>
              {changes > 0 && !error && (
                <span className="text-[13px] font-semibold text-slate-600">
                  {changes} {changes === 1 ? 'number' : 'numbers'} not saved yet.
                </span>
              )}
              {note && changes === 0 && (
                <span role="status" className="text-[13px] font-semibold text-emerald-800">
                  {note}
                </span>
              )}
              {error && (
                <span role="alert" className="text-sm font-semibold text-critical-text">
                  {error}
                </span>
              )}
              <span className="ml-auto text-[12.5px] text-slate-600">
                {saved!.size} of {rows.length} {rows.length === 1 ? 'person has' : 'people have'} a number for {label}.
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
