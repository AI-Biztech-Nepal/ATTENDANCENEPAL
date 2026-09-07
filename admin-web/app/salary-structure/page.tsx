'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import { computeSalaryFigures } from '@/components/SalaryBreakdown';
import {
  buildPeriodOptions,
  currentSystemYearMonth,
  formatDdMmYyyy,
  systemPeriod,
  type CalendarPeriod,
} from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { fetchMyCompanyWeekOffConfig, leaveDatesByEmployee, weekOffDatesByGender } from '@/lib/weekOff';
import { fetchCompanyPayrollFormat } from '@/lib/payrollFormat';
import { buildEmployeeDayRows } from '@/lib/payrollDetail';
import { buildWeeklyPatternByEmployee, formatHoursMinutes, type DailyShiftByDate } from '@/lib/shift';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

// Nepal SSF is a statutory 20% employer + 11% employee of Basic — fixed, not
// the company's own ssf_rate. One customer (companies.payroll_format =
// 'staff_salary_sheet') wants this SSF gross-up and the attendance figures
// shown here too, so their Salary Structure lines up column-for-column with
// their Payroll report. Every other company sees exactly the columns below.
const SSF_EMPLOYER_RATE = 0.2;
const SSF_EMPLOYEE_RATE = 0.11;

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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Isolated — only this page's ASHADEEP branch reads it. Off for everyone
  // else, so the standard table below is 100% unchanged for them.
  const [sheetFormat, setSheetFormat] = useState(false);
  useEffect(() => {
    fetchCompanyPayrollFormat().then(f => setSheetFormat(f === 'staff_salary_sheet'));
  }, []);

  // Attendance + roster data for the extra "Staff Salary Sheet" columns —
  // loaded ONLY when sheetFormat is on. Mirrors the Staff Salary Sheet's own
  // fetch so the Worked Days / Total Hours / Overtime figures match.
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [rosterMode, setRosterMode] = useState<'weekly' | 'monthly'>('monthly');
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);

  // Saved rates (what's in the DB) vs the draft strings the header inputs
  // edit. The table previews with the draft so editing recalculates live;
  // "Save rates" persists and clears the dirty state.
  const [savedRates, setSavedRates] = useState({ pf: 10, ssf: 11, tds: 0 });
  const [pfDraft, setPfDraft] = useState('10');
  const [ssfDraft, setSsfDraft] = useState('11');
  const [tdsDraft, setTdsDraft] = useState('0');
  const [saving, setSaving] = useState(false);

  // Inline per-employee Basic / Allowance editing — one cell at a time, same
  // edit-in-place pattern the Payroll page uses for salary.
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'salary' | 'allowance' } | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  const [savingCell, setSavingCell] = useState(false);

  // Monthly (default) vs per-day view. Per-day divides each monthly figure
  // by the number of days in the selected period's calendar month.
  const [viewMode, setViewMode] = useState<'monthly' | 'perDay'>('monthly');

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

    fetchMyCompanyWeekOffConfig().then(({ companyId, pfRate, ssfRate, tdsRate, weeklyOffDay, rosterMode }) => {
      setCompanyId(companyId);
      setSavedRates({ pf: pfRate, ssf: ssfRate, tds: tdsRate });
      setPfDraft(String(pfRate));
      setSsfDraft(String(ssfRate));
      setTdsDraft(String(tdsRate));
      setWeeklyOffDay(weeklyOffDay);
      setRosterMode(rosterMode);
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

  // Extra data for the Staff Salary Sheet columns — skipped entirely unless
  // that format is on, so a normal company never runs these queries.
  useEffect(() => {
    if (!sheetFormat) return;
    if (rosterMode === 'weekly') {
      supabase.from('employee_weekly_pattern').select('employee_id, weekday, shift_id').then(({ data }) => setWeeklyPatternRows(data ?? []));
    }
    Promise.all([
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', start).lte('work_date', end),
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', `${start}T00:00:00Z`).lte('punch_time', `${end}T23:59:59Z`),
      supabase.from('shifts').select('*'),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end),
      supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', end).gte('end_date', start),
    ]).then(([sm, lg, sh, ro, ho, le]) => {
      setSummaries(sm.data ?? []);
      setLogs(lg.data ?? []);
      setShifts(sh.data ?? []);
      setDailyShiftRows(ro.data ?? []);
      setHolidays(ho.data ?? []);
      setLeaveRequests(le.data ?? []);
    });
  }, [sheetFormat, rosterMode, start, end]);

  const pf = Number(pfDraft) || 0;
  const ssf = Number(ssfDraft) || 0;
  const tds = Number(tdsDraft) || 0;

  const dirty =
    pfDraft !== String(savedRates.pf) || ssfDraft !== String(savedRates.ssf) || tdsDraft !== String(savedRates.tds);

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
      .map(e => ({ e, ...computeSalaryFigures(e.salary, e.allowance, pf, ssf, tds) }));
  }, [employees, search, pf, ssf, tds]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) map.set(r.employee_id, (perDate = new Map()));
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  // employee_id -> { worked days / hours / overtime } + the SSF gross-up
  // figures (SSF 20% of Basic, Monthly Gross MGS, employer/employee SSF,
  // Total SSF, Net Monthly). Only built when sheetFormat is on.
  const sheetByEmployee = useMemo(() => {
    const map = new Map<
      string,
      { days: number; hours: number; overtime: number; ssfBasis: number; mgs: number; ssfEmployer: number; ssfEmployee: number; totalSsf: number; netMonthly: number }
    >();
    if (!sheetFormat) return map;
    const weekOffDatesFor = weekOffDatesByGender(start, end, weeklyOffDay, holidays);
    const leaveByEmployee = leaveDatesByEmployee(leaveRequests);
    const weeklyPattern = buildWeeklyPatternByEmployee(weeklyPatternRows);
    for (const e of employees) {
      const dayRows = buildEmployeeDayRows(e, shifts, summaries, logs, start, end, dailyShiftByDate, weekOffDatesFor(e.gender), leaveByEmployee.get(e.id), weeklyPattern);
      let days = 0,
        hours = 0,
        overtime = 0;
      for (const d of dayRows) {
        if (d.status === 'Present' || d.status === 'Late') days += 1;
        hours += d.hours;
        overtime += d.overtime;
      }
      const basic = e.salary ?? 0;
      const dearness = Number(e.allowance ?? 0) || 0;
      const ssfEmployer = basic * SSF_EMPLOYER_RATE;
      const ssfEmployee = basic * SSF_EMPLOYEE_RATE;
      const mgs = basic + dearness + ssfEmployer;
      const totalSsf = ssfEmployer + ssfEmployee;
      map.set(e.id, { days, hours, overtime, ssfBasis: ssfEmployer, mgs, ssfEmployer, ssfEmployee, totalSsf, netMonthly: mgs - totalSsf });
    }
    return map;
  }, [sheetFormat, employees, shifts, summaries, logs, dailyShiftByDate, holidays, leaveRequests, weeklyOffDay, weeklyPatternRows, start, end]);

  const fmtHrs = (h: number) => formatHoursMinutes(Math.round(h * 60));

  const totals = useMemo(() => {
    let basic = 0,
      allowance = 0,
      gross = 0,
      pfAmt = 0,
      ssfAmt = 0,
      tdsAmt = 0,
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
      net += r.net!;
    }
    return { basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net, counted, deductions: pfAmt + ssfAmt + tdsAmt };
  }, [rows]);

  const sheetTotals = useMemo(() => {
    let days = 0,
      hours = 0,
      overtime = 0,
      ssfBasis = 0,
      mgs = 0,
      ssfEmployer = 0,
      ssfEmployee = 0,
      totalSsf = 0,
      netMonthly = 0;
    for (const r of rows) {
      const s = sheetByEmployee.get(r.e.id);
      if (!s) continue;
      days += s.days;
      hours += s.hours;
      overtime += s.overtime;
      if (r.basic == null) continue;
      ssfBasis += s.ssfBasis;
      mgs += s.mgs;
      ssfEmployer += s.ssfEmployer;
      ssfEmployee += s.ssfEmployee;
      totalSsf += s.totalSsf;
      netMonthly += s.netMonthly;
    }
    return { days, hours, overtime, ssfBasis, mgs, ssfEmployer, ssfEmployee, totalSsf, netMonthly };
  }, [rows, sheetByEmployee]);

  async function saveRates() {
    if (!companyId) return;
    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({ pf_rate: pf, ssf_rate: ssf, tds_rate: tds })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      alert(`Could not save the rates: ${error.message}`);
      return;
    }
    setSavedRates({ pf, ssf, tds });
  }

  function cancelRates() {
    setPfDraft(String(savedRates.pf));
    setSsfDraft(String(savedRates.ssf));
    setTdsDraft(String(savedRates.tds));
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
    const header = ['ID', 'Employee', `Basic${suffix}`, `Allowance${suffix}`, `Gross${suffix}`, `PF (${pf}%)${suffix}`, `SSF (${ssf}%)${suffix}`, `TDS (${tds}%)${suffix}`, `Net Payable${suffix}`];
    if (sheetFormat) {
      header.push('Worked Days', 'Total Hours', 'Overtime', `SSF 20% of Basic${suffix}`, `Monthly Gross (MGS)${suffix}`, `SSF by Employer 20%${suffix}`, `SSF by Employee 11%${suffix}`, `Total SSF Payable${suffix}`, `Net Monthly${suffix}`);
    }
    const cell = (n: number | null) => (n == null ? '' : Number((n * factor).toFixed(perDay ? 2 : 0)));
    const lines = rows.map(r => {
      const base: (string | number)[] = [
        r.e.fingerprint_id || '',
        r.e.name,
        cell(r.basic),
        r.allowance ? cell(r.allowance) : '',
        cell(r.gross),
        cell(r.pfAmt),
        cell(r.ssfAmt),
        cell(r.tdsAmt),
        cell(r.net),
      ];
      if (sheetFormat) {
        const s = sheetByEmployee.get(r.e.id);
        base.push(
          s?.days ?? '',
          s ? fmtHrs(s.hours) : '',
          s ? fmtHrs(s.overtime) : '',
          r.basic == null ? '' : cell(s?.ssfBasis ?? null),
          r.basic == null ? '' : cell(s?.mgs ?? null),
          r.basic == null ? '' : cell(s?.ssfEmployer ?? null),
          r.basic == null ? '' : cell(s?.ssfEmployee ?? null),
          r.basic == null ? '' : cell(s?.totalSsf ?? null),
          r.basic == null ? '' : cell(s?.netMonthly ?? null)
        );
      }
      return base;
    });
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
            PF {shown(totals.pfAmt)} · SSF {shown(totals.ssfAmt)} · TDS {shown(totals.tdsAmt)}
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
            <TableExportBar onExportCsv={exportCsv} />
          </div>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500 sm:px-6 print:hidden">
          {modeLine} · click an employee for their full breakdown
          {!isAdmin && <> · the PF / SSF / TDS rates are read-only for your role — an admin sets them here.</>}
          {sheetFormat && (
            <> · the SSF gross-up columns (SSF 20% of Basic → Net Monthly) and Worked Days / Total Hours / Overtime match the Payroll report.</>
          )}
        </div>

        <div className="hidden px-4 pt-4 sm:px-6 print:block">
          <h1 className="text-lg font-bold text-ink">Monthly Salary Structure — {period.label}</h1>
          <p className="text-xs text-slate-500">
            {modeLine} · PF {pf}% · SSF {ssf}% · TDS {tds}% of Basic
          </p>
        </div>

        <div className="max-h-[65vh] overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-y border-slate-200 bg-slate-50 align-bottom text-xs uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-3 py-2 font-medium">ID</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Employee</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Basic</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Allowance</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Gross</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('PF', pfDraft, setPfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('SSF', ssfDraft, setSsfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('TDS', tdsDraft, setTdsDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Net Payable</th>
                {sheetFormat && (
                  <>
                    <th className="whitespace-nowrap border-l border-slate-200 px-3 py-2 text-right font-medium">Worked Days</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total Hours</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Overtime</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">SSF 20% of Basic</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Monthly Gross (MGS)</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">SSF by Employer 20%</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">SSF by Employee 11%</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">Total SSF Payable</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Net Monthly</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net }) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">{e.fingerprint_id || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
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
                  <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-good-text">{shown(net)}</td>
                  {sheetFormat &&
                    (() => {
                      const s = sheetByEmployee.get(e.id);
                      return (
                        <>
                          <td className="whitespace-nowrap border-l border-slate-100 px-3 py-2 text-right tabular-nums text-slate-600">{s ? s.days : '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">{s ? fmtHrs(s.hours) : '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">{s ? fmtHrs(s.overtime) : '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">{shown(basic == null ? null : s?.ssfBasis ?? null)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink">{shown(basic == null ? null : s?.mgs ?? null)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(basic == null ? null : s?.ssfEmployer ?? null)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(basic == null ? null : s?.ssfEmployee ?? null)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(basic == null ? null : s?.totalSsf ?? null)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-good-text">{shown(basic == null ? null : s?.netMonthly ?? null)}</td>
                        </>
                      );
                    })()}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={sheetFormat ? 18 : 9} className="px-4 py-8 text-center text-slate-400">
                    {loading ? 'Loading…' : 'No active employees.'}
                  </td>
                </tr>
              )}
            </tbody>
            {totals.counted > 0 && (
              <tfoot>
                <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-sm font-bold text-ink">
                  <td colSpan={2} className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total{perDay && ' / day'} · {totals.counted} staff
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.basic)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.allowance)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.gross)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.pfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.ssfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.tdsAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-good-text">{shown(totals.net)}</td>
                  {sheetFormat && (
                    <>
                      <td className="whitespace-nowrap border-l border-slate-200 px-3 py-2 text-right tabular-nums">{sheetTotals.days}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtHrs(sheetTotals.hours)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtHrs(sheetTotals.overtime)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(sheetTotals.ssfBasis)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(sheetTotals.mgs)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(sheetTotals.ssfEmployer)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(sheetTotals.ssfEmployee)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(sheetTotals.totalSsf)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-good-text">{shown(sheetTotals.netMonthly)}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Net Payable = Basic + Allowance − PF − SSF − TDS. Click a Basic or Allowance figure to edit it for that employee, or
        click a name to open that employee&apos;s full salary breakdown. The PF / SSF / TDS rates are company-wide. Per-day
        figures divide the monthly amount by the number of days in {period.label}. The monthly Payroll report reads these
        figures and is not edited there. Overtime, where earned, is added on top on the Payroll report.
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
