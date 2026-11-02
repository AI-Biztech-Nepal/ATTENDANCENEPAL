'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { ChevronLeftIcon, ChevronRightIcon, StatusTag, type TagTone } from '@/components/employee/parts';
import { buildPeriodOptions, currentSystemYearMonth, formatAdDate, formatDdMmYyyy, systemPeriod, type CalendarPeriod } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatHoursMinutes, nepalTodayIso, type DailyShiftByDate, type WeeklyPatternByEmployee } from '@/lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning, type DayDetail, type SalaryMode } from '@/lib/payrollDetail';
import { fetchMyCompanyWeekOffConfig, holidayDatesInRange, weekOffDatesInRange } from '@/lib/weekOff';
import { fetchCompanyPayrollFormat } from '@/lib/payrollFormat';

/** Decimal hours -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

export default function MyPayrollPage() {
  usePageTitle('Payroll');
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<CalendarPeriod>(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  });
  const [dataRange, setDataRange] = useState<{ earliest: Date; latest: Date } | null>(null);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [lifetimeSummaries, setLifetimeSummaries] = useState<PayrollSummary[]>([]);
  const [lifetimeLogs, setLifetimeLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ weekday: number; shift_id: string | null }[]>([]);
  // No otHoursPerDay/otMultiplier controls on this page (those are an
  // admin-only setting on the Payroll page) — loaded from the same
  // company-saved default the admin side reads/writes, so this employee's
  // own "Received" figure actually matches what they'd see on their detail
  // page, not just a hardcoded guess at what an admin might have set.
  const [otHoursPerDay, setOtHoursPerDay] = useState(8);
  const [otMultiplier, setOtMultiplier] = useState(1.5);
  // PF/SSF/TDS are one company-wide rate each (companies.pf_rate/…), set on
  // the admin Salary Structure page — read here so this employee's deduction
  // lines match what the admin sees.
  const [pfRate, setPfRate] = useState(10);
  const [ssfRate, setSsfRate] = useState(11);
  const [tdsRate, setTdsRate] = useState(0);
  // Pay basis — 'flat' for the fixed-salary Staff Salary Sheet customer,
  // per-hour for everyone else. Keeps this page's figures in step with the
  // admin's Payroll report and the employee's own breakdown page.
  const [salaryMode, setSalaryMode] = useState<SalaryMode>('hourly');

  const { start, end } = period;

  useEffect(() => {
    fetchCompanyPayrollFormat().then(f => setSalaryMode(f === 'staff_salary_sheet' ? 'flat' : 'hourly'));
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, otHoursPerDay, otMultiplier, pfRate, ssfRate, tdsRate }) => {
      setWeeklyOffDay(weeklyOffDay);
      setOtHoursPerDay(otHoursPerDay);
      setOtMultiplier(otMultiplier);
      setPfRate(pfRate);
      setSsfRate(ssfRate);
      setTdsRate(tdsRate);
    });
    // Not date-scoped (a pattern applies to every week) — see
    // resolveShiftForDate(), which always falls back to it.
    if (employeeId) {
      supabase
        .from('employee_weekly_pattern')
        .select('weekday, shift_id')
        .eq('employee_id', employeeId)
        .then(({ data }) => setWeeklyPatternRows(data ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  // Toggling AD/BS resets to "this month" in the newly active system — the
  // previously selected month rarely has an equivalent boundary in the
  // other system. Mirrors the admin Payroll page.
  useEffect(() => {
    const { year, month } = currentSystemYearMonth(system);
    setPeriod(systemPeriod(system, year, month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  // This employee's own oldest/newest punch — bounds the period dropdown to
  // months that actually have data for them.
  useEffect(() => {
    if (!employeeId) return;
    Promise.all([
      supabase.from('attendance_logs').select('punch_time').eq('employee_id', employeeId).order('punch_time', { ascending: true }).limit(1),
      supabase.from('attendance_logs').select('punch_time').eq('employee_id', employeeId).order('punch_time', { ascending: false }).limit(1),
    ]).then(([earliestRes, latestRes]) => {
      const earliest = earliestRes.data?.[0]?.punch_time;
      const latest = latestRes.data?.[0]?.punch_time;
      if (!earliest || !latest) {
        setDataRange(null);
        return;
      }
      setDataRange({ earliest: new Date(earliest), latest: new Date(latest) });
    });
  }, [employeeId]);

  const periodOptions = useMemo(() => buildPeriodOptions(system, dataRange, period), [system, dataRange, period]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (!profile?.employee_id) return;
      setEmployeeId(profile.employee_id);
      const [{ data: emp }, { data: shiftRows }] = await Promise.all([
        supabase.from('employees').select('*').eq('id', profile.employee_id).single(),
        supabase.from('shifts').select('*'),
      ]);
      setEmployee(emp ?? null);
      setShifts(shiftRows ?? []);
    });
  }, []);

  // Same data + same live-calc fallback the admin Payroll/Attendance Report
  // pages use: payroll_summaries where the nightly job has already run,
  // computeDayStatus() against raw punches where it hasn't — so today's
  // punch shows up here immediately instead of only after that job runs.
  useEffect(() => {
    if (!employeeId) return;
    supabase
      .from('payroll_summaries')
      .select(PAYROLL_SUMMARY_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('work_date', start)
      .lte('work_date', end)
      .then(({ data }) => setSummaries(data ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('punch_time', `${start}T00:00:00Z`)
      .lte('punch_time', `${end}T23:59:59Z`)
      .then(({ data }) => setLogs(data ?? []));
  }, [employeeId, start, end]);

  // Full employment history (date of joining -> today), independent of
  // whichever period is selected above — feeds the "Total Earned" lifetime
  // figure, which always means everything earned from the company to date,
  // not just the currently viewed period.
  useEffect(() => {
    if (!employeeId || !employee?.date_of_joining) return;
    const from = employee.date_of_joining;
    const today = nepalTodayIso();
    supabase
      .from('payroll_summaries')
      .select(PAYROLL_SUMMARY_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('work_date', from)
      .lte('work_date', today)
      .then(({ data }) => setLifetimeSummaries(data ?? []));
    supabase
      .from('attendance_logs')
      .select(ATTENDANCE_LOG_COLUMNS)
      .eq('employee_id', employeeId)
      .gte('punch_time', `${from}T00:00:00Z`)
      .then(({ data }) => setLifetimeLogs(data ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('work_date, shift_id')
      .eq('employee_id', employeeId)
      .gte('work_date', from)
      .lte('work_date', today)
      .then(({ data }) => setDailyShiftRows(data ?? []));
    supabase.from('company_holidays').select('*').gte('holiday_date', from).lte('holiday_date', today).then(({ data }) => setHolidays(data ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', from)
      .then(({ data }) => setLeaveRequests(data ?? []));
  }, [employeeId, employee?.date_of_joining]);

  // One combined set of paid-off dates spanning this employee's whole
  // employment history — reused for both the selected period's rows and the
  // lifetime rows below (a Set containing dates outside the immediate range
  // being iterated is harmless, .has() just never matches them).
  const paidOffDates = useMemo(() => {
    if (!employee?.date_of_joining) return new Set<string>();
    const today = nepalTodayIso();
    const set = weekOffDatesInRange(employee.date_of_joining, today, weeklyOffDay, holidays, employee.gender);
    for (const req of leaveRequests) {
      const cur = new Date(req.start_date + 'T00:00:00Z');
      const endDate = new Date(req.end_date + 'T00:00:00Z');
      while (cur <= endDate) {
        set.add(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    return set;
  }, [employee?.date_of_joining, employee?.gender, weeklyOffDay, holidays, leaveRequests]);

  // Holiday dates only (no weekly recurring day, no leave) — so a punchless
  // holiday gets its own 'Holiday' label instead of the generic 'Week Off'
  // that paidOffDates (week-off + holiday + leave, all folded together for
  // the pay math) would otherwise give it.
  const holidayDates = useMemo(
    () => holidayDatesInRange(holidays, employee?.gender ?? null),
    [holidays, employee?.gender]
  );

  // employeeId -> work_date -> shift_id, covering this employee's whole
  // employment history so it's valid for both the selected period's rows
  // and the lifetime rows below.
  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    if (!employeeId) return map;
    const perDate = new Map<string, string | null>();
    for (const r of dailyShiftRows) perDate.set(r.work_date, r.shift_id);
    map.set(employeeId, perDate);
    return map;
  }, [dailyShiftRows, employeeId]);

  const weeklyPattern: WeeklyPatternByEmployee = useMemo(() => {
    const map: WeeklyPatternByEmployee = new Map();
    if (!employeeId) return map;
    const perWeekday = new Map<number, string | null>();
    for (const r of weeklyPatternRows) perWeekday.set(r.weekday, r.shift_id);
    map.set(employeeId, perWeekday);
    return map;
  }, [weeklyPatternRows, employeeId]);

  // Same shared day-by-day builder the admin Payroll employee detail page
  // uses, so this page's figures are never a second, independently-computed
  // version of the same numbers — both read through lib/payrollDetail.ts.
  const dayRows: DayDetail[] = useMemo(
    () =>
      employee
        ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, undefined, weeklyPattern, holidayDates)
        : [],
    [employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, weeklyPattern, holidayDates]
  );
  // Company Week-offs / holidays only (no leave), across the whole employment
  // history — the pay math treats these as non-working days, exactly as the
  // admin Payroll report does. `.has()` on out-of-range dates never matches.
  const companyOffDates = useMemo(() => {
    if (!employee?.date_of_joining) return new Set<string>();
    return weekOffDatesInRange(employee.date_of_joining, nepalTodayIso(), weeklyOffDay, holidays, employee.gender ?? null);
  }, [employee?.date_of_joining, employee?.gender, weeklyOffDay, holidays]);

  const countOffDates = (s: string, e: string) => {
    let n = 0;
    for (const dt of companyOffDates) if (dt >= s && dt <= e) n += 1;
    return n;
  };
  const workingDaysBetween = (s: string, e: string) =>
    Math.max(1, Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86400000 + 1) - countOffDates(s, e));

  const periodWorkingDays = useMemo(() => workingDaysBetween(start, end), [start, end, companyOffDates]);

  // One day's earned pay for the selected period, on the same basis as the
  // admin's Payroll report and the employee's breakdown page.
  const earnOf = (r: DayDetail) =>
    dailySalaryEarning(r, employee?.salary ?? null, {
      workingDays: periodWorkingDays,
      otHoursPerDay,
      otMultiplier,
      otOn: true,
      mode: salaryMode,
      isCompanyOffDay: companyOffDates.has(r.date),
      today: nepalTodayIso(),
    });

  const lifetimeDayRows: DayDetail[] = useMemo(
    () =>
      employee?.date_of_joining
        ? buildEmployeeDayRows(
            employee,
            shifts,
            lifetimeSummaries,
            lifetimeLogs,
            employee.date_of_joining,
            nepalTodayIso(),
            dailyShiftByDate,
            paidOffDates,
            undefined,
            weeklyPattern,
            holidayDates
          )
        : [],
    [employee, shifts, lifetimeSummaries, lifetimeLogs, dailyShiftByDate, paidOffDates, weeklyPattern, holidayDates]
  );

  // Prorates each day against the actual number of days in ITS OWN calendar
  // month (unlike the period-scoped totals above, which prorate against the
  // currently selected period's length) — a joining-to-date total spans many
  // months, each with its own day count.
  const totalEarned = useMemo(() => {
    if (employee?.salary == null) return null;
    const byMonth = new Map<string, DayDetail[]>();
    for (const row of lifetimeDayRows) {
      const key = row.date.slice(0, 7);
      const list = byMonth.get(key);
      if (list) list.push(row);
      else byMonth.set(key, [row]);
    }
    let total = 0;
    for (const [key, rows] of byMonth) {
      const [y, m] = key.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const mWorkingDays = workingDaysBetween(`${key}-01`, `${key}-${String(daysInMonth).padStart(2, '0')}`);
      for (const row of rows) {
        const earning = dailySalaryEarning(row, employee.salary, {
          workingDays: mWorkingDays,
          otHoursPerDay,
          otMultiplier,
          otOn: true,
          mode: salaryMode,
          isCompanyOffDay: companyOffDates.has(row.date),
          today: nepalTodayIso(),
        });
        if (earning) total += earning.total;
      }
    }
    return Math.round(total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifetimeDayRows, employee, companyOffDates, otHoursPerDay, otMultiplier, salaryMode]);

  const totals = useMemo(() => {
    const totalHours = dayRows.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = dayRows.reduce((s, r) => s + r.overtime, 0);
    const lateDays = dayRows.filter(r => r.status === 'Late').length;
    const earlyDays = dayRows.filter(r => r.earlyMinutes > 0).length;
    const presentDays = dayRows.filter(r => r.checkIn).length;
    const absentDays = dayRows.filter(r => r.status === 'Absent').length;
    const paidOffDays = dayRows.filter(r => r.status === 'Week Off' || r.status === 'Holiday').length;
    let baseEarning = 0;
    let overtimeEarning = 0;
    for (const r of dayRows) {
      const earning = earnOf(r);
      if (earning) {
        baseEarning += earning.base;
        overtimeEarning += earning.overtime;
      }
    }
    return {
      totalHours,
      overtimeHours,
      presentDays,
      lateDays,
      earlyDays,
      absentDays,
      paidOffDays,
      totalSalary: baseEarning + overtimeEarning,
      overtimeEarning,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayRows, employee, periodWorkingDays, companyOffDates, otHoursPerDay, otMultiplier, salaryMode]);

  // Payslip-style breakdown for the selected period. Basic Salary is the
  // attendance-prorated base earning (same figure "Receivable" used to show
  // before OT); Allowance scales by that same attendance fraction so a
  // partial/absent period doesn't pay a full allowance. PF/SSF/TDS are each
  // a % of Basic Salary (not Allowance) — the common convention — at the
  // company-wide rate set on the admin Salary Structure page.
  const breakdown = useMemo(() => {
    if (employee?.salary == null) return null;
    const basic = Math.round(totals.totalSalary - totals.overtimeEarning);
    const earnedFraction = employee.salary > 0 ? basic / employee.salary : 0;
    const allowance = Math.round((employee.allowance ?? 0) * earnedFraction);
    const total = basic + allowance;
    const pf = Math.round((basic * pfRate) / 100);
    const ssf = Math.round((basic * ssfRate) / 100);
    const ot = Math.round(totals.overtimeEarning);
    const tds = Math.round((basic * tdsRate) / 100);
    const totalSalary = total + ot - pf - ssf - tds;
    return { basic, allowance, total, pf, ssf, ot, tds, totalSalary };
  }, [employee, totals, pfRate, ssfRate, tdsRate]);

  const chartData = useMemo(
    () =>
      dayRows.map(r => {
        const earning = r.checkIn || r.paidOff ? earnOf(r) : null;
        return {
          label: formatDdMmYyyy(r.date, system).slice(0, 2),
          earning: earning ? Math.round(earning.total) : 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayRows, system, employee, periodWorkingDays, companyOffDates, otHoursPerDay, otMultiplier, salaryMode]
  );

  // The period stepper steps through the same list the dropdown offers.
  const periodIdx = periodOptions.findIndex(o => o.key === period.key);
  const prevPeriod = periodIdx > 0 ? periodOptions[periodIdx - 1] : null;
  const nextPeriod = periodIdx >= 0 && periodIdx < periodOptions.length - 1 ? periodOptions[periodIdx + 1] : null;
  const rangeText = `${formatDdMmYyyy(start, system)} to ${formatDdMmYyyy(end, system)}`;

  // The best-paid day of the period, for the trend card's caption.
  const peak = useMemo(() => {
    let best: { date: string; value: number } | null = null;
    for (let i = 0; i < dayRows.length; i++) {
      const v = chartData[i]?.earning ?? 0;
      if (v > 0 && (best === null || v > best.value)) best = { date: dayRows[i].date, value: v };
    }
    return best;
  }, [dayRows, chartData]);

  // Days up to today are listed; the rest of the period collapses into one line.
  const todayKey = nepalTodayIso();
  const pastRows = dayRows.filter(r => r.date <= todayKey);
  const upcomingRows = dayRows.filter(r => r.date > todayKey);
  const gross = breakdown ? breakdown.total + breakdown.ot : 0;
  const deductions = breakdown ? breakdown.pf + breakdown.ssf + breakdown.tds : 0;
  const shortDate = (key: string) => formatDdMmYyyy(key, system).slice(0, 5);
  const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

  const stepper = (onDark: boolean) => (
    <PeriodStepper
      onDark={onDark}
      label={period.label}
      value={period.key}
      options={periodOptions}
      onPick={key => {
        const found = periodOptions.find(o => o.key === key);
        if (found) setPeriod(found);
      }}
      onPrev={prevPeriod ? () => setPeriod(prevPeriod) : null}
      onNext={nextPeriod ? () => setPeriod(nextPeriod) : null}
    />
  );

  // The phone shows the app's tiles, in the app's order.
  const tiles = breakdown
    ? [
        { label: 'Basic Salary', value: breakdown.basic, tone: 'good', cls: 'order-1' },
        { label: 'Allowance', value: breakdown.allowance, tone: 'info', cls: 'order-2' },
        { label: 'Total', value: breakdown.total, tone: 'accent', cls: 'order-3' },
        { label: 'OT', value: breakdown.ot, tone: 'info', cls: 'order-6' },
        { label: 'PF', value: breakdown.pf, tone: 'critical', negative: true, cls: 'order-4' },
        { label: 'SSF', value: breakdown.ssf, tone: 'critical', negative: true, cls: 'order-5' },
        { label: 'TDS', value: breakdown.tds, tone: 'critical', negative: true, cls: 'order-7' },
        { label: 'Total Salary', value: breakdown.totalSalary, tone: 'warning', bold: true, cls: 'order-8' },
      ]
    : [];

  // The computer shows the pay as a statement: what was earned, what was taken off, what is paid.
  const statement = breakdown ? (
    <section className="hidden rounded-[20px] border border-slate-200 bg-white p-7 lg:block">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold leading-6">Pay statement</h2>
        <span className="text-sm font-semibold text-slate-600">
          {period.label}
          {pastRows.length < dayRows.length ? ` · ${pastRows.length} of ${dayRows.length} days so far` : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-14">
        <div>
          <p className="mb-0.5 mt-[18px] text-[13px] font-extrabold text-brand">Earnings</p>
          <LedgerRow label="Basic salary" hint={`${totals.presentDays} present · ${totals.paidOffDays} paid week-off`} amount={breakdown.basic} />
          <LedgerRow label="Allowance" amount={breakdown.allowance} />
          <LedgerRow label="Overtime" hint={fmtHrs(totals.overtimeHours)} amount={breakdown.ot} />
          <LedgerRow label="Gross" amount={gross} strong top />
        </div>
        <div>
          <p className="mb-0.5 mt-[18px] text-[13px] font-extrabold text-brand">Deductions</p>
          <LedgerRow label="Provident fund" hint={`${pfRate}% of basic`} amount={breakdown.pf} negative />
          <LedgerRow label="Social security fund" hint={`${ssfRate}% of basic`} amount={breakdown.ssf} negative />
          <LedgerRow label="Tax at source" hint={`${tdsRate}% of basic`} amount={breakdown.tds} negative />
          <LedgerRow label="Total deductions" amount={deductions} negative strong top />
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-brand-light px-[22px] py-[18px]">
        <span className="text-lg font-extrabold">Net pay</span>
        <span className="text-4xl font-extrabold leading-[44px] tracking-[-0.02em] text-brand tabular-nums">{breakdown.totalSalary.toLocaleString()}</span>
      </div>
    </section>
  ) : null;

  return (
    <>
      {loading ? (
        <p className="p-4 text-center text-sm text-slate-500">Loading…</p>
      ) : !employeeId ? (
        <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <div className="lg:px-8 lg:pb-10 lg:pt-7">
          {/* Computer: the month stepper and its range sit above the cards. A phone has them under the tiles. */}
          <div className="mb-6 hidden flex-wrap items-center gap-x-4 gap-y-2 lg:flex">
            {stepper(false)}
            <span className="text-sm font-semibold tabular-nums text-slate-600">{rangeText}</span>
          </div>

          <div className="mx-4 mt-4 lg:mx-0 lg:mt-0">
            {employee?.salary != null && breakdown && (
              <div className="lg:hidden">
                <div className="grid grid-cols-2 gap-2">
                  {tiles.map(t => (
                    <SalaryTile key={t.label} {...t} />
                  ))}
                </div>
                <div className="mt-3 flex h-16 flex-col items-center justify-center rounded-xl bg-slate-200">
                  <span className="text-[11px] font-bold uppercase tracking-[0.4px] text-slate-600">Total Earned till date</span>
                  <span className="mt-0.5 text-base font-extrabold">{totalEarned != null ? totalEarned.toLocaleString() : '—'}</span>
                </div>
              </div>
            )}

            <div className="mt-3 lg:hidden">
              {stepper(false)}
              <p className="mt-2 text-center text-xs font-semibold text-slate-500">{rangeText}</p>
            </div>

            <div className="mt-4 flex flex-col gap-4 lg:mt-0 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
              <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
              {statement}
              <section className="min-w-0 lg:rounded-[20px] lg:border lg:border-slate-200 lg:bg-white lg:p-6">
                <h2 className="mb-2 text-base font-extrabold lg:hidden">Daily Breakdown of {period.label}</h2>
                <h2 className="mb-3 hidden text-lg font-extrabold leading-6 lg:block">Daily breakdown</h2>
                {dayRows.length === 0 ? (
                  <p className="mt-2 text-center text-sm text-slate-500">No attendance records for this month yet.</p>
                ) : (
                  <>
                  <div className="overflow-hidden rounded-[14px] border border-slate-200 bg-white lg:hidden">
                    <table className="w-full table-fixed text-center text-xs lg:min-w-[580px] lg:text-left lg:text-sm">
                      <colgroup>
                        <col className="w-[15%] lg:w-[24%]" />
                        <col className="w-[16%] lg:w-[14%]" />
                        <col className="w-[14%]" />
                        <col className="w-[17%] lg:w-[16%]" />
                        <col className="w-[17%] lg:w-[14%]" />
                        <col className="w-[21%] lg:w-[17%]" />
                      </colgroup>
                      <thead>
                        <tr className="h-8 bg-slate-100 text-[10px] uppercase tracking-[0.4px] text-slate-600 lg:h-10 lg:text-[11px] lg:font-extrabold lg:tracking-[0.06em]">
                          <th className="font-bold lg:pl-3 lg:font-extrabold">Date</th>
                          <th className="font-bold lg:font-extrabold">
                            <span className="lg:hidden">Hrs</span>
                            <span className="hidden lg:inline">Hours</span>
                          </th>
                          <th className="font-bold lg:font-extrabold">
                            <span className="lg:hidden">OT</span>
                            <span className="hidden lg:inline">Overtime</span>
                          </th>
                          <th className="font-bold lg:font-extrabold">Status</th>
                          <th className="font-bold lg:font-extrabold">My Salary</th>
                          <th className="font-bold lg:font-extrabold">
                            <span className="lg:hidden">Total (OT)</span>
                            <span className="hidden lg:inline">Total (with OT)</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayRows.map(row => {
                          const earning = row.checkIn || row.paidOff ? earnOf(row) : null;
                          const ddmm = formatDdMmYyyy(row.date, system);
                          return (
                            <tr key={row.date} className="h-[34px] border-t border-slate-100 odd:bg-white even:bg-slate-50 lg:h-11 lg:odd:bg-transparent lg:even:bg-transparent">
                              <td className="lg:pl-3">
                                <span className="lg:hidden">{ddmm.slice(0, 5)}</span>
                                <span className="hidden font-bold lg:inline">{ddmm}</span>
                                <span className="hidden font-semibold text-slate-500 lg:inline"> · {weekdayOf(row.date)}</span>
                              </td>
                              <td className="whitespace-nowrap">{row.checkIn ? fmtHrs(row.hours) : <Dash />}</td>
                              <td className="whitespace-nowrap font-semibold text-[#1d4ed8]">{row.checkIn && row.overtime > 0 ? fmtHrs(row.overtime) : <Dash />}</td>
                              <td>
                                <StatusCell row={row} />
                              </td>
                              <td>{earning ? Math.round(earning.base).toLocaleString() : <Dash />}</td>
                              <td className="font-extrabold text-[#14532d]">{earning ? Math.round(earning.total).toLocaleString() : <Dash />}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="h-[38px] border-t border-slate-200 bg-slate-100 font-extrabold lg:h-12">
                          <td className="lg:pl-3">Total</td>
                          <td className="whitespace-nowrap">{fmtHrs(totals.totalHours)}</td>
                          <td className="whitespace-nowrap text-[#1d4ed8]">{fmtHrs(totals.overtimeHours)}</td>
                          <td className="whitespace-nowrap text-xs">
                            <span className="hidden lg:inline">
                              <span className="text-[#14532d]">{totals.presentDays} P</span> · <span className="text-brand">{totals.paidOffDays} W</span> ·{' '}
                              <span className="text-[#b91c1c]">{totals.absentDays} A</span>
                            </span>
                          </td>
                          <td>{Math.round(totals.totalSalary - totals.overtimeEarning).toLocaleString()}</td>
                          <td className="text-[#14532d]">{Math.round(totals.totalSalary).toLocaleString()}</td>
                        </tr>
                        <tr className="h-8 border-t border-slate-200 bg-slate-100 text-[11px] font-extrabold lg:hidden">
                          <td colSpan={6}>
                            <span className="text-[#14532d]">{totals.presentDays} P</span> · <span className="text-brand">{totals.paidOffDays} W</span> ·{' '}
                            <span className="text-[#b91c1c]">{totals.absentDays} A</span>
                            <span className="ml-2 font-semibold text-slate-500">present · week off · absent</span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="hidden lg:block">
                    <table className="w-full table-fixed text-left">
                      <colgroup>
                        <col style={{ width: '40%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '22%' }} />
                      </colgroup>
                      <thead>
                        <tr className="h-10 bg-slate-100 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-600">
                          <th className="pl-5">Date</th>
                          <th>Worked</th>
                          <th>Overtime</th>
                          <th className="pr-5 text-right">Day pay</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pastRows.map(row => {
                          const earning = row.checkIn || row.paidOff ? earnOf(row) : null;
                          return (
                            <tr key={row.date} className="h-[46px] border-t border-slate-100">
                              <td className="pl-5 text-sm font-extrabold tabular-nums">
                                {shortDate(row.date)}
                                <span className="ml-2 font-semibold text-slate-600">{weekdayOf(row.date)}</span>
                                {!row.checkIn && (row.status === 'Week Off' || row.status === 'Holiday') && (
                                  <span className="ml-2.5 align-middle">
                                    <StatusTag tone="neutral">{row.status === 'Holiday' ? 'Holiday' : 'Week off'}</StatusTag>
                                  </span>
                                )}
                                {!row.checkIn && row.status === 'Absent' && (
                                  <span className="ml-2.5 align-middle">
                                    <StatusTag tone="critical">Absent</StatusTag>
                                  </span>
                                )}
                              </td>
                              <td className="text-sm font-semibold tabular-nums">{row.checkIn ? fmtHrs(row.hours) : <Dash />}</td>
                              <td className="text-sm font-semibold tabular-nums text-info-text">{row.checkIn && row.overtime > 0 ? fmtHrs(row.overtime) : <Dash />}</td>
                              <td className="pr-5 text-right text-sm font-extrabold tabular-nums">{earning ? Math.round(earning.total).toLocaleString() : <Dash />}</td>
                            </tr>
                          );
                        })}
                        {upcomingRows.length > 0 && (
                          <tr className="h-[46px] border-t border-slate-100 bg-slate-50">
                            <td colSpan={4} className="pl-5 text-sm font-semibold tabular-nums text-slate-600">
                              {upcomingRows.length} upcoming {upcomingRows.length === 1 ? 'day' : 'days'} · {shortDate(upcomingRows[0].date)} – {shortDate(upcomingRows[upcomingRows.length - 1].date)}
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="h-[52px] border-t border-slate-300 bg-slate-100 text-sm font-extrabold">
                          <td className="pl-5">Total</td>
                          <td className="tabular-nums">{fmtHrs(totals.totalHours)}</td>
                          <td className="tabular-nums text-info-text">{fmtHrs(totals.overtimeHours)}</td>
                          <td className="pr-5 text-right tabular-nums">{Math.round(totals.totalSalary).toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  </>
                )}
              </section>
              </div>

              <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:gap-6">
                {employee?.salary != null && breakdown && (
                  <section className="hidden rounded-[20px] bg-brand px-7 py-6 text-white lg:block">
                    <div className="text-sm font-bold text-emerald-100">Earned to date</div>
                    <div className="mt-1 text-[44px] font-extrabold leading-[52px] tracking-[-0.02em] tabular-nums">
                      {totalEarned != null ? totalEarned.toLocaleString() : '—'}
                    </div>
                    {employee.date_of_joining && (
                      <div className="mt-0.5 text-sm font-semibold text-emerald-100">Since {formatAdDate(employee.date_of_joining, system)}</div>
                    )}
                  </section>
                )}

                <section className="rounded-[14px] border border-slate-200 bg-white p-3 lg:rounded-[20px] lg:p-6">
                  <h2 className="text-base font-extrabold lg:text-lg lg:leading-6">Earning trend</h2>
                  {peak && (
                    <p className="mb-2 mt-0.5 hidden text-sm font-medium tabular-nums text-slate-600 lg:block">
                      Highest day: {formatDdMmYyyy(peak.date, system).slice(0, 5)} at {peak.value.toLocaleString()}
                    </p>
                  )}
                  <span className="mb-2 block text-[10px] font-semibold text-slate-500 lg:hidden">Scroll to see all days →</span>
                  {chartData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">No data to chart yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <div
                        className="h-40 w-[var(--chart-w)] lg:h-[170px] lg:w-full"
                        style={{ ['--chart-w' as string]: `${Math.max(chartData.length * 30, 320)}px` }}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="#e2e8f0" />
                            <XAxis
                              dataKey="label"
                              tick={{ fontSize: 10, fill: '#586474' }}
                              axisLine={{ stroke: '#e2e8f0' }}
                              tickLine={false}
                              interval="preserveStartEnd"
                              minTickGap={6}
                            />
                            <YAxis tick={{ fontSize: 10, fill: '#586474' }} axisLine={false} tickLine={false} width={36} />
                            <Tooltip
                              contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                              formatter={(v: number) => [v.toLocaleString(), 'Earning']}
                            />
                            <Area type="monotone" dataKey="earning" name="earning" stroke="#047857" strokeWidth={2.25} fill="#047857" fillOpacity={0.1} dot={false} activeDot={{ r: 4 }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </section>

                {dayRows.length > 0 && (
                  <section className="hidden rounded-[20px] border border-slate-200 bg-white p-6 lg:block">
                    <h2 className="text-lg font-extrabold leading-6">This period</h2>
                    <dl className="mt-2.5">
                      <PeriodRow label="Present" value={dayCount(totals.presentDays)} />
                      <PeriodRow label="Week off" value={dayCount(totals.paidOffDays)} />
                      <PeriodRow label="Absent" value={dayCount(totals.absentDays)} />
                      <PeriodRow label="Hours worked" value={fmtHrs(totals.totalHours)} strong />
                      <PeriodRow label="Overtime" value={fmtHrs(totals.overtimeHours)} />
                    </dl>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Weekday from an AD date key — the same in either calendar. */
function weekdayOf(key: string) {
  return new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

/** One line of the pay statement: a label with an optional note, and its amount. */
function LedgerRow({
  label,
  hint,
  amount,
  negative,
  strong,
  top,
}: {
  label: string;
  hint?: string;
  amount: number;
  negative?: boolean;
  strong?: boolean;
  top?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${top ? 'min-h-[54px] border-t border-slate-200' : 'min-h-[58px]'}`}>
      <div>
        <div className={`text-[15px] ${strong ? 'font-extrabold' : 'font-semibold'}`}>{label}</div>
        {hint && <div className="mt-px text-[13px] font-medium text-slate-600">{hint}</div>}
      </div>
      <div className={`text-[15px] tabular-nums ${strong ? 'font-extrabold' : 'font-semibold'}`}>
        {negative && amount > 0 ? '−' : ''}
        {amount.toLocaleString()}
      </div>
    </div>
  );
}

function PeriodRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-t border-slate-100 py-[9px] text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`m-0 tabular-nums ${strong ? 'font-extrabold' : 'font-bold'}`}>{value}</dd>
    </div>
  );
}

function Dash() {
  return <span className="text-slate-400">—</span>;
}

/** Present / Week off / Holiday / Absent: plain coloured text on a phone, a tag on a computer. */
function StatusCell({ row }: { row: DayDetail }) {
  let text: string | null = null;
  let tone: TagTone = 'neutral';
  let color = '';
  if (row.checkIn) {
    text = 'Present';
    tone = 'good';
    color = 'text-[#14532d]';
  } else if (row.status === 'Holiday' || row.status === 'Week Off') {
    text = row.status;
    tone = 'brand';
    color = 'text-brand';
  } else if (row.status === 'Absent') {
    text = 'Absent';
    tone = 'critical';
    color = 'text-[#b91c1c]';
  }
  if (!text) return <Dash />;
  return (
    <>
      <span className={`font-bold lg:hidden ${color}`}>{text}</span>
      <span className="hidden lg:inline">
        <StatusTag tone={tone}>{text}</StatusTag>
      </span>
    </>
  );
}

/** ‹ month ▾ ›. The month label is a real <select> laid invisibly over the text, so it opens the
 * browser's own list on every device. */
function PeriodStepper({
  onDark,
  label,
  value,
  options,
  onPick,
  onPrev,
  onNext,
}: {
  onDark: boolean;
  label: string;
  value: string;
  options: CalendarPeriod[];
  onPick: (key: string) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const arrow = `flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40 lg:h-10 lg:w-10 ${
    onDark ? 'text-white hover:bg-white/10' : 'text-brand hover:bg-slate-50'
  }`;
  return (
    <div
      className={`flex items-center ${
        onDark ? 'rounded-[14px] bg-white/15 p-1' : 'rounded-[14px] border border-slate-200 bg-white p-2 lg:p-[3px]'
      }`}
    >
      <button type="button" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Previous month" className={arrow}>
        <ChevronLeftIcon className="h-[18px] w-[18px]" />
      </button>
      <label
        className={`relative flex h-11 min-w-0 flex-1 items-center justify-center gap-2 text-lg font-extrabold lg:h-10 lg:w-48 lg:flex-none lg:text-base ${
          onDark ? 'text-white' : 'text-ink'
        }`}
      >
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
        <select
          aria-label="Month"
          value={value}
          onChange={e => onPick(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {options.map(o => (
            <option key={o.key} value={o.key} className="text-ink">
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next month" className={arrow}>
        <ChevronRightIcon className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}

const TILE_TONES = {
  good: { bg: 'bg-[#e2f3e8]', text: 'text-[#14532d]' },
  info: { bg: 'bg-[#dbeafe]', text: 'text-[#1d4ed8]' },
  warning: { bg: 'bg-[#ffedd5]', text: 'text-[#c2410c]' },
  critical: { bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]' },
  accent: { bg: 'bg-brand-light', text: 'text-brand' },
} as const;

function SalaryTile({
  label,
  value,
  tone,
  negative,
  bold,
  cls,
}: {
  label: string;
  value: number;
  tone: string;
  negative?: boolean;
  bold?: boolean;
  cls: string;
}) {
  const { bg, text } = TILE_TONES[tone as keyof typeof TILE_TONES];
  return (
    <div className={`flex h-16 flex-col items-center justify-center rounded-xl px-3 ${bg} ${cls}`}>
      <span className={`text-[11px] font-bold uppercase tracking-[0.4px] ${text}`}>{label}</span>
      <span className={`mt-0.5 font-extrabold ${bold ? 'text-lg' : 'text-base'}`}>
        {negative && value > 0 ? '−' : ''}
        {value.toLocaleString()}
      </span>
    </div>
  );
}
