'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams } from 'next/navigation';
import { isKpiOn, kpiLabel } from '@/lib/kpiSettings';
import { publishKpiSettings, useKpiSettings } from '@/lib/useKpiSettings';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatAdDate } from '@/lib/calendar';
import { nepalTodayIso } from '@/lib/shift';
import {
  CHUNK_SIZE,
  ROLE_LABEL,
  analyse,
  buildRecords,
  chunk,
  defaultCounted,
  detectDateOrder,
  distinctValues,
  guessRoles,
  guessUnit,
  looksLikePersonalData,
  readTable,
  type ColumnRole,
  type DateOrder,
  type EmployeeRef,
  type Table,
} from '@/lib/serviceImport';
import { useConfirm } from '@/components/ConfirmDialog';

type PastImport = { id: string; file_name: string; rows_read: number; rows_imported: number; first_date: string | null; last_date: string | null; created_at: string };

const MAX_BYTES = 10 * 1024 * 1024;
const ROLES: ColumnRole[] = ['employee', 'date', 'service', 'minutes', 'customer', 'status', 'ignore'];
const SELECT = 'h-11 w-full rounded-[10px] border border-slate-300 bg-white px-2.5 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

// Service import (for the whole company: the same on every person's page): the booking system's file (a CSV) is read here in the browser. The admin says what each column is, names
// the file does not match to an employee are matched by hand, and the rows are saved. Customer names, phone numbers
// and IDs are never kept: only a scrambled code, enough to tell that two services were for the same customer. Rows
// that were already imported (an export that overlaps an earlier one) are left out, and a whole import can be removed.
export default function ImportPage() {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const { employeeId } = useParams<{ employeeId: string }>();
  // Which KPIs this company uses, what it calls them and its people (KPIs > Settings).
  const { settings, words } = useKpiSettings();
  const today = useMemo(nepalTodayIso, []);
  const fileInput = useRef<HTMLInputElement>(null);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [people, setPeople] = useState<(EmployeeRef & { status: string })[]>([]);
  const [past, setPast] = useState<PastImport[] | null>(null);
  const [pastError, setPastError] = useState('');

  const [file, setFile] = useState<{ name: string; table: Table } | null>(null);
  const [readError, setReadError] = useState('');
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [unit, setUnit] = useState<'minutes' | 'hours'>('minutes');
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [counted, setCounted] = useState<Set<string>>(new Set());
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const [windowDays, setWindowDays] = useState('45');
  const [windowNote, setWindowNote] = useState('');

  // The saved window (from Settings, or from here) is what the box shows until it is edited.
  useEffect(() => setWindowDays(String(settings.repeatDays)), [settings.repeatDays]);

  const loadPast = useCallback(() => {
    supabase
      .from('service_imports')
      .select('id, file_name, rows_read, rows_imported, first_date, last_date, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error: e }) => {
        if (e) setPastError(`Could not load earlier imports: ${e.message}`);
        else setPastError('');
        setPast((data as PastImport[] | null) ?? []);
      });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
      if (live) setCompanyId((data?.company_id as string | null) ?? null);
    })();
    supabase
      .from('employees')
      .select('id, name, employee_code, status')
      .then(({ data }) => live && setPeople(((data as (EmployeeRef & { status: string })[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))));
    loadPast();
    return () => {
      live = false;
    };
  }, [loadPast]);

  const analysis = useMemo(
    () => (file ? analyse(file.table, { roles, unit, dateOrder, counted: roles.includes('status') ? counted : null }, people, nameMap, today) : null),
    [file, roles, unit, dateOrder, counted, people, nameMap, today]
  );

  async function chooseFile(f: File | undefined | null) {
    if (!f) return;
    setReadError('');
    setError('');
    setDone('');
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setReadError('Only CSV files can be imported. In Excel, choose File, Save As, and pick "CSV".');
      return;
    }
    if (f.size > MAX_BYTES) {
      setReadError('That file is larger than 10 MB. Split it by month and import each part.');
      return;
    }
    try {
      const table = readTable(await f.text());
      const guessed = guessRoles(table.headers);
      const dateCol = guessed.indexOf('date');
      const minutesCol = guessed.indexOf('minutes');
      const statusCol = guessed.indexOf('status');
      setFile({ name: f.name, table });
      setRoles(guessed);
      setUnit(minutesCol >= 0 ? guessUnit(table.headers[minutesCol]) : 'minutes');
      setDateOrder(dateCol >= 0 ? detectDateOrder(table.rows.map(r => r[dateCol])).order : 'dmy');
      setCounted(statusCol >= 0 ? defaultCounted(distinctValues(table, statusCol).map(v => v.value)) : new Set());
      setNameMap({});
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'The file could not be read.');
    }
  }

  function changeRole(index: number, role: ColumnRole) {
    if (!file) return;
    // Names matched by hand belong to the column they were read from.
    if (role === 'employee' || roles[index] === 'employee') setNameMap({});
    setRoles(prev => prev.map((r, i) => (i === index ? role : role !== 'ignore' && r === role ? 'ignore' : r)));
    if (role === 'minutes') setUnit(guessUnit(file.table.headers[index]));
    if (role === 'status') setCounted(defaultCounted(distinctValues(file.table, index).map(v => v.value)));
    if (role === 'date') setDateOrder(detectDateOrder(file.table.rows.map(r => r[index])).order);
  }

  function reset() {
    setFile(null);
    setRoles([]);
    setNameMap({});
    setReadError('');
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function saveWindow() {
    const n = /^\d{1,3}$/.test(windowDays.trim()) ? Number(windowDays.trim()) : NaN;
    if (!(n >= 1 && n <= 365)) {
      setWindowNote('Use a whole number of days from 1 to 365.');
      return;
    }
    if (n === settings.repeatDays || !companyId) {
      setWindowNote('');
      return;
    }
    const { error: e } = await supabase.from('kpi_settings').upsert({ company_id: companyId, repeat_window_days: n }, { onConflict: 'company_id' });
    if (e) setWindowNote(`Could not save: ${e.message}`);
    else {
      publishKpiSettings({ ...settings, repeatDays: n });
      setWindowNote('Saved.');
    }
  }

  async function runImport() {
    if (!file || !analysis || !companyId || busy || analysis.rows.length === 0) return;
    setBusy(true);
    setError('');
    const made = await supabase
      .from('service_imports')
      .insert({ file_name: file.name.slice(0, 200), rows_read: analysis.counts.read, first_date: analysis.firstDate, last_date: analysis.lastDate })
      .select('id');
    const importId = (made.data as { id: string }[] | null)?.[0]?.id;
    if (made.error || !importId) {
      setBusy(false);
      setError(`Could not start the import: ${made.error?.message ?? 'nothing was created'}`);
      return;
    }
    // Everything or nothing: if any part fails, the import is removed again and with it every row it already added.
    const undo = async () => {
      await supabase.from('service_imports').delete().eq('id', importId);
    };
    let added = 0;
    let total = 0;
    try {
      const records = await buildRecords(analysis.rows, companyId, importId);
      total = records.length;
      for (const part of chunk(records, CHUNK_SIZE)) {
        const res = await supabase.from('service_records').upsert(part, { onConflict: 'row_key', ignoreDuplicates: true }).select('id');
        if (res.error) throw new Error(res.error.message);
        added += ((res.data as unknown[] | null) ?? []).length;
      }
    } catch (e) {
      await undo();
      setBusy(false);
      setError(`The import was stopped and nothing was saved: ${e instanceof Error ? e.message : 'something went wrong'}`);
      return;
    }
    if (added === 0) {
      await undo();
      setBusy(false);
      reset();
      setDone(`Nothing new: all ${total} rows had already been imported.`);
      loadPast();
      return;
    }
    const fin = await supabase.from('service_imports').update({ rows_imported: added }).eq('id', importId).select('id');
    setBusy(false);
    if (fin.error) {
      setError(`The rows were saved but the import could not be updated: ${fin.error.message}`);
    }
    const already = total - added;
    const name = file.name;
    reset();
    setDone(`Imported ${added} ${added === 1 ? 'row' : 'rows'} from ${name}.${already > 0 ? ` ${already} ${already === 1 ? 'was' : 'were'} already imported and left out.` : ''}`);
    loadPast();
  }

  async function removeImport(p: PastImport) {
    const ok = await confirm(
      `Remove the import of ${p.file_name}? The ${p.rows_imported === 1 ? 'service' : `${p.rows_imported} services`} it added will no longer count. The file itself is not touched. This cannot be undone.`,
      { title: 'Remove import', confirmLabel: 'Remove import', tone: 'danger' }
    );
    if (!ok) return;
    const res = await supabase.from('service_imports').delete().eq('id', p.id).select('id');
    if (res.error || !((res.data as unknown[] | null) ?? []).length) setPastError(`Could not remove it: ${res.error?.message ?? 'it was not found'}`);
    else {
      setPastError('');
      setDone('');
    }
    loadPast();
  }

  const c = analysis?.counts;
  const missing = analysis?.missing ?? [];
  // Names not recognised, then the ones already matched by hand, so a choice can still be changed.
  const nameList = useMemo(() => {
    const unknown = (analysis?.unmatchedNames ?? []).map(u => u.name);
    return [...unknown, ...Object.keys(nameMap).filter(k => nameMap[k] && !unknown.includes(k))];
  }, [analysis, nameMap]);
  const personalWarning = useMemo(() => {
    const i = roles.indexOf('customer');
    return file && i >= 0 ? looksLikePersonalData(file.table.rows.map(r => r[i])) : false;
  }, [file, roles]);
  const statusCol = roles.indexOf('status');
  const statusValues = useMemo(() => (file && statusCol >= 0 ? distinctValues(file.table, statusCol) : []), [file, statusCol]);
  const dateCol = roles.indexOf('date');
  const dateInfo = useMemo(() => (file && dateCol >= 0 ? detectDateOrder(file.table.rows.map(r => r[dateCol])) : null), [file, dateCol]);
  const slashDates = useMemo(() => !!file && dateCol >= 0 && file.table.rows.some(r => /^\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}/.test(r[dateCol])), [file, dateCol]);
  const dayText = (d: string) => formatAdDate(d, system);
  const fills = (['services', 'rebooking', 'utilisation'] as const).filter(id => isKpiOn(id, settings));
  const stepNo = !file ? 1 : missing.length > 0 || (c?.import ?? 0) === 0 ? 2 : 3;

  const steps = ['Upload the file', 'Match the columns', 'Check and import'];

  const checkRows: [string, number, boolean][] = c
    ? [
        ['Rows read', c.read, true],
        ['Will be imported', c.import, true],
        ['Skipped, status not counted', c.notCounted, false],
        ['Skipped, no employee named', c.noName, false],
        ['Need a name matched', c.unmatched, false],
        ['Left out by your choice', c.skippedByChoice, false],
        ['Skipped, date not understood', c.badDate, false],
        ['Skipped, time not understood', c.badTime, false],
        ['Skipped, dated in the future', c.future, false],
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      <ol aria-label="Steps" className="m-0 flex list-none flex-wrap gap-x-7 gap-y-2.5 p-0 text-[13.5px]">
        {steps.map((s, i) => {
          const n = i + 1;
          const isDone = n < stepNo;
          const current = n === stepNo;
          return (
            <li key={s} aria-current={current ? 'step' : undefined} className={`flex items-center gap-2 ${current ? 'font-extrabold text-ink' : 'text-slate-600'}`}>
              <span
                className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-xs ${
                  isDone ? 'bg-teal-700 text-white' : current ? 'border-2 border-teal-700 text-teal-700' : 'border-2 border-slate-300 text-slate-600'
                }`}
              >
                {isDone ? '✓' : n}
              </span>
              {s}
            </li>
          );
        })}
      </ol>

      {done && (
        <p role="status" className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          {done}
        </p>
      )}

      {!file ? (
        <section aria-labelledby="upload-heading" className={`${CARD} px-7 py-6`}>
          <h2 id="upload-heading" className="m-0 text-lg font-extrabold text-ink">
            Upload the file
          </h2>
          <p className="m-0 mb-4 mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-slate-600">
            Export your bookings from your booking system as a CSV file and choose it here. Each row should be one service an employee performed. In Excel, use File, Save As, and pick &quot;CSV&quot;.
          </p>
          <div
            onDragOver={e => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              chooseFile(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center ${dragging ? 'border-teal-700 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
          >
            <div className="text-sm font-semibold text-slate-700">Drop a CSV file here, or</div>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-[10px] bg-teal-700 px-6 text-sm font-extrabold text-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-teal-700 hover:bg-teal-800">
              Choose a file
              <input ref={fileInput} id="import-file" type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={e => chooseFile(e.target.files?.[0])} />
            </label>
            <div className="text-xs text-slate-600">CSV only, up to 10 MB and 20,000 rows.</div>
          </div>
          {readError && (
            <p role="alert" className="m-0 mt-3 text-sm font-semibold text-critical-text">
              {readError}
            </p>
          )}
          <p className="m-0 mt-4 rounded-[10px] bg-slate-100 px-3.5 py-3 text-[13px] leading-normal text-slate-700">
            {words.t('Customer names and phone numbers are never imported. A customer is only a code, used to tell who came back.')}
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-5">
            <section aria-labelledby="match-heading" className={`${CARD} min-w-0 flex-[3_1_640px] px-7 pb-5 pt-6`}>
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <h2 id="match-heading" className="m-0 text-lg font-extrabold text-ink">
                  Match the columns
                </h2>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-[12.5px] font-bold text-slate-700">
                  {file.name} · {file.table.rows.length} rows
                </span>
              </div>
              <p className="m-0 mb-4 mt-1.5 text-[13px] leading-normal text-slate-600">Tell us what each column in your file is. We guessed most of them.</p>

              <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_250px] gap-x-4 border-b border-slate-200 pb-2.5 text-xs font-extrabold uppercase tracking-wider text-slate-600 sm:grid">
                <span>Column in your file</span>
                <span>Example</span>
                <span>Use it for</span>
              </div>
              <ul aria-label="Columns in your file" className="m-0 list-none p-0">
                {file.table.headers.map((h, i) => (
                  <li key={i} className="grid grid-cols-1 gap-y-1.5 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_250px] sm:items-center sm:gap-x-4 sm:gap-y-0 sm:py-2">
                    <span className="truncate text-sm font-bold text-ink">{h}</span>
                    <span className="truncate text-[13px] text-slate-600">
                      <span className="sm:hidden">Example: </span>
                      {file.table.rows.find(r => r[i])?.[i] ?? ''}
                    </span>
                    <select aria-label={`Use ${h} for`} value={roles[i] ?? 'ignore'} onChange={e => changeRole(i, e.target.value as ColumnRole)} className={SELECT}>
                      {ROLES.map(r => (
                        <option key={r} value={r}>
                          {words.t(ROLE_LABEL[r])}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>

              {missing.length > 0 && (
                <p role="alert" className="m-0 mt-3 text-sm font-semibold text-critical-text">
                  Choose which column is the {missing.map(m => ROLE_LABEL[m].toLowerCase()).join(' and the ')}.
                </p>
              )}

              {roles.includes('minutes') && (
                <div className="mt-4 flex flex-wrap items-center gap-2.5 text-[13px] text-slate-700">
                  <label htmlFor="import-unit" className="font-bold">{words.t('The time with the customer is in')}</label>
                  <select id="import-unit" value={unit} onChange={e => setUnit(e.target.value as 'minutes' | 'hours')} className="h-10 rounded-[10px] border border-slate-300 bg-white px-2.5 text-sm font-semibold text-ink">
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                  </select>
                </div>
              )}
              {slashDates && (
                <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px] text-slate-700">
                  <label htmlFor="import-date-order" className="font-bold">Dates are written</label>
                  <select id="import-date-order" value={dateOrder} onChange={e => setDateOrder(e.target.value as DateOrder)} className="h-10 rounded-[10px] border border-slate-300 bg-white px-2.5 text-sm font-semibold text-ink">
                    <option value="dmy">day / month / year</option>
                    <option value="mdy">month / day / year</option>
                  </select>
                  {dateInfo?.ambiguous && <span className="text-xs font-semibold text-amber-800">Check this: your dates could be read either way.</span>}
                </div>
              )}
              {statusValues.length > 0 && (
                <fieldset className="m-0 mt-4 border-0 p-0">
                  <legend className="mb-1.5 p-0 text-[13px] font-bold text-slate-700">Count these statuses as a service performed</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {statusValues.map(v => (
                      <label key={v.value} className="flex min-h-[36px] cursor-pointer items-center gap-2 text-[13.5px] text-ink">
                        <input
                          type="checkbox"
                          checked={counted.has(v.value)}
                          onChange={() =>
                            setCounted(prev => {
                              const next = new Set(prev);
                              if (next.has(v.value)) next.delete(v.value);
                              else next.add(v.value);
                              return next;
                            })
                          }
                          className="h-4 w-4 accent-teal-700"
                        />
                        {v.value || '(blank)'} <span className="text-slate-600">({v.rows})</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {personalWarning && (
                <p role="alert" className="m-0 mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] font-semibold leading-normal text-amber-900">
                  {words.t('The column used for the customer code looks like names, phone numbers or email addresses. Choose a customer ID column instead, or set it to "Do not import". Codes are scrambled before they are saved, but it is better not to send them at all.')}
                </p>
              )}
              <p className="m-0 mt-4 rounded-[10px] bg-slate-100 px-3.5 py-3 text-[13px] leading-normal text-slate-700">
                {words.t('Customer names and phone numbers are never imported. A customer is only a code, used to tell who came back.')}
              </p>
            </section>

            <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-5">
              <section aria-labelledby="fills-heading" className={`${CARD} px-6 pb-2 pt-5`}>
                <h2 id="fills-heading" className="m-0 mb-1.5 text-base font-extrabold text-ink">What this fills in</h2>
                {fills.length === 0 && (
                  <p className="m-0 border-t border-slate-200 py-3.5 text-[13px] leading-normal text-slate-600">
                    None of the KPIs this file fills in are turned on for this company.
                  </p>
                )}
                {isKpiOn('services', settings) && (
                  <div className="border-t border-slate-200 py-3.5">
                    <div className="text-sm font-bold text-ink">{kpiLabel('services', settings)}</div>
                    <div className="mt-0.5 text-[13px] leading-normal text-slate-600">Completed services per employee, per month.</div>
                  </div>
                )}
                {isKpiOn('rebooking', settings) && (
                  <div className="border-t border-slate-200 py-3.5">
                    <div className="text-sm font-bold text-ink">{kpiLabel('rebooking', settings)}</div>
                    <div className="mt-0.5 text-[13px] leading-normal text-slate-600">{words.t('Customers who came back, out of the customers served that month.')}</div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-[13px] text-slate-700">
                      <label htmlFor="rb-days">Counts as back if they return within</label>
                      <input
                        id="rb-days"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={365}
                        value={windowDays}
                        onChange={e => {
                          setWindowDays(e.target.value);
                          setWindowNote('');
                        }}
                        onBlur={saveWindow}
                        className="h-10 w-[72px] rounded-[10px] border border-slate-300 px-2.5 text-sm font-bold text-ink"
                      />
                      days
                    </div>
                    {windowNote && (
                      <p role={windowNote === 'Saved.' ? 'status' : 'alert'} className={`m-0 mt-1.5 text-xs font-semibold ${windowNote === 'Saved.' ? 'text-emerald-800' : 'text-critical-text'}`}>
                        {windowNote}
                      </p>
                    )}
                  </div>
                )}
                {isKpiOn('utilisation', settings) && (
                  <div className="border-t border-slate-200 py-3.5">
                    <div className="text-sm font-bold text-ink">{kpiLabel('utilisation', settings)}</div>
                    <div className="mt-0.5 text-[13px] leading-normal text-slate-600">
                      {words.t(`Time with customers, out of a ${settings.hoursPerDay}-hour working day, averaged over the days worked.`)}
                    </div>
                  </div>
                )}
              </section>

              <section aria-labelledby="check-heading" className={`${CARD} px-6 pb-5 pt-5`}>
                <h2 id="check-heading" className="m-0 mb-2.5 text-base font-extrabold text-ink">Check before importing</h2>
                <ul className="m-0 list-none p-0 text-[13.5px] leading-normal text-slate-700">
                  {checkRows
                    .filter(([, n, always]) => always || n > 0)
                    .map(([label, n], i) => (
                      <li key={label} className={`flex justify-between gap-3 py-1.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                        <span>{label}</span>
                        <b className="tabular-nums text-ink">{n}</b>
                      </li>
                    ))}
                </ul>
                {analysis && nameList.length > 0 && (
                  <div className={`mt-3 rounded-[10px] border px-3.5 py-3 ${analysis.counts.unmatched > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className={`text-[13px] font-extrabold ${analysis.counts.unmatched > 0 ? 'text-amber-900' : 'text-slate-700'}`}>
                      {analysis.counts.unmatched > 0
                        ? `${analysis.counts.unmatched} ${analysis.counts.unmatched === 1 ? 'row has' : 'rows have'} a name we do not know`
                        : 'Names you matched by hand'}
                    </div>
                    {nameList.slice(0, 20).map(name => (
                      <div key={name} className="mt-2 flex items-center gap-2.5 text-[13px] text-slate-700">
                        <span className="min-w-[74px] max-w-[40%] truncate font-bold">“{name}”</span>
                        <select
                          aria-label={`Match ${name} to`}
                          value={nameMap[name] ?? ''}
                          onChange={e => setNameMap(m => ({ ...m, [name]: e.target.value }))}
                          className="h-10 min-w-0 flex-1 rounded-[10px] border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-ink"
                        >
                          <option value="">Choose an employee…</option>
                          <option value="skip">Skip these rows</option>
                          {people.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.status !== 'active' ? ' (left)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    {nameList.length > 20 && <div className="mt-2 text-xs text-amber-900">…and {nameList.length - 20} more names. Rows with a name left unmatched are skipped.</div>}
                  </div>
                )}
              </section>
            </div>
          </div>

          {error && (
            <p role="alert" className="m-0 text-sm font-semibold text-critical-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={reset} disabled={busy} className="min-h-[44px] rounded-[10px] border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Back
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={busy || !companyId || missing.length > 0 || (c?.import ?? 0) === 0}
              className="min-h-[44px] rounded-[10px] bg-teal-700 px-6 text-sm font-extrabold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busy ? 'Importing…' : `Import ${c?.import ?? 0} ${c?.import === 1 ? 'row' : 'rows'}`}
            </button>
          </div>
        </>
      )}

      <section aria-labelledby="past-heading" className={`${CARD} overflow-hidden pt-5`}>
        <h2 id="past-heading" className="m-0 mb-3 px-6 text-[17px] font-extrabold text-ink">
          Earlier imports
        </h2>
        {pastError && (
          <p role="alert" className="m-0 px-6 pb-3 text-sm font-semibold text-critical-text">
            {pastError}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50">
                {['File', 'Services from', 'New rows', 'Imported'].map((h, i) => (
                  <th key={h} scope="col" className={`py-[11px] text-xs font-extrabold uppercase tracking-wider text-slate-600 ${i === 0 ? 'px-6' : 'px-3'}`}>
                    {h}
                  </th>
                ))}
                <th scope="col" aria-label="Actions" className="px-6 py-[11px]" />
              </tr>
            </thead>
            <tbody>
              {past === null ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-600">Loading…</td>
                </tr>
              ) : past.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-600">Nothing has been imported yet.</td>
                </tr>
              ) : (
                past.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-6 py-[13px] text-[13.5px] font-bold text-ink">{p.file_name}</td>
                    <td className="px-3 py-[13px] text-[13px] text-slate-700">
                      {p.first_date && p.last_date ? (p.first_date === p.last_date ? dayText(p.first_date) : `${dayText(p.first_date)} to ${dayText(p.last_date)}`) : '–'}
                    </td>
                    <td className="px-3 py-[13px] text-[13px] tabular-nums text-slate-700">
                      {p.rows_imported} of {p.rows_read}
                    </td>
                    <td className="px-3 py-[13px] text-[13px] text-slate-700">{dayText(p.created_at.slice(0, 10))}</td>
                    <td className="px-6 py-[13px] text-right">
                      <button type="button" onClick={() => removeImport(p)} aria-label={`Remove the import of ${p.file_name}`} className="inline-flex min-h-[40px] items-center px-2 text-[12.5px] font-bold text-critical-text hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
