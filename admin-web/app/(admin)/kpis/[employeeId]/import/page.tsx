'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isKpiOn } from '@/lib/kpiSettings';
import { publishKpiSettings, useKpiSettings } from '@/lib/useKpiSettings';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatAdDate } from '@/lib/calendar';
import { nepalTodayIso } from '@/lib/shift';
import {
  CHUNK_SIZE,
  ROLE_LABEL,
  SKIP_NOTE,
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
import Sheet, { type RowTone, type SheetColumn } from '@/components/kpi/Sheet';
import ImportSheetDialog, { type PastImport } from '@/components/kpi/ImportSheetDialog';

const MAX_BYTES = 10 * 1024 * 1024;
const ROLES: ColumnRole[] = ['employee', 'date', 'service', 'minutes', 'customer', 'status', 'ignore'];
const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const ROLE_SELECT = 'h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const OPTION_SELECT = 'h-10 rounded-[10px] border border-slate-300 bg-white px-2.5 text-sm font-semibold text-ink';

// Service import (for the whole company: the same on every person's page): the booking system's file (a CSV) is read here in the browser and
// shown as a sheet, like Excel. The admin says what each column is (in the box at the top of the column), names the file does not match to an
// employee are matched by hand, and the rows are saved. Customer names, phone numbers and IDs are never kept: only a scrambled code, enough to
// tell that two services were for the same customer. Rows that were already imported (an export that overlaps an earlier one) are left out, and
// a whole import can be removed. An earlier import opens as a sheet in a pop-up.
export default function ImportPage() {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  // Which KPIs this company uses, what it calls them and its people (KPIs > Settings).
  const { settings, words } = useKpiSettings();
  const today = useMemo(nepalTodayIso, []);
  const fileInput = useRef<HTMLInputElement>(null);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [people, setPeople] = useState<(EmployeeRef & { status: string })[]>([]);
  const [past, setPast] = useState<PastImport[] | null>(null);
  const [pastError, setPastError] = useState('');
  const [opened, setOpened] = useState<PastImport | null>(null);

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

  /** Asks first, then removes an earlier import and every service it added. */
  async function removeImport(p: PastImport): Promise<{ removed: boolean; error: string }> {
    const ok = await confirm(
      `Remove the import of ${p.file_name}? The ${p.rows_imported === 1 ? 'service' : `${p.rows_imported} services`} it added will no longer count. The file itself is not touched. This cannot be undone.`,
      { title: 'Remove import', confirmLabel: 'Remove import', tone: 'danger' }
    );
    if (!ok) return { removed: false, error: '' };
    const res = await supabase.from('service_imports').delete().eq('id', p.id).select('id');
    let result: { removed: boolean; error: string };
    if (res.error || !((res.data as unknown[] | null) ?? []).length) {
      result = { removed: false, error: `Could not remove it: ${res.error?.message ?? 'it was not found'}` };
      setPastError(result.error);
    } else {
      result = { removed: true, error: '' };
      setPastError('');
      setDone('');
    }
    loadPast();
    return result;
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
  const dayText = useCallback((d: string) => formatAdDate(d, system), [system]);
  const heading = useCallback((role: ColumnRole) => words.t(ROLE_LABEL[role]), [words]);
  const closeSheet = useCallback(() => setOpened(null), []);

  // How wide each column of the sheet is: its longest text in the first rows, but wide enough for the "Use it for" box above it.
  const widths = useMemo(
    () =>
      file
        ? file.table.headers.map((h, i) => {
            let longest = h.length;
            for (let r = 0; r < Math.min(file.table.rows.length, 200); r++) longest = Math.max(longest, file.table.rows[r][i].length);
            return Math.min(300, Math.max(184, longest * 8 + 28));
          })
        : [],
    [file]
  );
  const sheetColumns: SheetColumn[] = file
    ? file.table.headers.map((h, i) => ({
        header: h,
        width: widths[i],
        muted: (roles[i] ?? 'ignore') === 'ignore',
        top: (
          <select aria-label={`Use ${h} for`} value={roles[i] ?? 'ignore'} onChange={e => changeRole(i, e.target.value as ColumnRole)} className={ROLE_SELECT}>
            {ROLES.map(r => (
              <option key={r} value={r}>
                {heading(r)}
              </option>
            ))}
          </select>
        ),
      }))
    : [];
  const rowTone = (i: number): RowTone => {
    const why = analysis?.rowStatus[i];
    return why ? (why === 'unmatched' ? 'alert' : 'skip') : null;
  };
  const rowNote = (i: number) => {
    const why = analysis?.rowStatus[i];
    return why ? SKIP_NOTE[why] : analysis && analysis.rowStatus.length > 0 ? 'Will be imported.' : undefined;
  };

  const checkRows: [string, number, boolean, RowTone][] = c
    ? [
        ['Rows read', c.read, true, null],
        ['Will be imported', c.import, true, null],
        ['Skipped, status not counted', c.notCounted, false, 'skip'],
        ['Skipped, no employee named', c.noName, false, 'skip'],
        ['Need a name matched', c.unmatched, false, 'alert'],
        ['Left out by your choice', c.skippedByChoice, false, 'skip'],
        ['Skipped, date not understood', c.badDate, false, 'skip'],
        ['Skipped, time not understood', c.badTime, false, 'skip'],
        ['Skipped, dated in the future', c.future, false, 'skip'],
      ]
    : [];
  const alertsShown = missing.length > 0 || personalWarning || !!error;

  return (
    <div className="flex flex-col gap-5">
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
          <section aria-labelledby="sheet-heading" className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" className="shrink-0 text-teal-700" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
                  <path d="M3.5 9.5h17M3.5 15h17M9.5 3.5v17" />
                </svg>
                <h2 id="sheet-heading" className="m-0 min-w-0 truncate text-[15px] font-extrabold text-ink">
                  {file.name}
                </h2>
                <span className="shrink-0 text-[13px] font-semibold text-slate-600">{file.table.rows.length} rows</span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
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
            </div>

            {(roles.includes('minutes') || slashDates || statusValues.length > 0 || isKpiOn('rebooking', settings)) && (
              <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
                {roles.includes('minutes') && (
                  <div className="flex items-center gap-2.5">
                    <label htmlFor="import-unit" className="font-bold">
                      {words.t('The time with the customer is in')}
                    </label>
                    <select id="import-unit" value={unit} onChange={e => setUnit(e.target.value as 'minutes' | 'hours')} className={OPTION_SELECT}>
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                    </select>
                  </div>
                )}
                {slashDates && (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <label htmlFor="import-date-order" className="font-bold">
                      Dates are written
                    </label>
                    <select id="import-date-order" value={dateOrder} onChange={e => setDateOrder(e.target.value as DateOrder)} className={OPTION_SELECT}>
                      <option value="dmy">day / month / year</option>
                      <option value="mdy">month / day / year</option>
                    </select>
                    {dateInfo?.ambiguous && <span className="text-xs font-semibold text-amber-800">Check this: your dates could be read either way.</span>}
                  </div>
                )}
                {isKpiOn('rebooking', settings) && (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <label htmlFor="rb-days" className="font-bold">
                      Counts as back if they return within
                    </label>
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
                      className="h-10 w-[72px] rounded-[10px] border border-slate-300 bg-white px-2.5 text-sm font-bold text-ink"
                    />
                    <span>days</span>
                    {windowNote && (
                      <span role={windowNote === 'Saved.' ? 'status' : 'alert'} className={`text-xs font-semibold ${windowNote === 'Saved.' ? 'text-emerald-800' : 'text-critical-text'}`}>
                        {windowNote}
                      </span>
                    )}
                  </div>
                )}
                {statusValues.length > 0 && (
                  <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 border-0 p-0">
                    <legend className="sr-only">Count these statuses as a service performed</legend>
                    <span aria-hidden="true" className="font-bold">
                      Count as a service
                    </span>
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
                  </fieldset>
                )}
              </div>
            )}

            {alertsShown && (
              <div className="flex flex-col gap-1.5 border-b border-slate-200 px-4 py-3">
                {missing.length > 0 && (
                  <p role="alert" className="m-0 text-sm font-semibold text-critical-text">
                    Choose which column is the {missing.map(m => ROLE_LABEL[m].toLowerCase()).join(' and the ')}.
                  </p>
                )}
                {personalWarning && (
                  <p role="alert" className="m-0 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] font-semibold leading-normal text-amber-900">
                    {words.t('The column used for the customer code looks like names, phone numbers or email addresses. Choose a customer ID column instead, or set it to "Do not import". Codes are scrambled before they are saved, but it is better not to send them at all.')}
                  </p>
                )}
                {error && (
                  <p role="alert" className="m-0 text-sm font-semibold text-critical-text">
                    {error}
                  </p>
                )}
              </div>
            )}

            <Sheet key={file.name} label={`The rows of ${file.name}`} columns={sheetColumns} rows={file.table.rows} tone={rowTone} note={rowNote} />

            <ul aria-label="Import check" className="m-0 flex list-none flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-300 bg-slate-100 px-4 py-2 text-[12.5px] text-slate-700">
              {checkRows
                .filter(([, n, always]) => always || n > 0)
                .map(([label, n, always, tone]) => (
                  <li key={label} className="flex items-center gap-1.5">
                    {!always && <span aria-hidden="true" className={`h-3 w-3 rounded-[3px] border ${tone === 'alert' ? 'border-rose-300 bg-rose-100' : 'border-amber-300 bg-amber-100'}`} />}
                    <span>{label}</span> <b className="tabular-nums text-ink">{n}</b>
                  </li>
                ))}
            </ul>
          </section>

          {analysis && nameList.length > 0 && (
            <section aria-labelledby="names-heading" className={`rounded-xl border px-5 py-4 ${analysis.counts.unmatched > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
              <h2 id="names-heading" className={`m-0 text-[14px] font-extrabold ${analysis.counts.unmatched > 0 ? 'text-amber-900' : 'text-slate-700'}`}>
                {analysis.counts.unmatched > 0
                  ? `${analysis.counts.unmatched} ${analysis.counts.unmatched === 1 ? 'row has' : 'rows have'} a name we do not know`
                  : 'Names you matched by hand'}
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 md:grid-cols-2 xl:grid-cols-3">
                {nameList.slice(0, 20).map(name => (
                  <div key={name} className="flex items-center gap-2.5 text-[13px] text-slate-700">
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
              </div>
              {nameList.length > 20 && <div className="mt-2 text-xs text-amber-900">…and {nameList.length - 20} more names. Rows with a name left unmatched are skipped.</div>}
            </section>
          )}
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
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-600">
                    Loading…
                  </td>
                </tr>
              ) : past.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-600">
                    Nothing has been imported yet.
                  </td>
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
                    <td className="whitespace-nowrap px-6 py-[13px] text-right">
                      <button type="button" onClick={() => setOpened(p)} aria-label={`Open the import of ${p.file_name}`} className="inline-flex min-h-[40px] items-center px-2 text-[12.5px] font-bold text-accent hover:underline">
                        Open
                      </button>
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

      {opened && (
        <ImportSheetDialog
          key={opened.id}
          item={opened}
          people={people}
          dayText={dayText}
          heading={heading}
          onClose={closeSheet}
          onRemove={async () => {
            const r = await removeImport(opened);
            if (r.removed) setOpened(null);
            return r;
          }}
        />
      )}
    </div>
  );
}
