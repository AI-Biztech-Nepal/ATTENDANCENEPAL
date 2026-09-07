'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import StaffSalarySheet from '@/components/StaffSalarySheet';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import HorizontalScrollButtons from '@/components/HorizontalScrollButtons';
import { fetchCompanyPayrollFormat, type PayrollFormat } from '@/lib/payrollFormat';
import {
  buildPeriodOptions,
  currentSystemYearMonth,
  formatAdDate,
  formatDdMmYyyy,
  systemPeriod,
  type CalendarPeriod,
} from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  isWeekOff,
  nepalDateKey,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig, leaveDatesByEmployee, weekOffDatesByGender } from '@/lib/weekOff';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

/** Decimal hours (e.g. row.hours, row.overtime) -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

export default function PayrollPage() {
  const { system } = useCalendarSystem();
  const [period, setPeriod] = useState<CalendarPeriod>(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  });
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);
  const [pendingSalary, setPendingSalary] = useState<Record<string, string>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  // Overtime pay is derived from the monthly Salary against an assumed
  // standard workday — both editable per-view here, seeded from (and
  // savable back to) the company's own saved default (companies.
  // ot_hours_per_day/ot_multiplier) rather than a hardcoded 8h/1.5x.
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [otHoursPerDay, setOtHoursPerDay] = useState(8);
  const [otMultiplier, setOtMultiplier] = useState(1.5);
  // Read-only here — set on the Salary Structure page. Applied to each
  // row's attendance-adjusted Total Salary (not the flat monthly Basic), so
  // these amounts shrink for a partial/absent period just like the pay
  // itself does; "SSF by Employee" is the renamed former "TDS" rate, same
  // company-wide column (companies.tds_rate) under the hood.
  const [pfRate, setPfRate] = useState(10);
  const [ssfRate, setSsfRate] = useState(11);
  const [ssfByEmployeeRate, setSsfByEmployeeRate] = useState(0);
  const [overtimeAllowanceRate, setOvertimeAllowanceRate] = useState(0);
  const [otDefaultsDirty, setOtDefaultsDirty] = useState(false);
  const [savingOtDefaults, setSavingOtDefaults] = useState(false);
  const [dataRange, setDataRange] = useState<{ earliest: Date; latest: Date } | null>(null);
  const [employeeId, setEmployeeId] = useState('all');
  const [loading, setLoading] = useState(true);
  // Null until resolved. One customer runs a completely different
  // fixed-salary report (StaffSalarySheet) instead of this one.
  const [payrollFormat, setPayrollFormat] = useState<PayrollFormat | null>(null);
  // Optional columns the admin can hide from the report (the cog menu in
  // the report header). A hidden column is dropped from the table AND from
  // the printed / PDF copy — it's simply not rendered, not print:hidden.
  const [visibleCols, setVisibleCols] = useState({ workedDays: true, totalHours: true, overtime: true, lateEarly: true, deductions: true });
  // Whether Total Salary / Net Payable are prorated by actual hours/days
  // worked ('attendance', the long-standing default) or just pay everyone
  // their full stored Basic every period regardless of attendance ('flat',
  // same idea as StaffSalarySheet's fixed-salary model) — a per-view choice,
  // not persisted, so switching back to 'attendance' is always one click.
  const [salaryMode, setSalaryMode] = useState<'attendance' | 'flat'>('attendance');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    function onDown(e: MouseEvent) {
      if (settingsRef.current?.contains(e.target as Node)) return;
      setSettingsOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  // The Overtime toggle drives two columns (Overtime hours + Overtime
  // Salary); Deductions drives six (Allowance, PF, SSF by Employer, SSF by
  // Employee, Overtime Allowance, Net Payable).
  const hiddenColCount =
    (visibleCols.workedDays ? 0 : 1) +
    (visibleCols.totalHours ? 0 : 1) +
    (visibleCols.overtime ? 0 : 2) +
    (visibleCols.lateEarly ? 0 : 1) +
    (visibleCols.deductions ? 0 : 6);

  const { start, end } = period;

  // The day-1-to-last-day breakdown lives on its own page (not a popup or
  // an inline dropdown — both fought this page's layout) — carries the
  // current period and overtime settings along since that page has no
  // period picker of its own. The per-employee "count overtime pay?" toggle
  // lives on that page now, not here.
  function detailHref(employeeId: string) {
    const params = new URLSearchParams({
      start,
      end,
      otHoursPerDay: String(otHoursPerDay),
      otMultiplier: String(otMultiplier),
    });
    return `/payroll/${employeeId}?${params.toString()}`;
  }

  // One customer runs a fixed-salary report instead of this one — resolved
  // on its own so nothing shared changes for everybody else.
  useEffect(() => {
    fetchCompanyPayrollFormat().then(setPayrollFormat);
  }, []);

  // The oldest/newest punch on record — bounds the period dropdown to
  // months that actually have data instead of listing years of empty ones.
  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ companyId, weeklyOffDay, rosterMode, otHoursPerDay, otMultiplier, pfRate, ssfRate, tdsRate, overtimeRate }) => {
      setCompanyId(companyId);
      setWeeklyOffDay(weeklyOffDay);
      setOtHoursPerDay(otHoursPerDay);
      setOtMultiplier(otMultiplier);
      setPfRate(pfRate);
      setSsfRate(ssfRate);
      setSsfByEmployeeRate(tdsRate);
      setOvertimeAllowanceRate(overtimeRate);
      // Not date-scoped (a pattern applies to every week), and only ever
      // relevant in 'weekly' roster_mode — see resolveShiftForDate().
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
  }, []);

  async function saveOtDefaults() {
    if (!companyId) return;
    setSavingOtDefaults(true);
    const { error } = await supabase
      .from('companies')
      .update({ ot_hours_per_day: otHoursPerDay, ot_multiplier: otMultiplier })
      .eq('id', companyId);
    setSavingOtDefaults(false);
    if (!error) setOtDefaultsDirty(false);
  }

  useEffect(() => {
    Promise.all([
      supabase.from('attendance_logs').select('punch_time').order('punch_time', { ascending: true }).limit(1),
      supabase.from('attendance_logs').select('punch_time').order('punch_time', { ascending: false }).limit(1),
    ]).then(([earliestRes, latestRes]) => {
      const earliest = earliestRes.data?.[0]?.punch_time;
      const latest = latestRes.data?.[0]?.punch_time;
      if (!earliest || !latest) {
        setDataRange(null);
        return;
      }
      setDataRange({ earliest: new Date(earliest), latest: new Date(latest) });
    });
  }, []);

  // Picking a period is switching to whichever calendar's real months — BS
  // Shrawan, Bhadra, ... in BS mode, AD January, February, ... in AD mode —
  // each option's start/end is that month's own true day-1-to-last-day span
  // (see Period/monthDateRange), never an AD month wearing a BS label.
  // Toggling AD/BS resets to "this month" in the newly active system, since
  // the previously selected month rarely has an equivalent boundary in the
  // other system.
  useEffect(() => {
    const { year, month } = currentSystemYearMonth(system);
    setPeriod(systemPeriod(system, year, month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  // One flat list of every period this dropdown can jump to, instead of a
  // separate Month select + Year select — picking a period is then one
  // selection instead of two. Bounded to where actual data exists (capped
  // to a max of 12 months back even if data goes further), but "now" is
  // always included so you can jump to the current month before any of its
  // data exists yet.
  const periodOptions = useMemo(() => buildPeriodOptions(system, dataRange, period), [system, dataRange, period]);

  // Same data + same live-calc fallback the Attendance Report page uses
  // (payroll_summaries where the nightly job has run, computeDayStatus()
  // against raw punches where it hasn't) — so a day shows up here exactly
  // when it shows up there, with the same numbers.
  function reload() {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', start).lte('work_date', end),
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).gte('punch_time', `${start}T00:00:00Z`).lte('punch_time', `${end}T23:59:59Z`),
      supabase.from('shifts').select('*'),
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end),
      supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', end).gte('end_date', start),
    ]).then(([summariesRes, logsRes, shiftsRes, employeesRes, rosterRes, holidaysRes, leaveRes]) => {
      setSummaries(summariesRes.data ?? []);
      setLogs(logsRes.data ?? []);
      setShifts(shiftsRes.data ?? []);
      setEmployees(employeesRes.data ?? []);
      setDailyShiftRows(rosterRes.data ?? []);
      setHolidays(holidaysRes.data ?? []);
      setLeaveRequests(leaveRes.data ?? []);
      setLoading(false);
    });
  }

  useEffect(reload, [start, end]);

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

  // Company-wide Week-off (recurring day + ad-hoc holidays) and approved
  // Leave both count as paid days below, even with zero punches — distinct
  // from the per-employee roster Week Off (dailyShiftByDate), which affects
  // late/early classification but was never actually paid (see calc below).
  // A per-employee lookup: gender-scoped holidays (e.g. Teej) are a paid day
  // off only for the employees they cover.
  const weekOffDatesFor = useMemo(
    () => weekOffDatesByGender(start, end, weeklyOffDay, holidays),
    [start, end, weeklyOffDay, holidays]
  );
  const leaveByEmployee = useMemo(() => leaveDatesByEmployee(leaveRequests), [leaveRequests]);
  const weeklyPattern = useMemo(() => buildWeeklyPatternByEmployee(weeklyPatternRows), [weeklyPatternRows]);

  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);
  // For attendance counting only (possibleDays/absentDays below) — a period
  // running into the future (this month, viewed mid-month) shouldn't count
  // days that haven't happened yet as "absent". daysInRange itself stays the
  // full period length everywhere else (salary is prorated over the whole
  // month regardless of how much of it has elapsed).
  const elapsedDaysInRange = useMemo(() => {
    const today = nepalTodayIso();
    const elapsedEnd = end < today ? end : today;
    return start > elapsedEnd ? 0 : (new Date(elapsedEnd).getTime() - new Date(start).getTime()) / 86400000 + 1;
  }, [start, end]);

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );

  const byEmployee = useMemo(() => {
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    while (cur <= endDate) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const map = new Map<
      string,
      {
        id: string;
        enrollId: string;
        name: string;
        salary: number | null;
        allowance: number;
        days: number;
        hours: number;
        overtime: number;
        lateDays: number;
        earlyDays: number;
        paidOffDays: number;
      }
    >();
    for (const emp of scopedEmployees) {
      map.set(emp.id, {
        id: emp.id,
        enrollId: emp.fingerprint_id ?? '—',
        name: emp.name,
        salary: emp.salary,
        allowance: emp.allowance ?? 0,
        days: 0,
        hours: 0,
        overtime: 0,
        lateDays: 0,
        earlyDays: 0,
        paidOffDays: 0,
      });
    }

    const today = nepalTodayIso();

    // Per-employee: raw same-date bucketing, corrected for any day whose
    // resolved shift crosses midnight — same fix as the Attendance Report
    // page, computed once per employee rather than inside the day loop.
    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of scopedEmployees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => nepalDateKey(l.punch_time) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate, weekOffDatesFor(emp.gender), weeklyPattern);
      logsByEmployeeDay.set(emp.id, byDate);
    }

    for (const day of days) {
      for (const emp of scopedEmployees) {
        const row = map.get(emp.id);
        if (!row) continue;
        const weekOffDateSet = weekOffDatesFor(emp.gender);
        // Today can still gain punches after its payroll_summaries row was
        // computed (that row isn't re-run until tomorrow's nightly job), so
        // always compute today live rather than trusting a possibly-stale
        // summary. Past days' summaries are already final.
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        if (summary) {
          row.days += 1;
          row.hours += Number(summary.total_hours);
          row.overtime += Number(summary.overtime_hours);
          if (summary.is_late) row.lateDays += 1;
          if (summary.is_early_departure) row.earlyDays += 1;
          continue;
        }
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        if (dayLogs.length === 0) {
          // No punch, but still a paid day: company Week-off, a per-employee
          // Week Off picked on the Weekly/Monthly Roster (checked via the
          // same resolveShiftForDate() a day WITH punches already uses
          // below — its own doc comment explains why a roster row wins over
          // the company-wide date), or approved Leave. Tracked separately
          // from `hours`/`days` (which stay a pure worked-attendance count)
          // and added as its own credit in calculatedSalary() below.
          const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, weekOffDateSet, weeklyPattern);
          if (isWeekOff(resolved) || leaveByEmployee.get(emp.id)?.has(day)) {
            row.paidOffDays += 1;
          }
          continue;
        }
        // Not yet processed by compute_payroll_summaries() — compute live
        // from the raw punches, same as the Attendance Report page does.
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, weekOffDateSet, weeklyPattern);
        const live = computeDayStatusForResolvedShift(dayLogs, resolved);
        row.days += 1;
        row.hours += live.totalMinutes / 60;
        row.overtime += live.overtimeMinutes / 60;
        if (live.isLate && !emp.attendance_exempt) row.lateDays += 1;
        if (live.isEarly && !emp.attendance_exempt) row.earlyDays += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.enrollId.localeCompare(b.enrollId, undefined, { numeric: true, sensitivity: 'base' }));
  }, [summaries, logs, shifts, scopedEmployees, start, end, dailyShiftByDate, weekOffDatesFor, leaveByEmployee, weeklyPattern]);

  const totals = useMemo(() => {
    const totalHours = byEmployee.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = byEmployee.reduce((s, r) => s + r.overtime, 0);
    const workedDays = byEmployee.reduce((s, r) => s + r.days, 0);
    const paidOffDays = byEmployee.reduce((s, r) => s + r.paidOffDays, 0);
    const lateDays = byEmployee.reduce((s, r) => s + r.lateDays, 0);
    const earlyDays = byEmployee.reduce((s, r) => s + r.earlyDays, 0);
    const possibleDays = scopedEmployees.length * elapsedDaysInRange;
    const absentDays = Math.max(0, possibleDays - workedDays - paidOffDays);
    const attendancePct = possibleDays ? Math.round((workedDays / possibleDays) * 1000) / 10 : 0;
    const totalEmployeeSalary = byEmployee.reduce((s, r) => s + (r.salary ?? 0), 0);
    const totalSalaryPayable = byEmployee.reduce((s, r) => s + (calculatedSalary(r) ?? 0), 0);
    const totalOvertimeSalary = byEmployee.reduce((s, r) => {
      if (r.salary == null || r.overtime <= 0) return s;
      const hourlyRate = r.salary / (daysInRange * otHoursPerDay);
      return s + hourlyRate * otMultiplier * r.overtime;
    }, 0);
    const totalAllowance = byEmployee.reduce((s, r) => s + r.allowance, 0);
    const totalPf = byEmployee.reduce((s, r) => s + (pfDeduction(r) ?? 0), 0);
    const totalSsf = byEmployee.reduce((s, r) => s + (ssfDeduction(r) ?? 0), 0);
    const totalSsfByEmployee = byEmployee.reduce((s, r) => s + (ssfByEmployeeDeduction(r) ?? 0), 0);
    const totalOvertimeAllowance = byEmployee.reduce((s, r) => s + (overtimeAllowance(r) ?? 0), 0);
    const totalNetPayable = byEmployee.reduce((s, r) => s + (netPayable(r) ?? 0), 0);
    return {
      totalHours,
      overtimeHours,
      workedDays,
      absentDays,
      lateDays,
      earlyDays,
      attendancePct,
      totalEmployeeSalary,
      totalSalaryPayable,
      totalOvertimeSalary,
      totalAllowance,
      totalPf,
      totalSsf,
      totalSsfByEmployee,
      totalOvertimeAllowance,
      totalNetPayable,
    };
  }, [byEmployee, scopedEmployees, daysInRange, elapsedDaysInRange, otHoursPerDay, otMultiplier, pfRate, ssfRate, ssfByEmployeeRate, overtimeAllowanceRate, salaryMode]);

  // Pay is earned per hour actually worked, not per day shown up — a day
  // where someone left after 2 hours pays 2 hours, not a full day's worth.
  // Overtime hours are already counted inside `hours` (see computeDayStatus),
  // so they're subtracted back out here and paid separately below at the
  // overtime multiplier instead of twice at the regular rate.
  //
  // paidOffDays (company Week-off / approved Leave with no punch) each add
  // one full standard day's pay — hourlyRate * otHoursPerDay is exactly
  // salary / daysInRange, i.e. one clean day of the monthly salary — kept as
  // a separate term rather than folded into `hours` so "Total Hours" keeps
  // meaning actual worked hours.
  function calculatedSalary(row: { salary: number | null; hours: number; overtime: number; paidOffDays: number }): number | null {
    if (row.salary == null) return null;
    // Flat mode ignores attendance entirely — everyone gets their full
    // stored Basic every period, same idea as StaffSalarySheet.
    if (salaryMode === 'flat') return row.salary;
    const hourlyRate = row.salary / (daysInRange * otHoursPerDay);
    const regularHours = Math.max(0, row.hours - row.overtime);
    return Math.round(hourlyRate * regularHours + hourlyRate * otHoursPerDay * row.paidOffDays);
  }

  function overtimeSalary(row: { salary: number | null; overtime: number }): number | null {
    if (row.salary == null) return null;
    // No overtime concept in flat mode — pay isn't derived from hours at all.
    if (salaryMode === 'flat') return 0;
    if (row.overtime <= 0) return 0;
    const hourlyRate = row.salary / (daysInRange * otHoursPerDay);
    return Math.round(hourlyRate * otMultiplier * row.overtime);
  }

  function totalSalary(row: { salary: number | null; hours: number; overtime: number; paidOffDays: number }): number | null {
    const calculated = calculatedSalary(row);
    if (calculated == null) return null;
    // Hiding the Overtime column also takes overtime pay out of the total —
    // "not shown" means "not counted" for this report.
    return calculated + (visibleCols.overtime ? overtimeSalary(row) ?? 0 : 0);
  }

  // PF / SSF by Employer / SSF by Employee / Overtime Allowance from the Salary
  // Structure page, applied here to the attendance-adjusted amount actually
  // earned this period (calculatedSalary + real overtime pay, regardless of
  // whether the Overtime column itself is currently hidden) rather than the
  // flat monthly Basic — so these shrink for a partial/absent period the
  // same way the pay itself does. Overtime Allowance is a flat % add-on,
  // distinct from the hours-based Overtime Salary already in this report.
  function netPayableBase(row: { salary: number | null; hours: number; overtime: number; paidOffDays: number }): number | null {
    const calculated = calculatedSalary(row);
    if (calculated == null) return null;
    return calculated + (overtimeSalary(row) ?? 0);
  }
  function pfDeduction(row: Parameters<typeof netPayableBase>[0]): number | null {
    const base = netPayableBase(row);
    return base == null ? null : Math.round((base * pfRate) / 100);
  }
  function ssfDeduction(row: Parameters<typeof netPayableBase>[0]): number | null {
    const base = netPayableBase(row);
    return base == null ? null : Math.round((base * ssfRate) / 100);
  }
  function ssfByEmployeeDeduction(row: Parameters<typeof netPayableBase>[0]): number | null {
    const base = netPayableBase(row);
    return base == null ? null : Math.round((base * ssfByEmployeeRate) / 100);
  }
  function overtimeAllowance(row: Parameters<typeof netPayableBase>[0]): number | null {
    const base = netPayableBase(row);
    return base == null ? null : Math.round((base * overtimeAllowanceRate) / 100);
  }
  // Allowance is added flat here (same as Salary Structure's Gross = Basic +
  // Allowance), never prorated by attendance and never part of the PF/SSF/
  // SSF-by-Employee/Overtime-Allowance percentage base above — those stay
  // Basic-only, exactly like computeSalaryFigures() on Salary Structure.
  function netPayable(row: Parameters<typeof netPayableBase>[0] & { allowance: number }): number | null {
    const base = netPayableBase(row);
    if (base == null) return null;
    return base + row.allowance - pfDeduction(row)! - ssfDeduction(row)! - ssfByEmployeeDeduction(row)! + overtimeAllowance(row)!;
  }

  function exportCsv() {
    // The export mirrors the on-screen report — columns hidden via the
    // settings menu are left out here too.
    const header = [
      'ID',
      'Employee',
      ...(visibleCols.workedDays ? ['Worked Days'] : []),
      ...(visibleCols.totalHours ? ['Total Hours'] : []),
      ...(visibleCols.overtime ? ['Overtime'] : []),
      'Late Days',
      'Early Days',
      'Salary',
      'Calculated Salary',
      ...(visibleCols.overtime ? ['Overtime Salary'] : []),
      'Total Salary',
      ...(visibleCols.deductions
        ? ['Allowance', `PF (${pfRate}%)`, `SSF by Employer (${ssfRate}%)`, `SSF by Employee (${ssfByEmployeeRate}%)`, `Overtime Allowance (${overtimeAllowanceRate}%)`, 'Net Payable']
        : []),
    ];
    const lines = byEmployee.map(row => [
      row.enrollId,
      row.name,
      ...(visibleCols.workedDays ? [row.days] : []),
      ...(visibleCols.totalHours ? [fmtHrs(row.hours)] : []),
      ...(visibleCols.overtime ? [fmtHrs(row.overtime)] : []),
      row.lateDays,
      row.earlyDays,
      row.salary ?? '',
      calculatedSalary(row) ?? '',
      ...(visibleCols.overtime ? [overtimeSalary(row) ?? ''] : []),
      totalSalary(row) ?? '',
      ...(visibleCols.deductions
        ? [row.allowance, pfDeduction(row) ?? '', ssfDeduction(row) ?? '', ssfByEmployeeDeduction(row) ?? '', overtimeAllowance(row) ?? '', netPayable(row) ?? '']
        : []),
    ]);
    downloadExcel(`payroll_${start}_to_${end}.csv`, header, lines);
  }

  async function applySalaryChange(employeeId: string, salary: string) {
    const { error } = await supabase.from('employees').update({ salary: salary ? Number(salary) : null }).eq('id', employeeId);
    return error;
  }

  // Each row saves/cancels on its own — no single bulk "save everything"
  // button, so one row's edit can't accidentally carry another row's
  // half-finished edit along with it.
  function hasPendingSalaryChange(row: { id: string; salary: number | null }): boolean {
    const draft = pendingSalary[row.id];
    if (draft === undefined) return false;
    return draft !== (row.salary != null ? String(row.salary) : '');
  }

  async function saveSalaryRow(employeeId: string) {
    const draft = pendingSalary[employeeId];
    if (draft === undefined) return;
    setSavingRowId(employeeId);
    const error = await applySalaryChange(employeeId, draft);
    setSavingRowId(null);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setPendingSalary(p => {
      const next = { ...p };
      delete next[employeeId];
      return next;
    });
    setEditingSalaryId(null);
    reload();
  }

  function cancelSalaryRow(employeeId: string) {
    setPendingSalary(p => {
      const next = { ...p };
      delete next[employeeId];
      return next;
    });
    setEditingSalaryId(null);
  }

  // Plain functions returning JSX (not components) so the same edit-in-place
  // markup can be reused by both the desktop table and the mobile card list
  // below without wrapping it in a nested component — a nested component
  // would get a fresh identity every render and remount (losing focus on
  // the salary input while typing).
  function salaryCellContent(row: (typeof byEmployee)[number]) {
    return editingSalaryId === row.id ? (
      <>
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          placeholder="—"
          value={pendingSalary[row.id] ?? (row.salary != null ? String(row.salary) : '')}
          onChange={e => setPendingSalary(p => ({ ...p, [row.id]: e.target.value }))}
          className="w-28 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
        />
        {hasPendingSalaryChange(row) && (
          <div className="mt-1 flex gap-2">
            <button
              onClick={() => cancelSalaryRow(row.id)}
              disabled={savingRowId === row.id}
              className="text-xs font-medium text-slate-500 hover:underline disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={() => saveSalaryRow(row.id)}
              disabled={savingRowId === row.id}
              className="text-xs font-semibold text-accent hover:underline disabled:opacity-60"
            >
              {savingRowId === row.id ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </>
    ) : (
      <div className="flex items-center gap-2">
        <span className="text-ink">{row.salary != null ? row.salary.toLocaleString() : '—'}</span>
        <button onClick={() => setEditingSalaryId(row.id)} title="Edit salary" className="text-slate-400 hover:text-accent print:hidden">
          <EditIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const COLUMN_OPTIONS = [
    ['workedDays', 'Worked Days'],
    ['totalHours', 'Total Hours'],
    ['overtime', 'Overtime'],
    ['lateEarly', 'Late / Early Days'],
    ['deductions', 'Allowance / PF / SSF / Net Payable'],
  ] as const;

  const columnSettings = (
    <div className="relative print:hidden" ref={settingsRef}>
      <button
        type="button"
        onClick={() => setSettingsOpen(v => !v)}
        title="Report settings"
        className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
      >
        <CogIcon className="h-[18px] w-[18px]" />
      </button>
      {settingsOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent px-4 py-3">
            <CogIcon className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-ink">Settings</span>
          </div>
          <p className="px-4 pb-1 pt-2 text-[11px] leading-snug text-slate-400">
            Show or hide these columns in the report and its printed / PDF copy. Hiding Overtime also drops
            overtime pay from the totals. Allowance comes straight from Salary Structure (flat, not attendance-adjusted); PF /
            SSF by Employer / SSF by Employee / Overtime Allowance are the same rates set there too, applied to each row&apos;s
            attendance-adjusted Total Salary this period, with Allowance added on top for Net Payable.
          </p>
          <div className="p-1.5">
            {COLUMN_OPTIONS.map(([key, label]) => {
              const on = visibleCols[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setVisibleCols(c => ({ ...c, [key]: !c[key] }))}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-sm text-ink hover:bg-slate-50"
                >
                  {label}
                  <span
                    className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-good' : 'bg-slate-300'}`}
                  >
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
  );

  // Standard companies never hit this branch — the format resolves to
  // 'standard' and the normal report below renders throughout, unchanged.
  // Only the one customer with payroll_format = 'staff_salary_sheet' gets
  // swapped over (after a brief flash of this page while it resolves).
  if (payrollFormat === 'staff_salary_sheet') {
    return <StaffSalarySheet />;
  }

  return (
    <AppShell title="Attendance-based Payroll Controller">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:hidden">
        <div className="rounded-xl bg-warning-bg p-3 shadow-sm ring-1 ring-inset ring-warning/10">
          <span className="text-xs font-medium text-warning-text/80">Overtime Salary</span>
          <div className="mt-1 text-base font-bold text-warning-text">
            {totals.totalOvertimeSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-warning-text/70">
            <input
              type="number"
              min="0"
              step="0.5"
              value={otHoursPerDay}
              onChange={e => {
                setOtHoursPerDay(Number(e.target.value) || 0);
                setOtDefaultsDirty(true);
              }}
              title="Standard hours per day"
              className="w-10 rounded border border-warning/30 bg-white px-1 py-0.5 text-center text-warning-text"
            />
            h/day ×
            <input
              type="number"
              min="0"
              step="0.1"
              value={otMultiplier}
              onChange={e => {
                setOtMultiplier(Number(e.target.value) || 0);
                setOtDefaultsDirty(true);
              }}
              title="Overtime rate multiplier"
              className="w-10 rounded border border-warning/30 bg-white px-1 py-0.5 text-center text-warning-text"
            />
            x
          </div>
          {otDefaultsDirty && (
            <button
              type="button"
              onClick={saveOtDefaults}
              disabled={savingOtDefaults || !companyId}
              className="mt-1 text-[11px] font-medium text-warning-text underline decoration-dotted hover:text-warning-text/80 disabled:opacity-50"
            >
              {savingOtDefaults ? 'Saving…' : 'Save as company default'}
            </button>
          )}
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Total Salary Payable</span>
          <div className="mt-1 text-base font-bold text-good-text">{totals.totalSalaryPayable.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">
            Earned so far this period
            {visibleCols.deductions && ` · Net Payable ${totals.totalNetPayable.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
        </div>
        <div className="rounded-xl bg-info-bg p-3 shadow-sm ring-1 ring-inset ring-info/10">
          <span className="text-xs font-medium text-info-text/80">Total Employees Salary</span>
          <div className="mt-1 text-base font-bold text-info-text">{totals.totalEmployeeSalary.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] text-info-text/70">Full monthly salary, all staff</div>
        </div>
        <div className="rounded-xl bg-purple-50 p-3 shadow-sm ring-1 ring-inset ring-purple-200">
          <span className="text-xs font-medium text-purple-700/80">Overtime Tracked</span>
          <div className="mt-1 text-base font-bold text-purple-700">{fmtHrs(totals.overtimeHours)}</div>
          <div className="mt-0.5 text-[11px] text-purple-700/70">This period</div>
        </div>
        <div className="rounded-xl bg-accent/10 p-3 shadow-sm ring-1 ring-inset ring-accent/10">
          <span className="text-xs font-medium text-accent/80">Total Payable Hours</span>
          <div className="mt-1 text-base font-bold text-accent">{fmtHrs(totals.totalHours)}</div>
          <div className="mt-0.5 text-[11px] text-accent/70">Across {scopedEmployees.length} staff</div>
        </div>
        <div
          className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${
            totals.attendancePct >= 75
              ? 'bg-good-bg ring-good/10'
              : totals.attendancePct >= 50
                ? 'bg-warning-bg ring-warning/10'
                : 'bg-critical-bg ring-critical/10'
          }`}
        >
          <span
            className={`text-xs font-medium ${
              totals.attendancePct >= 75 ? 'text-good-text/80' : totals.attendancePct >= 50 ? 'text-warning-text/80' : 'text-critical-text/80'
            }`}
          >
            Average Attendance
          </span>
          <div
            className={`mt-1 text-base font-bold ${
              totals.attendancePct >= 75 ? 'text-good-text' : totals.attendancePct >= 50 ? 'text-warning-text' : 'text-critical-text'
            }`}
          >
            {totals.attendancePct}%
          </div>
          <div
            className={`mt-0.5 text-[11px] ${
              totals.attendancePct >= 75 ? 'text-good-text/70' : totals.attendancePct >= 50 ? 'text-warning-text/70' : 'text-critical-text/70'
            }`}
          >
            Worked days vs possible
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white pb-2 shadow-sm print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-4 sm:px-6 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <ReportIcon className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-bold text-ink">{period.label} Salary Report</h2>
          </div>

          <div className="flex items-center gap-1.5" title="Whether Total Salary / Net Payable prorate for attendance, or pay everyone's full stored Basic every period regardless">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold shadow-sm">
              <button
                type="button"
                onClick={() => setSalaryMode('attendance')}
                className={`px-3 py-2 ${salaryMode === 'attendance' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Attendance-based
              </button>
              <button
                type="button"
                onClick={() => setSalaryMode('flat')}
                className={`px-3 py-2 ${salaryMode === 'flat' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Flat Monthly
              </button>
            </div>
          </div>

          <div className="relative">
            <PersonIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
            <select
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              className="min-w-[13rem] rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="all">All Employees</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} (ID {e.fingerprint_id ?? '—'})
                </option>
              ))}
            </select>
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
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
              <span className="text-slate-400">({daysInRange}d)</span>
            </div>
          </div>

          <TableExportBar onExportCsv={exportCsv} leading={columnSettings} />
        </div>
        {/* Print-only masthead — gives the report a proper document header
            (title, the period it covers, headcount, when it was run)
            instead of opening straight into a bare table. */}
        <div className="hidden px-4 pt-2 print:block sm:px-6">
          <h1 className="text-lg font-bold text-black">{period.label} Salary Report</h1>
          <p className="mt-1 text-[11px] text-black">
            Pay period: {formatDdMmYyyy(start, system)} – {formatDdMmYyyy(end, system)} ({daysInRange} days) · {byEmployee.length} employee
            {byEmployee.length === 1 ? '' : 's'}
          </p>
          <p className="text-[11px] text-black">Generated: {formatDdMmYyyy(nepalTodayIso(), system)}</p>
        </div>

        {/* Phones get one card per employee — the 10-column table below
            would otherwise need horizontal scrolling to read anything. */}
        <div className="mt-3 divide-y divide-slate-100 md:hidden print:hidden">
          {byEmployee.map(row => (
            <div key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={row.name} />
                  <div className="min-w-0">
                    <Link href={detailHref(row.id)} className="truncate font-medium text-ink hover:text-accent hover:underline">
                      {row.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      ID {row.enrollId} · {row.days} days · {row.lateDays} late · {row.earlyDays} early
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Total Salary</div>
                  <div className="text-base font-bold text-good-text">
                    {totalSalary(row) != null ? totalSalary(row)!.toLocaleString() : '—'}
                  </div>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
                {visibleCols.totalHours && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Total Hours</dt>
                    <dd className="text-ink">{fmtHrs(row.hours)}</dd>
                  </div>
                )}
                {visibleCols.overtime && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Overtime</dt>
                    <dd className="text-ink">{fmtHrs(row.overtime)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Salary</dt>
                  <dd>{salaryCellContent(row)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Calculated Salary</dt>
                  <dd className="text-ink">
                    {calculatedSalary(row) != null ? calculatedSalary(row)!.toLocaleString() : '—'}
                    {visibleCols.overtime && overtimeSalary(row) != null && (
                      <span className="text-slate-400"> ({overtimeSalary(row)!.toLocaleString()})</span>
                    )}
                  </dd>
                </div>
                {visibleCols.overtime && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Overtime Salary</dt>
                    <dd className="text-ink tabular-nums">
                      {overtimeSalary(row) != null ? overtimeSalary(row)!.toLocaleString() : '—'}
                    </dd>
                  </div>
                )}
                {visibleCols.deductions && (
                  <>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">Allowance</dt>
                      <dd className="text-ink tabular-nums">{row.allowance.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">PF</dt>
                      <dd className="text-critical-text tabular-nums">{pfDeduction(row) != null ? pfDeduction(row)!.toLocaleString() : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">SSF by Employer</dt>
                      <dd className="text-critical-text tabular-nums">{ssfDeduction(row) != null ? ssfDeduction(row)!.toLocaleString() : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">SSF by Employee</dt>
                      <dd className="text-critical-text tabular-nums">
                        {ssfByEmployeeDeduction(row) != null ? ssfByEmployeeDeduction(row)!.toLocaleString() : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">Overtime Allowance</dt>
                      <dd className="text-good-text tabular-nums">{overtimeAllowance(row) != null ? overtimeAllowance(row)!.toLocaleString() : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">Net Payable</dt>
                      <dd className="font-bold text-good-text tabular-nums">{netPayable(row) != null ? netPayable(row)!.toLocaleString() : '—'}</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
          ))}
          {byEmployee.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">{loading ? 'Loading…' : 'No active employees.'}</p>
          )}
          {byEmployee.length > 0 && (
            <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold">
              <span className="text-good-text">{totals.workedDays} present days</span>
              <span className="text-slate-300">·</span>
              <span className="text-critical-text">{totals.absentDays} absent days</span>
            </div>
          )}
        </div>

        <HorizontalScrollButtons targetRef={tableScrollRef} />
        <div ref={tableScrollRef} className="print-report mt-4 hidden max-h-[65vh] overflow-auto md:block print:!block print:max-h-none print:overflow-visible">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-20 w-16 whitespace-nowrap bg-slate-50 px-3 py-2 font-medium">ID</th>
              <th className="sticky left-16 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 font-medium shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none">
                Employee
              </th>
              {visibleCols.workedDays && <th className="whitespace-nowrap px-3 py-2 font-medium">Worked Days</th>}
              {visibleCols.totalHours && <th className="whitespace-nowrap px-3 py-2 font-medium">Total Hours</th>}
              {visibleCols.overtime && <th className="whitespace-nowrap px-3 py-2 font-medium">Overtime</th>}
              {visibleCols.lateEarly && <th className="whitespace-nowrap px-3 py-2 font-medium">Late / Early Days</th>}
              <th className="whitespace-nowrap px-3 py-2 font-medium">Salary</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Calculated Salary</th>
              {visibleCols.overtime && <th className="whitespace-nowrap pl-2 pr-3 py-2 font-medium">Overtime Salary</th>}
              <th
                className={`whitespace-nowrap px-3 py-2 font-medium ${
                  visibleCols.deductions
                    ? ''
                    : 'sticky right-0 z-20 bg-slate-50 shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none'
                }`}
              >
                Total Salary
              </th>
              {visibleCols.deductions && (
                <>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Allowance</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium text-critical-text">PF ({pfRate}%)</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium text-critical-text">SSF by Employer ({ssfRate}%)</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium text-critical-text">SSF by Employee ({ssfByEmployeeRate}%)</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium text-good-text">Overtime Allowance ({overtimeAllowanceRate}%)</th>
                  <th className="sticky right-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 font-medium shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none">
                    Net Payable
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {byEmployee.map((row, i) => {
              const rowBg = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
              return (
                <tr key={row.id} className={`border-b border-slate-100 last:border-0 hover:bg-slate-100 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                  <td className={`sticky left-0 z-[1] whitespace-nowrap px-3 py-2 text-slate-600 ${rowBg}`}>{row.enrollId}</td>
                  <td
                    className={`sticky left-16 z-[1] whitespace-nowrap px-3 py-2 font-medium text-ink shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none ${rowBg}`}
                  >
                    <Link href={detailHref(row.id)} className="flex items-center gap-2.5 hover:text-accent hover:underline">
                      <span className="print:hidden">
                        <Avatar name={row.name} />
                      </span>
                      {row.name}
                    </Link>
                  </td>
                  {visibleCols.workedDays && (
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{row.days}</td>
                  )}
                  {visibleCols.totalHours && <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fmtHrs(row.hours)}</td>}
                  {visibleCols.overtime && <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fmtHrs(row.overtime)}</td>}
                  {visibleCols.lateEarly && (
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <span className="text-warning-text">{row.lateDays}L</span>
                      {' / '}
                      <span className="text-critical-text">{row.earlyDays}E</span>
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2">{salaryCellContent(row)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {calculatedSalary(row) != null ? calculatedSalary(row)!.toLocaleString() : '—'}
                    {visibleCols.overtime && overtimeSalary(row) != null && (
                      <span className="text-slate-400"> ({overtimeSalary(row)!.toLocaleString()})</span>
                    )}
                  </td>
                  {visibleCols.overtime && (
                    <td className="whitespace-nowrap pl-2 pr-3 py-2 text-slate-600 tabular-nums">
                      {overtimeSalary(row) != null ? overtimeSalary(row)!.toLocaleString() : '—'}
                    </td>
                  )}
                  <td
                    className={`whitespace-nowrap px-3 py-2 font-bold text-good-text ${
                      visibleCols.deductions ? '' : `sticky right-0 z-[1] shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none ${rowBg}`
                    }`}
                  >
                    {totalSalary(row) != null ? totalSalary(row)!.toLocaleString() : '—'}
                  </td>
                  {visibleCols.deductions && (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600 tabular-nums">{row.allowance.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-critical-text tabular-nums">
                        {pfDeduction(row) != null ? pfDeduction(row)!.toLocaleString() : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-critical-text tabular-nums">
                        {ssfDeduction(row) != null ? ssfDeduction(row)!.toLocaleString() : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-critical-text tabular-nums">
                        {ssfByEmployeeDeduction(row) != null ? ssfByEmployeeDeduction(row)!.toLocaleString() : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-good-text tabular-nums">
                        {overtimeAllowance(row) != null ? overtimeAllowance(row)!.toLocaleString() : '—'}
                      </td>
                      <td
                        className={`sticky right-0 z-[1] whitespace-nowrap px-3 py-2 font-bold text-good-text shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none ${rowBg}`}
                      >
                        {netPayable(row) != null ? netPayable(row)!.toLocaleString() : '—'}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {byEmployee.length === 0 && (
              <tr>
                <td colSpan={16 - hiddenColCount} className="px-4 py-8 text-center text-slate-400">
                  {loading ? 'Loading…' : 'No active employees.'}
                </td>
              </tr>
            )}
          </tbody>
          {byEmployee.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-sm font-bold text-ink">
                <td
                  colSpan={2}
                  className="sticky left-0 z-[1] whitespace-nowrap bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[6px_0_6px_-4px_rgba(0,0,0,0.08)] print:shadow-none"
                >
                  Total
                </td>
                {visibleCols.workedDays && (
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span className="text-good-text">{totals.workedDays}P</span>
                    {' / '}
                    <span className="text-critical-text">{totals.absentDays}A</span>
                  </td>
                )}
                {visibleCols.totalHours && <td className="whitespace-nowrap px-3 py-2">{fmtHrs(totals.totalHours)}</td>}
                {visibleCols.overtime && <td className="whitespace-nowrap px-3 py-2">{fmtHrs(totals.overtimeHours)}</td>}
                {visibleCols.lateEarly && (
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span className="text-warning-text">{totals.lateDays}L</span>
                    {' / '}
                    <span className="text-critical-text">{totals.earlyDays}E</span>
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2">{totals.totalEmployeeSalary.toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {totals.totalSalaryPayable.toLocaleString()}
                  {visibleCols.overtime && ` (${totals.totalOvertimeSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })})`}
                </td>
                {visibleCols.overtime && (
                  <td className="whitespace-nowrap pl-2 pr-3 py-2">
                    {totals.totalOvertimeSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                )}
                <td
                  className={`whitespace-nowrap px-3 py-2 text-good-text ${
                    visibleCols.deductions ? '' : 'sticky right-0 z-20 bg-slate-50 shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none'
                  }`}
                >
                  {(totals.totalSalaryPayable + (visibleCols.overtime ? totals.totalOvertimeSalary : 0)).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </td>
                {visibleCols.deductions && (
                  <>
                    <td className="whitespace-nowrap px-3 py-2">{totals.totalAllowance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="whitespace-nowrap px-3 py-2">{totals.totalPf.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="whitespace-nowrap px-3 py-2">{totals.totalSsf.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="whitespace-nowrap px-3 py-2">{totals.totalSsfByEmployee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-good-text">
                      {totals.totalOvertimeAllowance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="sticky right-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 text-good-text shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none">
                      {totals.totalNetPayable.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          )}
        </table>
        </div>

        {/* Print-only sign-off — the last thing that makes it read as a
            payroll document rather than a table export. */}
        {byEmployee.length > 0 && (
          <div className="hidden px-4 pb-6 pt-12 print:block sm:px-6">
            <div className="flex justify-between gap-12 text-[11px] text-black">
              <div className="w-52 border-t border-black pt-1 text-center">Prepared by</div>
              <div className="w-52 border-t border-black pt-1 text-center">Approved by</div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </svg>
  );
}

function ReportIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
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

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
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
