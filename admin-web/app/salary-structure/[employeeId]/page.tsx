'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import SalaryBreakdown, { computeSalaryFigures, salaryBreakdownLines } from '@/components/SalaryBreakdown';
import {
  buildMonth,
  currentSystemYearMonth,
  formatDdMmYyyy,
  systemPeriod,
  todayAnchor,
  type CalendarAnchor,
} from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso, type DailyShiftByDate, type WeeklyPatternByEmployee } from '@/lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning } from '@/lib/payrollDetail';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '@/lib/weekOff';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

function round(n: number) {
  return Math.round(n);
}

function parseAdAnchor(key: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

export default function SalaryStructureEmployeePage() {
  return (
    <Suspense fallback={null}>
      <SalaryStructureEmployeeView />
    </Suspense>
  );
}

function SalaryStructureEmployeeView() {
  const { system } = useCalendarSystem();
  const params = useParams<{ employeeId: string }>();
  const searchParams = useSearchParams();
  const employeeId = params.employeeId;

  // The period comes from whichever Salary Structure list link was clicked —
  // this page has no period picker of its own, same as the Payroll detail
  // page. Falls back to the current month if opened without one.
  const fallback = useMemo(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  }, [system]);
  const start = searchParams.get('start') || fallback.start;
  const end = searchParams.get('end') || fallback.end;
  const view = searchParams.get('view') || 'monthly';
  const listQuery = `?start=${start}&end=${end}&view=${view}`;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [rates, setRates] = useState({ pf: 10, ssf: 11, tds: 0, overtime: 0 });
  const [config, setConfig] = useState({ weeklyOffDay: null as number | null, otHoursPerDay: 8, otMultiplier: 1.5 });
  const [loading, setLoading] = useState(true);

  // Attendance inputs for the period — same set the Payroll detail page
  // loads, used here only to derive the absence / late / overtime adjustment.
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ weekday: number; shift_id: string | null }[]>([]);

  const daysInMonth = useMemo(() => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1, [start, end]);
  const monthLabel = useMemo(() => buildMonth(system, parseAdAnchor(start) ?? todayAnchor()).label, [system, start]);
  const isCurrentMonth = useMemo(() => {
    const today = nepalTodayIso();
    return start <= today && today <= end;
  }, [start, end]);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ pfRate, ssfRate, tdsRate, overtimeRate, weeklyOffDay, rosterMode, otHoursPerDay, otMultiplier }) => {
      setRates({ pf: pfRate, ssf: ssfRate, tds: tdsRate, overtime: overtimeRate });
      setConfig({ weeklyOffDay, otHoursPerDay, otMultiplier });
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('weekday, shift_id')
          .eq('employee_id', employeeId)
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
  }, [employeeId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('employees').select('*').eq('id', employeeId).single(),
      supabase.from('shifts').select('*'),
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end),
      supabase.from('attendance_logs').select(ATTENDANCE_LOG_COLUMNS).eq('employee_id', employeeId).gte('punch_time', `${start}T00:00:00Z`).lte('punch_time', `${end}T23:59:59Z`),
      supabase.from('employee_daily_shifts').select('work_date, shift_id').eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end),
      supabase.from('company_holidays').select('*').gte('holiday_date', start).lte('holiday_date', end),
      supabase.from('leave_requests').select('*').eq('employee_id', employeeId).eq('status', 'approved').lte('start_date', end).gte('end_date', start),
    ]).then(([empRes, shiftsRes, summariesRes, logsRes, rosterRes, holidaysRes, leaveRes]) => {
      setEmployee(empRes.data ?? null);
      setShifts(shiftsRes.data ?? []);
      setSummaries(summariesRes.data ?? []);
      setLogs(logsRes.data ?? []);
      setDailyShiftRows(rosterRes.data ?? []);
      setHolidays(holidaysRes.data ?? []);
      setLeaveRequests(leaveRes.data ?? []);
      setLoading(false);
    });
  }, [employeeId, start, end]);

  const { pf, ssf, tds, overtime } = rates;
  const { weeklyOffDay, otHoursPerDay, otMultiplier } = config;

  const figures = useMemo(
    () => computeSalaryFigures(employee?.salary ?? null, employee?.allowance ?? null, pf, ssf, tds, overtime),
    [employee, pf, ssf, tds, overtime]
  );

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    const perDate = new Map<string, string | null>();
    for (const r of dailyShiftRows) perDate.set(r.work_date, r.shift_id);
    map.set(employeeId, perDate);
    return map;
  }, [dailyShiftRows, employeeId]);

  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => {
    const map: WeeklyPatternByEmployee = new Map();
    const perWeekday = new Map<number, string | null>();
    for (const r of weeklyPatternRows) perWeekday.set(r.weekday, r.shift_id);
    map.set(employeeId, perWeekday);
    return map;
  }, [weeklyPatternRows, employeeId]);

  const weekOffDates = useMemo(
    () => weekOffDatesInRange(start, end, weeklyOffDay, holidays, employee?.gender ?? null),
    [start, end, weeklyOffDay, holidays, employee?.gender]
  );
  const leaveDates = useMemo(() => {
    const set = new Set<string>();
    for (const req of leaveRequests) {
      const cur = new Date((req.start_date < start ? start : req.start_date) + 'T00:00:00Z');
      const endDate = new Date((req.end_date > end ? end : req.end_date) + 'T00:00:00Z');
      while (cur <= endDate) {
        set.add(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    return set;
  }, [start, end, leaveRequests]);

  const dayRows = useMemo(
    () => (employee ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end, dailyShiftByDate, weekOffDates, leaveDates, weeklyPattern) : []),
    [employee, shifts, summaries, logs, start, end, dailyShiftByDate, weekOffDates, leaveDates, weeklyPattern]
  );

  // The month's net attendance effect on pay: what a full standard day would
  // have earned for each elapsed day, minus what was actually earned per hour
  // worked (absence, late arrival and early departure all cut this below
  // zero), plus overtime pay earned on top. One figure — negative means a net
  // deduction, positive means a net surplus.
  const adjustment = useMemo(() => {
    if (employee?.salary == null) return null;
    const perStdDay = employee.salary / daysInMonth;
    let expected = 0;
    let actualBase = 0;
    let overtime = 0;
    let countedDays = 0;
    let absentDays = 0;
    let lateMinutes = 0;
    let earlyMinutes = 0;
    for (const d of dayRows) {
      if (d.status === 'Upcoming') continue;
      countedDays += 1;
      expected += perStdDay;
      const earn = dailySalaryEarning(d, employee.salary, daysInMonth, otHoursPerDay, otMultiplier, true);
      if (earn) {
        actualBase += earn.base;
        overtime += earn.overtime;
      }
      if (d.status === 'Absent') absentDays += 1;
      lateMinutes += d.lateMinutes;
      earlyMinutes += d.earlyMinutes;
    }
    const shortfall = actualBase - expected; // ≤ 0 for absence / late / early
    return { net: shortfall + overtime, shortfall, overtime, countedDays, absentDays, lateMinutes, earlyMinutes };
  }, [employee, dayRows, daysInMonth, otHoursPerDay, otMultiplier]);

  function exportCsv() {
    if (!employee) return;
    const lines: (string | number)[][] = salaryBreakdownLines(figures, pf, ssf, tds, overtime).map(l => [
      l.label,
      l.value == null ? '' : l.value,
      l.value == null ? '' : Number((l.value / daysInMonth).toFixed(2)),
    ]);
    if (adjustment) {
      lines.push(['Absence / late / early adjustment', round(adjustment.shortfall), '']);
      lines.push(['Overtime pay', round(adjustment.overtime), '']);
      lines.push(['Net attendance adjustment', round(adjustment.net), Number((adjustment.net / daysInMonth).toFixed(2))]);
    }
    downloadExcel(
      `salary_structure_${employee.name.replace(/\s+/g, '_')}_${start}_to_${end}.csv`,
      ['Component', 'Per month', `Per day (${monthLabel})`],
      lines
    );
  }

  const deductions = figures.pfAmt == null ? null : figures.pfAmt + figures.ssfAmt! + figures.tdsAmt!;
  const adjNet = adjustment?.net ?? null;
  const adjPositive = (adjNet ?? 0) >= 0;

  return (
    <AppShell title={employee ? employee.name : 'Salary Structure'}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/salary-structure${listQuery}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-accent">
          <BackIcon className="h-4 w-4" />
          Back to Salary Structure
        </Link>
        {employee && <TableExportBar onExportCsv={exportCsv} />}
      </div>

      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employee ? (
        <p className="text-center text-sm text-critical">Employee not found.</p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent p-4 shadow-sm sm:p-6 print:border-slate-300 print:shadow-none">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-white">
                {employee.name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('')}
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">{employee.name}</h2>
                <p className="text-xs font-medium text-slate-500">
                  {employee.designation || 'Salary structure'}
                  {employee.employee_code && ` · #${employee.employee_code}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="rounded-lg border border-accent/30 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm">{monthLabel}</div>
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
                <span className="text-slate-400">({daysInMonth}d)</span>
              </div>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SalaryTile label="Gross Pay" value={figures.gross} daysInMonth={daysInMonth} tone="bg-info-bg text-info-text ring-info/10" />
            <SalaryTile label="Total Deductions" value={deductions} daysInMonth={daysInMonth} tone="bg-critical-bg text-critical-text ring-critical/10" sub="PF + SSF by Employer + SSF by Employee only" />
            <div className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${adjPositive ? 'bg-good-bg text-good-text ring-good/10' : 'bg-critical-bg text-critical-text ring-critical/10'}`}>
              <span className="text-xs font-medium opacity-80">
                Attendance {adjPositive ? 'Surplus' : 'Deduction'}
                {isCurrentMonth && <span className="opacity-70"> · month to date</span>}
              </span>
              <div className="mt-1 text-base font-bold">
                {adjNet == null ? '—' : `${adjNet >= 0 ? '+' : '−'}${Math.abs(round(adjNet)).toLocaleString()}`}
              </div>
              <div className="mt-0.5 text-[11px] opacity-70">
                {adjustment == null
                  ? 'No salary set'
                  : `Absence/late ${round(adjustment.shortfall).toLocaleString()} · overtime +${round(adjustment.overtime).toLocaleString()}`}
              </div>
            </div>
            <div className="rounded-xl bg-accent/10 p-3 text-accent shadow-sm ring-1 ring-inset ring-accent/10">
              <span className="text-xs font-medium opacity-80">Projected Take-home</span>
              <div className="mt-1 text-base font-bold">
                {figures.net == null ? '—' : round(figures.net + (adjNet ?? 0)).toLocaleString()}
              </div>
              <div className="mt-0.5 text-[11px] opacity-70">Net Payable {adjPositive ? '+' : '−'} adjustment</div>
            </div>
          </div>

          <h1 className="mb-2 hidden text-lg font-bold text-ink print:block">
            {employee.name} — Salary Structure ({monthLabel})
          </h1>

          <SalaryBreakdown
            employee={employee}
            figures={figures}
            pf={pf}
            ssf={ssf}
            tds={tds}
            overtimeRate={overtime}
            daysInMonth={daysInMonth}
            monthLabel={monthLabel}
            system={system}
          />

          {adjustment && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm print:border-slate-300 print:shadow-none">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Attendance adjustment for {monthLabel}{isCurrentMonth && ' (so far)'}
              </div>
              <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <Row k="Days counted" v={`${adjustment.countedDays} of ${daysInMonth}`} />
                <Row k="Absent days" v={String(adjustment.absentDays)} />
                <Row k="Late arrival" v={`${round(adjustment.lateMinutes)} min total`} />
                <Row k="Early departure" v={`${round(adjustment.earlyMinutes)} min total`} />
                <Row k="Absence / late / early" v={round(adjustment.shortfall).toLocaleString()} tone={adjustment.shortfall < 0 ? 'text-critical-text' : undefined} />
                <Row k="Overtime pay" v={`+${round(adjustment.overtime).toLocaleString()}`} tone={adjustment.overtime > 0 ? 'text-good-text' : undefined} />
                <Row
                  k="Net attendance adjustment"
                  v={`${adjustment.net >= 0 ? '+' : '−'}${Math.abs(round(adjustment.net)).toLocaleString()}`}
                  strong
                  tone={adjustment.net >= 0 ? 'text-good-text' : 'text-critical-text'}
                />
              </dl>
            </div>
          )}

          <p className="mt-3 text-xs text-slate-400">
            Net Payable = Basic + Allowance − PF − SSF by Employer − SSF by Employee + Overtime allowance (the fixed structure). The Attendance box is
            separate: it is the month&apos;s absence / late-arrival / early-departure shortfall (pay is earned per hour
            actually worked) plus the real overtime pay earned on top from actual hours — one figure that goes negative for a
            net deduction or positive for a net surplus. That real overtime figure is unrelated to the flat Overtime allowance
            % above. Per-day figures divide by the {daysInMonth} days in {monthLabel}.
          </p>
        </>
      )}
    </AppShell>
  );
}

function SalaryTile({
  label,
  value,
  daysInMonth,
  tone,
  sub,
}: {
  label: string;
  value: number | null;
  daysInMonth: number;
  tone: string;
  sub?: string;
}) {
  return (
    <div className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${tone}`}>
      <span className="text-xs font-medium opacity-80">{label}</span>
      <div className="mt-1 text-base font-bold">{value != null ? value.toLocaleString() : '—'}</div>
      <div className="mt-0.5 text-[11px] opacity-70">
        {value != null ? `${(value / daysInMonth).toLocaleString(undefined, { maximumFractionDigits: 2 })} / day` : 'No salary set'}
        {sub && value != null && ` · ${sub}`}
      </div>
    </div>
  );
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-slate-200 pt-1.5 font-semibold' : ''}`}>
      <dt className="text-slate-500">{k}</dt>
      <dd className={`tabular-nums ${tone ?? 'text-ink'}`}>{v}</dd>
    </div>
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

function BackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}
