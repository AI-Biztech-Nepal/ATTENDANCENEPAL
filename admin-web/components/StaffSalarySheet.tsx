'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { buildPeriodOptions, currentSystemYearMonth, formatDdMmYyyy, systemPeriod, type CalendarPeriod } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { buildEmployeeDayRows } from '@/lib/payrollDetail';
import { buildWeeklyPatternByEmployee, formatHoursMinutes, nepalTodayIso, type DailyShiftByDate } from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig, leaveDatesByEmployee, weekOffDatesByGender } from '@/lib/weekOff';
import {
  DEFAULT_PAYROLL_REPORT_COLUMNS,
  loadPayrollReportColumns,
  normalizePayrollReportColumns,
  PAYROLL_REPORT_COLUMNS_KEY,
  type PayrollReportColumns,
} from '@/lib/payrollReportColumns';
import type { AttendanceLog, Branch, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Decimal hours -> "Xh Ym", same as the standard Payroll report. */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

// Optional attendance columns — dropped from the table AND the printed / PDF
// / Excel copy when off. The on/off switches live on the Salary Structure
// page (the cog above its table, shared with the standard Payroll report via
// lib/payrollReportColumns); this sheet only reads the saved choice.
const ATTENDANCE_COLUMNS = [
  ['workedDays', 'Worked Days'],
  ['totalHours', 'Total Hours'],
  ['overtime', 'Overtime'],
] as const;

type AttendanceAgg = { days: number; hours: number; overtime: number; paidOffDays: number };

type SheetRow = {
  id: string;
  enrollId: string;
  name: string;
  basic: number;
  dearness: number;
  ssfBasis: number; // 20% of basic — the "SSF (20% of basic)" build-up column
  mgs: number; // basic + dearness + employer SSF
  ssfEmployer: number;
  ssfEmployee: number;
  totalSsf: number;
  net: number; // mgs - totalSsf
};

/**
 * The "Staff Salary Sheet" — a fixed-salary payroll report for one customer
 * (companies.payroll_format = 'staff_salary_sheet'). Everyone is paid their
 * full Basic + full Allowance (shown as "Dearness Allowance" here) every
 * month, with an SSF gross-up using the company's own "SSF by Employer" /
 * "SSF by Employee" rates (companies.ssf_rate/tds_rate, set on the Salary
 * Structure page — the same two fields the standard Payroll report reads,
 * defaulting to 11%/0% until an admin sets them here to match this sheet's
 * actual 20%/11% policy). There is NO attendance, proration, overtime, or
 * PF. Basic and Allowance are set per employee on the Salary Structure page.
 * Rendered by app/payroll/page.tsx in place of the standard attendance-based
 * report.
 */
export default function StaffSalarySheet() {
  const { system } = useCalendarSystem();
  const [period, setPeriod] = useState<CalendarPeriod>(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // Attendance for the Worked Days / Total Hours / Overtime columns — the
  // same payroll_summaries-or-live-from-punches data the standard Payroll
  // report and the Attendance Report use, reloaded whenever the period
  // changes. The fixed-salary math above never touches any of this.
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);
  // "SSF by Employer" / "SSF by Employee" — same company-wide rates the
  // Salary Structure page and standard Payroll report use (ssf_rate/tds_rate),
  // read-only here.
  const [ssfEmployerRate, setSsfEmployerRate] = useState(11);
  const [ssfEmployeeRate, setSsfEmployeeRate] = useState(0);

  // Which attendance columns show — the switches live on the Salary Structure
  // page now (shared localStorage, lib/payrollReportColumns); this sheet just
  // reads the saved value and stays in sync via the `storage` event.
  const [visibleCols, setVisibleCols] = useState<PayrollReportColumns>(DEFAULT_PAYROLL_REPORT_COLUMNS);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCols(loadPayrollReportColumns());
    function onStorage(e: StorageEvent) {
      if (e.key !== PAYROLL_REPORT_COLUMNS_KEY) return;
      try {
        setVisibleCols(e.newValue ? normalizePayrollReportColumns(JSON.parse(e.newValue)) : DEFAULT_PAYROLL_REPORT_COLUMNS);
      } catch {
        setVisibleCols(DEFAULT_PAYROLL_REPORT_COLUMNS);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('branches').select('*'),
    ]).then(([empRes, brRes]) => {
      setEmployees(empRes.data ?? []);
      setBranches(brRes.data ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode, ssfRate, tdsRate }) => {
      setWeeklyOffDay(weeklyOffDay);
      setSsfEmployerRate(ssfRate);
      setSsfEmployeeRate(tdsRate);
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
  }, []);

  useEffect(() => {
    const { start, end } = period;
    Promise.all([
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', start).lte('work_date', end),
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', `${start}T00:00:00Z`).lte('punch_time', `${end}T23:59:59Z`),
      supabase.from('shifts').select('*'),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end),
      supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', end).gte('end_date', start),
    ]).then(([summariesRes, logsRes, shiftsRes, rosterRes, holidaysRes, leaveRes]) => {
      setSummaries(summariesRes.data ?? []);
      setLogs(logsRes.data ?? []);
      setShifts(shiftsRes.data ?? []);
      setDailyShiftRows(rosterRes.data ?? []);
      setHolidays(holidaysRes.data ?? []);
      setLeaveRequests(leaveRes.data ?? []);
    });
  }, [period]);

  // Toggling AD/BS resets to "this month" in the newly active system — the
  // salary math is monthly-flat so the period only labels the sheet.
  useEffect(() => {
    const { year, month } = currentSystemYearMonth(system);
    setPeriod(systemPeriod(system, year, month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  const periodOptions = useMemo(() => buildPeriodOptions(system, null, period), [system, period]);

  // Opening an employee row drills into the shared per-employee day-by-day
  // breakdown page (app/payroll/[employeeId]) — same page the standard
  // Payroll report links to. This sheet carries no overtime settings, so
  // that page falls back to its own 8h/1.5x defaults.
  function detailHref(id: string) {
    const params = new URLSearchParams({ start: period.start, end: period.end });
    return `/payroll/${id}?${params.toString()}`;
  }

  const branchName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) m.set(b.id, b.name);
    return m;
  }, [branches]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  // employee_id -> worked days / worked hours / overtime hours / paid days
  // off for the selected period. Built from buildEmployeeDayRows() (shared
  // with the standard Payroll report and the per-employee detail page) so
  // the figures match everywhere. Absent from the fixed-salary math above.
  const attendanceByEmployee = useMemo(() => {
    const { start, end } = period;
    const weekOffDatesFor = weekOffDatesByGender(start, end, weeklyOffDay, holidays);
    const leaveByEmployee = leaveDatesByEmployee(leaveRequests);
    const weeklyPattern = buildWeeklyPatternByEmployee(weeklyPatternRows);
    const map = new Map<string, AttendanceAgg>();
    for (const emp of employees) {
      const rows = buildEmployeeDayRows(
        emp,
        shifts,
        summaries,
        logs,
        start,
        end,
        dailyShiftByDate,
        weekOffDatesFor(emp.gender),
        leaveByEmployee.get(emp.id),
        weeklyPattern
      );
      let days = 0;
      let hours = 0;
      let overtime = 0;
      let paidOffDays = 0;
      for (const d of rows) {
        if (d.status === 'Present' || d.status === 'Late') days += 1;
        if (d.paidOff) paidOffDays += 1;
        hours += d.hours;
        overtime += d.overtime;
      }
      map.set(emp.id, { days, hours, overtime, paidOffDays });
    }
    return map;
  }, [employees, shifts, summaries, logs, dailyShiftByDate, holidays, leaveRequests, weeklyOffDay, weeklyPatternRows, period]);

  const groups = useMemo(() => {
    const rows: (SheetRow & { branch: string })[] = employees
      .filter(e => e.salary != null)
      .map(e => {
        const basic = e.salary!;
        const dearness = Number(e.allowance ?? 0) || 0;
        const ssfEmployer = (basic * ssfEmployerRate) / 100;
        const ssfEmployee = (basic * ssfEmployeeRate) / 100;
        const mgs = basic + dearness + ssfEmployer;
        const totalSsf = ssfEmployer + ssfEmployee;
        return {
          id: e.id,
          enrollId: e.fingerprint_id ?? '—',
          name: e.name,
          branch: e.branch_id ? branchName.get(e.branch_id) ?? 'Unassigned' : 'Unassigned',
          basic,
          dearness,
          ssfBasis: ssfEmployer,
          mgs,
          ssfEmployer,
          ssfEmployee,
          totalSsf,
          net: mgs - totalSsf,
        };
      });

    const byBranch = new Map<string, (SheetRow & { branch: string })[]>();
    for (const r of rows) {
      if (!byBranch.has(r.branch)) byBranch.set(r.branch, []);
      byBranch.get(r.branch)!.push(r);
    }
    return [...byBranch.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([branch, list]) => ({
        branch,
        list: list.sort((a, b) => a.enrollId.localeCompare(b.enrollId, undefined, { numeric: true, sensitivity: 'base' })),
      }));
  }, [employees, branchName, ssfEmployerRate, ssfEmployeeRate]);

  const allRows = useMemo(() => groups.flatMap(g => g.list), [groups]);

  // Flat render list: a group header row, then its employee rows.
  //
  // The branch header is skipped when the company has only one group, where
  // it added a full-width band repeating what the whole sheet already is —
  // most companies here have a single branch, so it was pure noise for them.
  // Companies that really are split across branches (and the "Unassigned"
  // bucket alongside a real branch) still get their headers.
  const renderItems = useMemo(() => {
    const items: ({ kind: 'group'; branch: string } | { kind: 'row'; row: SheetRow & { branch: string } })[] = [];
    const showGroupHeaders = groups.length > 1;
    for (const g of groups) {
      if (showGroupHeaders) items.push({ kind: 'group', branch: g.branch });
      for (const r of g.list) {
        items.push({ kind: 'row', row: r });
      }
    }
    return items;
  }, [groups]);

  const grand = useMemo(() => {
    const sum = (f: (r: SheetRow) => number) => allRows.reduce((s, r) => s + f(r), 0);
    return {
      basic: sum(r => r.basic),
      dearness: sum(r => r.dearness),
      ssfBasis: sum(r => r.ssfBasis),
      mgs: sum(r => r.mgs),
      ssfEmployer: sum(r => r.ssfEmployer),
      ssfEmployee: sum(r => r.ssfEmployee),
      totalSsf: sum(r => r.totalSsf),
      net: sum(r => r.net),
    };
  }, [allRows]);

  const att = (id: string): AttendanceAgg => attendanceByEmployee.get(id) ?? { days: 0, hours: 0, overtime: 0, paidOffDays: 0 };

  // Column footer for the attendance columns — mirrors the standard Payroll
  // report: Worked Days shows "{present}P / {absent}A", the other two a
  // straight sum. "Absent" counts only days that have already elapsed, so a
  // month viewed mid-month doesn't read its remaining days as absences.
  const attTotals = useMemo(() => {
    const today = nepalTodayIso();
    const elapsedEnd = period.end < today ? period.end : today;
    const elapsedDays =
      period.start > elapsedEnd ? 0 : (new Date(elapsedEnd).getTime() - new Date(period.start).getTime()) / 86400000 + 1;
    let days = 0;
    let hours = 0;
    let overtime = 0;
    let paidOffDays = 0;
    for (const r of allRows) {
      const a = att(r.id);
      days += a.days;
      hours += a.hours;
      overtime += a.overtime;
      paidOffDays += a.paidOffDays;
    }
    const absentDays = Math.max(0, allRows.length * elapsedDays - days - paidOffDays);
    return { workedDays: days, hours, overtime, absentDays };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, attendanceByEmployee, period]);

  const visibleAttCols = ATTENDANCE_COLUMNS.filter(([key]) => visibleCols[key]);

  function exportCsv() {
    const header = [
      'Enroll ID',
      'Branch',
      'Employee Name',
      ...(visibleCols.workedDays ? ['Worked Days'] : []),
      ...(visibleCols.totalHours ? ['Total Hours'] : []),
      ...(visibleCols.overtime ? ['Overtime'] : []),
      'Basic Salary',
      'Dearness Allowance',
      `SSF ${ssfEmployerRate}% of Basic`,
      'Monthly Gross (MGS)',
      `SSF by Employer ${ssfEmployerRate}%`,
      `SSF by Employee ${ssfEmployeeRate}%`,
      'Total SSF Payable',
      'Net Monthly',
    ];
    const lines: (string | number)[][] = [];
    for (const g of groups) {
      for (const r of g.list) {
        const a = att(r.id);
        lines.push([
          r.enrollId,
          g.branch,
          r.name,
          ...(visibleCols.workedDays ? [a.days] : []),
          ...(visibleCols.totalHours ? [fmtHrs(a.hours)] : []),
          ...(visibleCols.overtime ? [fmtHrs(a.overtime)] : []),
          r.basic.toFixed(2),
          r.dearness.toFixed(2),
          r.ssfBasis.toFixed(2),
          r.mgs.toFixed(2),
          r.ssfEmployer.toFixed(2),
          r.ssfEmployee.toFixed(2),
          r.totalSsf.toFixed(2),
          r.net.toFixed(2),
        ]);
      }
    }
    downloadExcel(`staff_salary_sheet_${period.key}.csv`, header, lines);
  }

  // No text-align in the base class — Tailwind emits `text-right` after
  // `text-center`/`text-left` in the sheet, so a shared `text-right` here
  // would beat a per-column override. Each th/td sets its own alignment.
  // Headers sit left, heavier than the body, while the figures under them
  // stay right-aligned on their decimal. Ranging the two-line headings off a
  // common left edge makes them scannable as labels; right-aligning them
  // pushed each heading to a different start point, so the row read as a
  // ragged wall of text above a tidy column of numbers.
  const th = 'whitespace-nowrap px-2.5 py-2 align-bottom text-[11px] font-extrabold uppercase leading-tight tracking-wide text-slate-500';
  const thNum = `${th} text-left`;
  // Worked Days / Total Hours / Overtime hold one- or two-digit figures, so
  // nothing but their own two-line headings sets their width — "Worked" over
  // "Days" at 11px, which left the heading wedged against its neighbours with
  // only the cell padding either side. A floor gives them room without
  // touching the money columns, whose long headings already set their own.
  const thAtt = `${thNum} min-w-[5rem]`;
  const td = 'whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-slate-700';

  const colCount = 10 + visibleAttCols.length;

  return (
    <AppShell title="Payroll Report">
      {/* 10–13 columns need landscape — scoped here so it only affects THIS
          report's print, leaving every other page's orientation toggle
          alone. The global @media-print table rules are otherwise tuned
          for portrait and far too tight for this sheet, so relax them. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            '@media print{@page{size:A4 landscape;margin:9mm}' +
            '.ssheet{font-size:9px !important}' +
            '.ssheet th,.ssheet td{padding:4px 7px !important}}',
        }}
      />
      {/* summary tiles — every figure is a total off the sheet below */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
        <div className="rounded-xl bg-info-bg p-3.5 shadow-sm ring-1 ring-inset ring-info/10">
          <span className="text-xs font-medium text-info-text/80">Total Basic Salary</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-info-text">{money(grand.basic)}</div>
          <div className="mt-0.5 text-[11px] text-info-text/70">{allRows.length} staff</div>
        </div>
        <div className="rounded-xl bg-accent/10 p-3.5 shadow-sm ring-1 ring-inset ring-accent/10">
          <span className="text-xs font-medium text-accent/80">Total Dearness Allowance</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-accent">{money(grand.dearness)}</div>
          <div className="mt-0.5 text-[11px] text-accent/70">from each employee&rsquo;s Allowance</div>
        </div>
        <div className="rounded-xl bg-warning-bg p-3.5 shadow-sm ring-1 ring-inset ring-warning/10">
          <span className="text-xs font-medium text-warning-text/80">Total SSF Payable</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-warning-text">{money(grand.totalSsf)}</div>
          <div className="mt-0.5 text-[11px] text-warning-text/70">Employer {ssfEmployerRate}% + Employee {ssfEmployeeRate}%</div>
        </div>
        <div className="rounded-xl bg-good-bg p-3.5 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Net Monthly Payable</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-good-text">{money(grand.net)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">Gross − Total SSF</div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white pb-2 shadow-sm print:overflow-visible print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-4 sm:px-6 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <SheetIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Staff Salary Sheet</h2>
              <p className="text-xs text-slate-500">
                {period.label} · {formatDdMmYyyy(period.start, system)} to {formatDdMmYyyy(period.end, system)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
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
          </div>

          <TableExportBar onExportCsv={exportCsv} />
        </div>

        {/* print-only masthead */}
        <div className="hidden px-4 pt-2 print:block sm:px-6">
          <h1 className="text-lg font-bold text-black">Staff Salary Sheet</h1>
          <p className="mt-1 text-[11px] text-black">
            Month: {period.label} · {formatDdMmYyyy(period.start, system)} to {formatDdMmYyyy(period.end, system)}
          </p>
        </div>

        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="mt-4 overflow-x-auto pb-2 print:overflow-visible">
          <table className="ssheet w-full text-right text-[12.5px]">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50">
                <th className={`${th} sticky left-0 z-10 w-16 bg-slate-50 text-left shadow-none`}>ID</th>
                <th className={`${th} sticky left-16 z-10 min-w-[10rem] bg-slate-50 text-left shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none`}>
                  Employee Name
                </th>
                {visibleCols.workedDays && (
                  <th className={thAtt}>
                    Worked<br />
                    Days
                  </th>
                )}
                {visibleCols.totalHours && (
                  <th className={thAtt}>
                    Total<br />
                    Hours
                  </th>
                )}
                {visibleCols.overtime && <th className={thAtt}>Overtime</th>}
                <th className={thNum}>
                  Basic Salary
                </th>
                <th className={thNum}>
                  Allowance
                </th>
                <th className={thNum}>
                  SSF {ssfEmployerRate}%<br />
                  of Basic
                </th>
                <th className={thNum}>
                  Monthly Gross<br />
                  Salary
                </th>
                <th className={thNum}>
                  SSF by Employer<br />
                  {ssfEmployerRate}% of Basic
                </th>
                <th className={thNum}>
                  SSF by Employee<br />
                  {ssfEmployeeRate}% of Basic
                </th>
                <th className={thNum}>
                  Total SSF<br />
                  Payable
                </th>
                <th className={thNum}>Net Monthly</th>
              </tr>
            </thead>
            <tbody>
              {renderItems.map(item =>
                item.kind === 'group' ? (
                  <tr key={`g-${item.branch}`} className="bg-slate-100">
                    <td colSpan={colCount} className="px-2.5 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-ink">
                      {item.branch}
                    </td>
                  </tr>
                ) : (
                  <tr key={item.row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-white px-2.5 py-1.5 text-center tabular-nums text-slate-400">
                      {item.row.enrollId}
                    </td>
                    <td className="sticky left-16 z-[1] whitespace-nowrap bg-white px-2.5 py-1.5 text-left font-medium text-ink shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none">
                      <Link href={detailHref(item.row.id)} className="hover:text-accent hover:underline print:no-underline print:text-ink">
                        {item.row.name}
                      </Link>
                    </td>
                    {visibleCols.workedDays && <td className={td}>{att(item.row.id).days}</td>}
                    {visibleCols.totalHours && <td className={td}>{fmtHrs(att(item.row.id).hours)}</td>}
                    {visibleCols.overtime && <td className={td}>{fmtHrs(att(item.row.id).overtime)}</td>}
                    <td className={td}>{money(item.row.basic)}</td>
                    <td className={td}>{money(item.row.dearness)}</td>
                    <td className={td}>{money(item.row.ssfBasis)}</td>
                    <td className={td}>{money(item.row.mgs)}</td>
                    <td className={td}>{money(item.row.ssfEmployer)}</td>
                    <td className={`${td} text-critical-text`}>{money(item.row.ssfEmployee)}</td>
                    <td className={td}>{money(item.row.totalSsf)}</td>
                    <td className={`${td} font-bold text-good-text`}>{money(item.row.net)}</td>
                  </tr>
                )
              )}
              {!loading && allRows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-slate-400">
                    No active employees with a salary set.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
            {allRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 text-[12.5px] font-bold text-ink">
                  <td
                    colSpan={2}
                    className="sticky left-0 z-[1] bg-slate-50 px-2.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none"
                  >
                    Total
                  </td>
                  {visibleCols.workedDays && (
                    <td className="px-2.5 py-2.5 text-right text-xs tabular-nums">
                      <span className="text-good-text">{attTotals.workedDays}P</span>
                      {' / '}
                      <span className="text-critical-text">{attTotals.absentDays}A</span>
                    </td>
                  )}
                  {visibleCols.totalHours && <td className="px-2.5 py-2.5 text-right tabular-nums">{fmtHrs(attTotals.hours)}</td>}
                  {visibleCols.overtime && <td className="px-2.5 py-2.5 text-right tabular-nums">{fmtHrs(attTotals.overtime)}</td>}
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.basic)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.dearness)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.ssfBasis)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.mgs)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.ssfEmployer)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-critical-text">{money(grand.ssfEmployee)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.totalSsf)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-good-text">{money(grand.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

      </div>
    </AppShell>
  );
}

function SheetIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
    </svg>
  );
}
