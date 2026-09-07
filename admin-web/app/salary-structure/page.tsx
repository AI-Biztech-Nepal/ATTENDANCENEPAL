'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { computeSalaryFigures } from '@/components/SalaryBreakdown';
import {
  buildPeriodOptions,
  currentSystemYearMonth,
  formatDdMmYyyy,
  systemPeriod,
  type CalendarPeriod,
} from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  DEFAULT_PAYROLL_REPORT_COLUMNS,
  fetchMyCompanyWeekOffConfig,
  type PayrollReportColumns,
} from '@/lib/weekOff';
import type { Employee } from '@/lib/types';

/** The one place a company's salary structure is set: the three contribution
 * rates (companies.pf_rate/ssf_rate/tds_rate — one company-wide percentage of
 * Basic each), plus per-employee Basic and Allowance, editable inline in the
 * table. The monthly Payroll report only reads these figures.
 *
 * The period dropdown (shared with the Payroll page) picks which month the
 * figures are for — it only matters for the per-day view, which divides each
 * monthly amount by that month's own day count. Each employee row links to
 * its own detail page (/salary-structure/[employeeId]) — same pattern as the
 * Payroll report — carrying the period and view along. */
export default function SalaryStructurePage() {
  const { system } = useCalendarSystem();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Saved rates (what's in the DB) vs the draft strings the header inputs
  // edit. The table previews with the draft so editing recalculates live;
  // "Save rates" persists and clears the dirty state.
  const [savedRates, setSavedRates] = useState({ pf: 10, ssf: 11, tds: 0, overtime: 0 });
  const [pfDraft, setPfDraft] = useState('10');
  const [ssfDraft, setSsfDraft] = useState('11');
  const [tdsDraft, setTdsDraft] = useState('0');
  const [overtimeDraft, setOvertimeDraft] = useState('0');
  const [saving, setSaving] = useState(false);

  // Inline per-employee Basic / Allowance editing — one cell at a time, same
  // edit-in-place pattern the Payroll page uses for salary.
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'salary' | 'allowance' } | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  const [savingCell, setSavingCell] = useState(false);

  // Monthly (default) vs per-day view. Per-day divides each monthly figure
  // by the number of days in the selected period's calendar month.
  const [viewMode, setViewMode] = useState<'monthly' | 'perDay'>('monthly');

  // Which optional columns the monthly Payroll report shows
  // (companies.payroll_report_columns). Set here — the cog menu in the table
  // header — and only read by the Payroll report. Each toggle persists
  // immediately (optimistic), company-wide, admin-only.
  const [reportCols, setReportCols] = useState<PayrollReportColumns>(DEFAULT_PAYROLL_REPORT_COLUMNS);
  const [savingReportCols, setSavingReportCols] = useState(false);
  const [reportColsOpen, setReportColsOpen] = useState(false);
  const reportColsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reportColsOpen) return;
    function onDown(e: MouseEvent) {
      if (reportColsRef.current?.contains(e.target as Node)) return;
      setReportColsOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [reportColsOpen]);

  // Same period model the Payroll page uses — a real calendar month in the
  // active AD/BS system. Resets to "this month" when the AD/BS switch flips.
  const [period, setPeriod] = useState<CalendarPeriod>(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  });

  useEffect(() => {
    const { year, month } = currentSystemYearMonth(system);
    setPeriod(systemPeriod(system, year, month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  const periodOptions = useMemo(() => buildPeriodOptions(system, null, period), [system, period]);
  const { start, end } = period;

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      setIsAdmin(profile?.role === 'admin');
    });

    fetchMyCompanyWeekOffConfig().then(({ companyId, pfRate, ssfRate, tdsRate, overtimeRate, payrollReportColumns }) => {
      setCompanyId(companyId);
      setSavedRates({ pf: pfRate, ssf: ssfRate, tds: tdsRate, overtime: overtimeRate });
      setPfDraft(String(pfRate));
      setSsfDraft(String(ssfRate));
      setTdsDraft(String(tdsRate));
      setOvertimeDraft(String(overtimeRate));
      setReportCols(payrollReportColumns);
    });

    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) => {
        // By enroll ID (matches the Employees directory and Payroll report);
        // employees without one sort to the end.
        setEmployees(
          (data ?? []).sort((a, b) => {
            if (!a.fingerprint_id) return b.fingerprint_id ? 1 : 0;
            if (!b.fingerprint_id) return -1;
            return a.fingerprint_id.localeCompare(b.fingerprint_id, undefined, { numeric: true, sensitivity: 'base' });
          })
        );
        setLoading(false);
      });
  }, []);

  const pf = Number(pfDraft) || 0;
  const ssf = Number(ssfDraft) || 0;
  const tds = Number(tdsDraft) || 0;
  const overtime = Number(overtimeDraft) || 0;

  const dirty =
    pfDraft !== String(savedRates.pf) ||
    ssfDraft !== String(savedRates.ssf) ||
    tdsDraft !== String(savedRates.tds) ||
    overtimeDraft !== String(savedRates.overtime);

  const daysInMonth = useMemo(() => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1, [start, end]);

  const perDay = viewMode === 'perDay';
  const factor = perDay ? 1 / daysInMonth : 1;

  /** Monthly figure -> the number shown, scaled to the active view. */
  function shown(n: number | null | undefined): string {
    if (n == null) return '—';
    return (n * factor).toLocaleString(undefined, { maximumFractionDigits: perDay ? 2 : 0 });
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees
      .filter(e =>
        !term
          ? true
          : [e.name, e.designation, e.employee_code].filter(Boolean).some(v => (v as string).toLowerCase().includes(term))
      )
      .map(e => ({ e, ...computeSalaryFigures(e.salary, e.allowance, pf, ssf, tds, overtime) }));
  }, [employees, search, pf, ssf, tds, overtime]);

  const totals = useMemo(() => {
    let basic = 0,
      allowance = 0,
      gross = 0,
      pfAmt = 0,
      ssfAmt = 0,
      tdsAmt = 0,
      overtimeAmt = 0,
      net = 0,
      counted = 0;
    for (const r of rows) {
      if (r.basic == null) continue;
      counted++;
      basic += r.basic;
      allowance += r.allowance;
      gross += r.gross!;
      pfAmt += r.pfAmt!;
      ssfAmt += r.ssfAmt!;
      tdsAmt += r.tdsAmt!;
      overtimeAmt += r.overtimeAmt!;
      net += r.net!;
    }
    return { basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, overtimeAmt, net, counted, deductions: pfAmt + ssfAmt + tdsAmt };
  }, [rows]);

  async function saveRates() {
    if (!companyId) return;
    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({ pf_rate: pf, ssf_rate: ssf, tds_rate: tds, overtime_rate: overtime })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      alert(`Could not save the rates: ${error.message}`);
      return;
    }
    setSavedRates({ pf, ssf, tds, overtime });
  }

  // Each column toggle saves on its own, right away — no dirty state. The
  // whole map is written every time (jsonb column), so a half-written value
  // can't happen. Reverts the optimistic flip if the write fails.
  async function toggleReportCol(key: keyof PayrollReportColumns) {
    if (!companyId || savingReportCols) return;
    const next = { ...reportCols, [key]: !reportCols[key] };
    setReportCols(next);
    setSavingReportCols(true);
    const { error } = await supabase.from('companies').update({ payroll_report_columns: next }).eq('id', companyId);
    setSavingReportCols(false);
    if (error) {
      setReportCols(reportCols);
      alert(`Could not save: ${error.message}`);
    }
  }

  function cancelRates() {
    setPfDraft(String(savedRates.pf));
    setSsfDraft(String(savedRates.ssf));
    setTdsDraft(String(savedRates.tds));
    setOvertimeDraft(String(savedRates.overtime));
  }

  function startEditCell(id: string, field: 'salary' | 'allowance', current: number | null) {
    setEditingCell({ id, field });
    setCellDraft(current != null ? String(current) : '');
  }

  function cancelEditCell() {
    setEditingCell(null);
    setCellDraft('');
  }

  async function saveCell() {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const trimmed = cellDraft.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value != null && (Number.isNaN(value) || value < 0)) {
      alert('Enter a valid amount (0 or more), or clear it to unset.');
      return;
    }
    setSavingCell(true);
    const { error } = await supabase.from('employees').update({ [field]: value }).eq('id', id);
    setSavingCell(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setEmployees(prev => prev.map(e => (e.id === id ? { ...e, [field]: value } : e)));
    cancelEditCell();
  }

  // Plain function returning a <td>, not a nested component — see rateHeader.
  // In per-day view the figure is read-only (you edit the monthly amount in
  // the monthly view) so the value shown is always scaled by `shown()`.
  const amountCell = (id: string, field: 'salary' | 'allowance', value: number | null) => {
    if (!perDay && editingCell?.id === id && editingCell.field === field) {
      return (
        <td className="whitespace-nowrap px-3 py-2 text-right align-top">
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={cellDraft}
            onChange={e => setCellDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveCell();
              if (e.key === 'Escape') cancelEditCell();
            }}
            className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right text-xs tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button onClick={cancelEditCell} disabled={savingCell} className="text-[11px] font-medium text-slate-500 hover:underline disabled:opacity-60">
              Cancel
            </button>
            <button onClick={saveCell} disabled={savingCell} className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-60">
              {savingCell ? 'Saving…' : 'Save'}
            </button>
          </div>
        </td>
      );
    }
    return (
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className={value == null ? 'text-slate-300' : undefined}>{shown(value)}</span>
          {!perDay && (
            <button
              onClick={() => startEditCell(id, field, value)}
              title={field === 'salary' ? 'Edit basic salary' : 'Edit allowance'}
              className="text-slate-300 hover:text-accent print:hidden"
            >
              <EditIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </td>
    );
  };

  function exportCsv() {
    const suffix = perDay ? ' /day' : '';
    const header = [
      'ID',
      'Employee',
      `Basic${suffix}`,
      `Allowance${suffix}`,
      `Gross${suffix}`,
      `PF (${pf}%)${suffix}`,
      `SSF by Employer (${ssf}%)${suffix}`,
      `SSF by Employee (${tds}%)${suffix}`,
      `Overtime (${overtime}%)${suffix}`,
      `Net Payable${suffix}`,
    ];
    const cell = (n: number | null) => (n == null ? '' : Number((n * factor).toFixed(perDay ? 2 : 0)));
    const lines = rows.map(r => [
      r.e.fingerprint_id || '',
      r.e.name,
      cell(r.basic),
      r.allowance ? cell(r.allowance) : '',
      cell(r.gross),
      cell(r.pfAmt),
      cell(r.ssfAmt),
      cell(r.tdsAmt),
      cell(r.overtimeAmt),
      cell(r.net),
    ]);
    downloadExcel(`salary_structure_${start}_to_${end}${perDay ? '_per_day' : ''}.csv`, header, lines);
  }

  // Plain function returning JSX, not a nested component — a `<RateHeader/>`
  // component type would get a fresh identity each render and remount its
  // input, dropping focus mid-type.
  const rateHeader = (label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col items-end gap-1">
      <span>{label}</span>
      <span className="flex items-center gap-1 normal-case tracking-normal print:hidden">
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          disabled={!isAdmin}
          onChange={e => onChange(e.target.value)}
          className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-right text-xs font-bold text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <span className="text-[10px] font-medium text-slate-400">% of basic</span>
      </span>
      <span className="hidden text-[10px] font-medium normal-case tracking-normal text-slate-400 print:block">{value}% of basic</span>
    </div>
  );

  // 'deductions' is deliberately omitted — that group is always shown on both
  // the Payroll report and the Salary Structure table.
  const REPORT_COLUMN_OPTIONS: [keyof PayrollReportColumns, string][] = [
    ['workedDays', 'Worked Days'],
    ['totalHours', 'Total Hours'],
    ['overtime', 'Overtime'],
    ['lateEarly', 'Late / Early Days'],
  ];

  // The cog menu that used to live in the Payroll report header — it now
  // sets a company-wide choice here, and the Payroll report simply reads it.
  // Admin-only, same as the contribution rates above it.
  const reportColumnsSettings = isAdmin ? (
    <div className="relative print:hidden" ref={reportColsRef}>
      <button
        type="button"
        onClick={() => setReportColsOpen(v => !v)}
        title="Payroll report columns"
        className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
      >
        <CogIcon className="h-[18px] w-[18px]" />
      </button>
      {reportColsOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent px-4 py-3">
            <CogIcon className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-ink">Payroll Report Columns</span>
          </div>
          <p className="px-4 pb-1 pt-2 text-[11px] leading-snug text-slate-400">
            Show or hide these columns in the monthly Payroll report and its printed / PDF copy — a company-wide
            choice. Hiding Overtime also drops overtime pay from that report&apos;s totals.
          </p>
          <div className="p-1.5">
            {REPORT_COLUMN_OPTIONS.map(([key, label]) => {
              const on = reportCols[key];
              return (
                <button
                  key={key}
                  type="button"
                  disabled={savingReportCols}
                  onClick={() => toggleReportCol(key)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-sm text-ink hover:bg-slate-50 disabled:opacity-60"
                >
                  {label}
                  <span className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-good' : 'bg-slate-300'}`}>
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        on ? 'translate-x-[18px]' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  ) : null;

  const detailQuery = `?start=${start}&end=${end}&view=${viewMode}`;
  const modeLine = perDay
    ? `Per-day amounts — one day of ${period.label} (${daysInMonth} days)`
    : `Full monthly amounts · ${period.label}`;

  return (
    <AppShell title="Salary Structure">
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
        <div className="rounded-xl bg-info-bg p-3 shadow-sm ring-1 ring-inset ring-info/10">
          <span className="text-xs font-medium text-info-text/80">Total Gross Payroll{perDay && ' / day'}</span>
          <div className="mt-1 text-base font-bold text-info-text">{shown(totals.gross)}</div>
          <div className="mt-0.5 text-[11px] text-info-text/70">Basic {shown(totals.basic)} · Allowance {shown(totals.allowance)}</div>
        </div>
        <div className="rounded-xl bg-critical-bg p-3 shadow-sm ring-1 ring-inset ring-critical/10">
          <span className="text-xs font-medium text-critical-text/80">Total Deductions{perDay && ' / day'}</span>
          <div className="mt-1 text-base font-bold text-critical-text">{shown(totals.deductions)}</div>
          <div className="mt-0.5 text-[11px] text-critical-text/70">
            PF {shown(totals.pfAmt)} · SSF by Employer {shown(totals.ssfAmt)} · SSF by Employee {shown(totals.tdsAmt)}
          </div>
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Total Net Payable{perDay && ' / day'}</span>
          <div className="mt-1 text-base font-bold text-good-text">{shown(totals.net)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">Across {totals.counted} staff on a salary</div>
        </div>
      </div>

      {dirty && isAdmin && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 print:hidden">
          <span className="text-sm font-medium text-ink">Unsaved contribution-rate changes</span>
          <div className="flex gap-2">
            <button
              onClick={cancelRates}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={saveRates}
              disabled={saving}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save rates'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-4 sm:px-6 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <StructureIcon className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-bold text-ink">Monthly Salary Structure</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold shadow-sm">
              <button
                onClick={() => setViewMode('monthly')}
                className={`px-3 py-2 ${viewMode === 'monthly' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setViewMode('perDay')}
                className={`px-3 py-2 ${viewMode === 'perDay' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Per day
              </button>
            </div>
            <select
              value={period.key}
              onChange={e => {
                const found = periodOptions.find(o => o.key === e.target.value);
                if (found) setPeriod(found);
              }}
              className="rounded-lg border border-accent/30 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm"
            >
              {periodOptions.map(o => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
              <span className="text-slate-400">({daysInMonth}d)</span>
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-48 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <TableExportBar onExportCsv={exportCsv} leading={reportColumnsSettings} />
          </div>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500 sm:px-6 print:hidden">
          {modeLine} · click an employee for their full breakdown
          {!isAdmin && <> · the PF / SSF by Employer / SSF by Employee / Overtime rates are read-only for your role — an admin sets them here.</>}
        </div>

        <div className="hidden px-4 pt-4 sm:px-6 print:block">
          <h1 className="text-lg font-bold text-ink">Monthly Salary Structure — {period.label}</h1>
          <p className="text-xs text-slate-500">
            {modeLine} · PF {pf}% · SSF by Employer {ssf}% · SSF by Employee {tds}% · Overtime {overtime}% of Basic
          </p>
        </div>

        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="max-h-[65vh] overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-y border-slate-200 bg-slate-50 align-bottom text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-20 w-16 whitespace-nowrap bg-slate-50 px-3 py-2 font-medium">ID</th>
                <th className="sticky left-16 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 font-medium shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none">
                  Employee
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Basic</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Allowance</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Gross</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('PF', pfDraft, setPfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('SSF by Employer', ssfDraft, setSsfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('SSF by Employee', tdsDraft, setTdsDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-good-text">
                  {rateHeader('Overtime', overtimeDraft, setOvertimeDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Net Payable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, overtimeAmt, net }) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="sticky left-0 z-[1] whitespace-nowrap bg-white px-3 py-2 tabular-nums text-slate-500">{e.fingerprint_id || '—'}</td>
                  <td className="sticky left-16 z-[1] whitespace-nowrap bg-white px-3 py-2 font-medium text-ink shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none">
                    <Link href={`/salary-structure/${e.id}${detailQuery}`} className="flex items-center gap-2.5 hover:text-accent hover:underline">
                      <Avatar name={e.name} photoUrl={e.profile_photo_url} />
                      <span>{e.name}</span>
                    </Link>
                  </td>
                  {amountCell(e.id, 'salary', basic)}
                  {amountCell(e.id, 'allowance', allowance)}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink">{shown(gross)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(pfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(ssfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(tdsAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-good-text">{shown(overtimeAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-good-text">{shown(net)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    {loading ? 'Loading…' : 'No active employees.'}
                  </td>
                </tr>
              )}
            </tbody>
            {totals.counted > 0 && (
              <tfoot>
                <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-sm font-bold text-ink">
                  <td
                    colSpan={2}
                    className="sticky left-0 z-[1] whitespace-nowrap bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none"
                  >
                    Total{perDay && ' / day'} · {totals.counted} staff
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.basic)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.allowance)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.gross)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.pfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.ssfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.tdsAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-good-text">{shown(totals.overtimeAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-good-text">{shown(totals.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Net Payable = Basic + Allowance − PF − SSF by Employer − SSF by Employee + Overtime. Click a Basic or Allowance figure
        to edit it for that employee, or click a name to open that employee&apos;s full salary breakdown. PF / SSF by
        Employer / SSF by Employee /
        Overtime are all company-wide rates. Per-day figures divide the monthly amount by the number of days in {period.label}. The monthly
        Payroll report reads these figures and is not edited there. The Overtime line is a flat allowance (% of Basic), not
        the real attendance-based overtime pay the Payroll report calculates from actual hours worked.
        {isAdmin && ' The cog above the table picks which optional columns the Payroll report shows.'}
      </p>
    </AppShell>
  );
}

function StructureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18M9 9v11" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
