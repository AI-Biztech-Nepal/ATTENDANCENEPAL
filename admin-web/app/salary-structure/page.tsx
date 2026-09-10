'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import PayrollColumnsMenu from '@/components/PayrollColumnsMenu';
import { computeSalaryFigures } from '@/components/SalaryBreakdown';
import {
  buildPeriodOptions,
  currentSystemYearMonth,
  formatDdMmYyyy,
  systemPeriod,
  type CalendarPeriod,
} from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { fetchMyCompanyWeekOffConfig } from '@/lib/weekOff';
import {
  DEFAULT_PAYROLL_REPORT_COLUMNS,
  loadPayrollReportColumns,
  savePayrollReportColumns,
  type PayrollReportColumns,
} from '@/lib/payrollReportColumns';
import type { Branch, Employee } from '@/lib/types';

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
  const [branches, setBranches] = useState<Branch[]>([]);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Oldest/newest punch on record — bounds the month picker to periods that
  // actually have attendance, same as the Payroll report, so it stops
  // offering months from before this company had any data (the figures are
  // the fixed salary structure, identical every month, which made picking a
  // pre-data month look like the app was inventing numbers for it).
  const [dataRange, setDataRange] = useState<{ earliest: Date; latest: Date } | null>(null);

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

  // Which optional columns the monthly Payroll report shows. Set here — the
  // cog above this table — and read by the Payroll report. Persisted in
  // localStorage (lib/payrollReportColumns), so it takes effect immediately
  // and needs no migration; loaded in an effect so SSR and first render agree.
  const [reportCols, setReportCols] = useState<PayrollReportColumns>(DEFAULT_PAYROLL_REPORT_COLUMNS);

  useEffect(() => {
    setReportCols(loadPayrollReportColumns());
  }, []);

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

  const periodOptions = useMemo(() => buildPeriodOptions(system, dataRange, period), [system, dataRange, period]);
  const { start, end } = period;

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      setIsAdmin(profile?.role === 'admin');
    });

    fetchMyCompanyWeekOffConfig().then(({ companyId, pfRate, ssfRate, tdsRate, overtimeRate }) => {
      setCompanyId(companyId);
      setSavedRates({ pf: pfRate, ssf: ssfRate, tds: tdsRate, overtime: overtimeRate });
      setPfDraft(String(pfRate));
      setSsfDraft(String(ssfRate));
      setTdsDraft(String(tdsRate));
      setOvertimeDraft(String(overtimeRate));
    });

    supabase.from('branches').select('*').then(({ data }) => setBranches(data ?? []));

    Promise.all([
      supabase.from('attendance_logs').select('punch_time').order('punch_time', { ascending: true }).limit(1),
      supabase.from('attendance_logs').select('punch_time').order('punch_time', { ascending: false }).limit(1),
    ]).then(([earliestRes, latestRes]) => {
      const earliest = earliestRes.data?.[0]?.punch_time;
      const latest = latestRes.data?.[0]?.punch_time;
      if (earliest && latest) setDataRange({ earliest: new Date(earliest), latest: new Date(latest) });
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

  // The Payroll report's column cog governs this table's Overtime column too
  // — it's the same flat "% of Basic" allowance both places. Off ⇒ the column
  // is hidden here AND left out of Net Payable, matching the report's
  // "not shown means not counted" rule for overtime.
  const showOvertime = reportCols.overtime;
  // PF / SSF hiding is display-only — Net Payable still deducts them, unlike
  // Overtime, whose switch also takes the allowance out of the maths.
  const showPf = reportCols.pf;
  const showSsfEmployer = reportCols.ssfEmployer;
  const showSsfEmployee = reportCols.ssfEmployee;
  const effectiveOvertime = showOvertime ? overtime : 0;
  const structureColCount =
    6 + (showPf ? 1 : 0) + (showSsfEmployer ? 1 : 0) + (showSsfEmployee ? 1 : 0) + (showOvertime ? 1 : 0);

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
      .map(e => ({ e, ...computeSalaryFigures(e.salary, e.allowance, pf, ssf, tds, effectiveOvertime) }));
  }, [employees, search, pf, ssf, tds, effectiveOvertime]);

  type StructureRow = (typeof rows)[number];

  const branchName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) m.set(b.id, b.name);
    return m;
  }, [branches]);

  // Group rows by branch — same as the Payroll report's Staff Salary Sheet.
  // Rows keep their enroll-ID order within each branch; the branch band only
  // shows when the company actually spans more than one branch (a single
  // "Unassigned" bucket would just repeat what the whole table already is).
  const groups = useMemo(() => {
    const byBranch = new Map<string, StructureRow[]>();
    for (const r of rows) {
      const b = r.e.branch_id ? branchName.get(r.e.branch_id) ?? 'Unassigned' : 'Unassigned';
      if (!byBranch.has(b)) byBranch.set(b, []);
      byBranch.get(b)!.push(r);
    }
    return [...byBranch.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([branch, list]) => ({ branch, list }));
  }, [rows, branchName]);

  const renderItems = useMemo(() => {
    const items: ({ kind: 'group'; branch: string } | { kind: 'row'; row: StructureRow })[] = [];
    const showGroupHeaders = groups.length > 1;
    for (const g of groups) {
      if (showGroupHeaders) items.push({ kind: 'group', branch: g.branch });
      for (const r of g.list) items.push({ kind: 'row', row: r });
    }
    return items;
  }, [groups]);

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
      .update({ pf_rate: pf, ssf_rate: ssf, tds_rate: tds })
      .eq('id', companyId);

    // `overtime_rate` is from a later migration (20260906120000) that may not
    // be applied yet — save it separately so a missing column can't block the
    // PF / SSF rates. If it fails, warn but keep the rest.
    const { error: overtimeError } = await supabase
      .from('companies')
      .update({ overtime_rate: overtime })
      .eq('id', companyId);

    setSaving(false);
    if (error) {
      alert(`Could not save the rates: ${error.message}`);
      return;
    }
    if (overtimeError) {
      alert(
        `PF and SSF rates were saved, but the Overtime rate could not be — the database is missing the overtime_rate column. Run migration 20260906120000_ssf_override_and_overtime_rate.sql.`
      );
    }
    setSavedRates({ pf, ssf, tds, overtime });
  }

  // Each switch takes effect at once — flip it, save the whole map to
  // localStorage. The Payroll report reads it on its next load, or live via
  // a `storage` event if it's already open in another tab.
  function toggleReportCol(key: keyof PayrollReportColumns) {
    setReportCols(prev => {
      const next = { ...prev, [key]: !prev[key] };
      savePayrollReportColumns(next);
      return next;
    });
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
        <td className="whitespace-nowrap px-2.5 py-1.5 text-right align-top">
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
      <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-slate-700">
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
      ...(showPf ? [`PF (${pf}%)${suffix}`] : []),
      ...(showSsfEmployer ? [`SSF by Employer (${ssf}%)${suffix}`] : []),
      ...(showSsfEmployee ? [`SSF by Employee (${tds}%)${suffix}`] : []),
      ...(showOvertime ? [`Overtime (${overtime}%)${suffix}`] : []),
      `Net Payable${suffix}`,
    ];
    const cell = (n: number | null) => (n == null ? '' : Number((n * factor).toFixed(perDay ? 2 : 0)));
    const lines = rows.map(r => [
      r.e.fingerprint_id || '',
      r.e.name,
      cell(r.basic),
      r.allowance ? cell(r.allowance) : '',
      cell(r.gross),
      ...(showPf ? [cell(r.pfAmt)] : []),
      ...(showSsfEmployer ? [cell(r.ssfAmt)] : []),
      ...(showSsfEmployee ? [cell(r.tdsAmt)] : []),
      ...(showOvertime ? [cell(r.overtimeAmt)] : []),
      cell(r.net),
    ]);
    downloadExcel(`salary_structure_${start}_to_${end}${perDay ? '_per_day' : ''}.csv`, header, lines);
  }

  // Plain function returning JSX, not a nested component — a `<RateHeader/>`
  // component type would get a fresh identity each render and remount its
  // input, dropping focus mid-type.
  const rateHeader = (label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col items-start gap-1">
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

  // Only this table's own columns. The Payroll report's attendance switches
  // used to sit here too, which meant a menu above this table was mostly
  // controlling a different page; they now live on that report's own cog.
  // Overtime stays here because it governs this table's Overtime column and
  // its Net Payable, not just what the report displays.
  const STRUCTURE_COLUMN_OPTIONS: [keyof PayrollReportColumns, string][] = [
    ['pf', 'PF'],
    ['ssfEmployer', 'SSF by Employer'],
    ['ssfEmployee', 'SSF by Employee'],
    ['overtime', 'Overtime'],
  ];

  // Admin-only, same as the contribution rates above it.
  const reportColumnsSettings = isAdmin ? (
    <PayrollColumnsMenu
      cols={reportCols}
      onToggle={toggleReportCol}
      options={STRUCTURE_COLUMN_OPTIONS}
      title="Salary Structure columns"
      description="Hides the column here and in the printed / Excel copy. Net Payable still deducts PF and SSF either way — hide them when a rate is 0 and the column is a row of zeroes. Overtime is the company-wide switch for overtime pay: turning it off drops the allowance from Net Payable and the Payroll report, and stops every employee's breakdown page counting attendance-based overtime."
    />
  ) : null;

  const detailQuery = `?start=${start}&end=${end}&view=${viewMode}`;
  const modeLine = perDay
    ? `Per-day amounts — one day of ${period.label} (${daysInMonth} days)`
    : `Full monthly amounts · ${period.label}`;

  return (
    <AppShell title="Salary Structure">
      {/* Period totals live in the table's own footer row — no summary band. */}

      {dirty && isAdmin && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 print:hidden">
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
        {/* Two lines: the title and the whole-sheet actions (settings, Print,
            Export) share the top line; the view controls sit below, search
            pushed right under those actions. */}
        <div className="border-b border-slate-200 px-4 py-4 sm:px-6 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Monthly Salary Structure</h2>
            <TableExportBar onExportCsv={exportCsv} leading={reportColumnsSettings} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold shadow-sm">
              <button
                onClick={() => setViewMode('monthly')}
                className={`px-3 py-2 ${viewMode === 'monthly' ? 'bg-ink text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setViewMode('perDay')}
                className={`px-3 py-2 ${viewMode === 'perDay' ? 'bg-ink text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
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
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-sm"
            >
              {periodOptions.map(o => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
              <span className="text-slate-400">({daysInMonth}d)</span>
            </div>
            <div className="relative sm:ml-auto">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-48 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500 sm:px-6 print:hidden">
          {modeLine} · the contracted structure, the same every month — a month&rsquo;s actual attendance-adjusted pay is on the Payroll report · click an employee for their breakdown
          {!isAdmin && <> · the PF / SSF by Employer / SSF by Employee / Overtime rates are read-only for your role — an admin sets them here.</>}
        </div>

        <div className="hidden px-4 pt-4 sm:px-6 print:block">
          <h1 className="text-lg font-bold text-ink">Monthly Salary Structure — {period.label}</h1>
          <p className="text-xs text-slate-500">
            {modeLine} · PF {pf}% · SSF by Employer {ssf}% · SSF by Employee {tds}%
            {showOvertime && ` · Overtime ${overtime}% of Basic`}
          </p>
        </div>

        {/* Every employee at once: the table used to sit in a 65vh box with
            its own vertical scrollbar, so a longer roster was read a screenful
            at a time inside the page rather than as one list. It now grows to
            its full height and the page scrolls. Horizontal scrolling stays on
            this container — the table is wider than the card and the floating
            ‹ › pill drives it. */}
        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-right text-[12.5px] tabular-nums">
            <thead>
              <tr className="sticky top-0 z-10 border-y border-slate-200 bg-slate-50 align-bottom text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-20 w-16 whitespace-nowrap bg-slate-50 px-2.5 py-2 text-left">ID</th>
                <th className="sticky left-16 z-20 whitespace-nowrap border-r border-slate-300 bg-slate-50 px-2.5 py-2 text-left shadow-[10px_0_10px_-6px_rgba(15,23,42,0.22)] print:shadow-none">
                  Employee
                </th>
                <th className="whitespace-nowrap px-2.5 py-2 text-left">Basic</th>
                <th className="whitespace-nowrap px-2.5 py-2 text-left">Allowance</th>
                <th className="whitespace-nowrap px-2.5 py-2 text-left">Gross</th>
                {showPf && (
                  <th className="whitespace-nowrap px-2.5 py-2 text-left">{rateHeader('PF', pfDraft, setPfDraft)}</th>
                )}
                {showSsfEmployer && (
                  <th className="whitespace-nowrap px-2.5 py-2 text-left">{rateHeader('SSF by Employer', ssfDraft, setSsfDraft)}</th>
                )}
                {showSsfEmployee && (
                  <th className="whitespace-nowrap px-2.5 py-2 text-left">{rateHeader('SSF by Employee', tdsDraft, setTdsDraft)}</th>
                )}
                {showOvertime && (
                  <th className="whitespace-nowrap px-2.5 py-2 text-left">
                    {rateHeader('Overtime', overtimeDraft, setOvertimeDraft)}
                  </th>
                )}
                <th className="whitespace-nowrap px-2.5 py-2 text-left">Net Payable</th>
              </tr>
            </thead>
            <tbody>
              {renderItems.map(item => {
                if (item.kind === 'group') {
                  return (
                    <tr key={`g-${item.branch}`} className="bg-slate-100">
                      <td colSpan={structureColCount} className="px-2.5 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-ink">
                        {item.branch}
                      </td>
                    </tr>
                  );
                }
                const { e, basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, overtimeAmt, net } = item.row;
                return (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-white px-2.5 py-1.5 text-center tabular-nums text-slate-400">{e.fingerprint_id || '—'}</td>
                    <td className="sticky left-16 z-[1] whitespace-nowrap border-r border-slate-300 bg-white px-2.5 py-1.5 text-left font-medium text-ink shadow-[10px_0_10px_-6px_rgba(15,23,42,0.22)] print:shadow-none">
                      <Link href={`/salary-structure/${e.id}${detailQuery}`} className="hover:text-accent hover:underline">
                        {e.name}
                      </Link>
                    </td>
                    {amountCell(e.id, 'salary', basic)}
                    {amountCell(e.id, 'allowance', allowance)}
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-medium tabular-nums text-ink">{shown(gross)}</td>
                    {showPf && <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-slate-700">{shown(pfAmt)}</td>}
                    {showSsfEmployer && <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-slate-700">{shown(ssfAmt)}</td>}
                    {showSsfEmployee && <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-critical-text">{shown(tdsAmt)}</td>}
                    {showOvertime && (
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-good-text">{shown(overtimeAmt)}</td>
                    )}
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-bold tabular-nums text-good-text">{shown(net)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={structureColCount} className="px-4 py-8 text-center text-slate-400">
                    {loading ? 'Loading…' : 'No active employees.'}
                  </td>
                </tr>
              )}
            </tbody>
            {totals.counted > 0 && (
              <tfoot>
                <tr className="sticky bottom-0 border-t-2 border-slate-300 bg-slate-50 text-[12.5px] font-bold text-ink">
                  <td
                    colSpan={2}
                    className="sticky left-0 z-[1] whitespace-nowrap border-r border-slate-300 bg-slate-50 px-2.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[10px_0_10px_-6px_rgba(15,23,42,0.22)] print:shadow-none"
                  >
                    Total{perDay && ' / day'} · {totals.counted} staff
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums">{shown(totals.basic)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums">{shown(totals.allowance)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums">{shown(totals.gross)}</td>
                  {showPf && <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums">{shown(totals.pfAmt)}</td>}
                  {showSsfEmployer && <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums">{shown(totals.ssfAmt)}</td>}
                  {showSsfEmployee && <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums text-critical-text">{shown(totals.tdsAmt)}</td>}
                  {showOvertime && (
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums text-good-text">{shown(totals.overtimeAmt)}</td>
                  )}
                  <td className="whitespace-nowrap px-2.5 py-2.5 text-right tabular-nums text-good-text">{shown(totals.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Net Payable = Basic + Allowance − PF − SSF by Employer − SSF by Employee{showOvertime && ' + Overtime'}. Click a Basic
        or Allowance figure to edit it for that employee, or click a name to open that employee&apos;s full salary breakdown. PF
        / SSF by Employer / SSF by Employee{showOvertime && ' / Overtime'} are all company-wide rates. Per-day figures divide the
        monthly amount by the number of days in {period.label}. The monthly Payroll report reads these figures and is not edited
        there.
        {showOvertime &&
          ' The Overtime line is a flat allowance (% of Basic), not the real attendance-based overtime pay the Payroll report calculates from actual hours worked.'}
        {!showOvertime &&
          ' The Overtime allowance is currently hidden (Payroll report column cog) — it is left out of the table and of Net Payable; each employee’s own breakdown page still shows it.'}
        {isAdmin && ' The cog above the table picks which optional columns the Payroll report shows.'}
      </p>
    </AppShell>
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

