'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import Badge from '@/components/Badge';
import TimingPair, { TimingCell } from '@/components/PunctualityCell';
import StatusText from '@/components/StatusText';
import { ChevronLeftIcon, ChevronRightIcon, PageBody } from '@/components/employee/parts';
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
  const shortDate = (key: string) => formatDdMmYyyy(key, system).slice(0, 5);
  const upcomingText = upcomingRows.length > 0 ? `${upcomingRows.length} upcoming ${upcomingRows.length === 1 ? 'day' : 'days'} · ${shortDate(upcomingRows[0].date)} – ${shortDate(upcomingRows[upcomingRows.length - 1].date)}` : null;
  const gross = breakdown ? breakdown.total + breakdown.ot : 0;
  const deductions = breakdown ? breakdown.pf + breakdown.ssf + breakdown.tds : 0;

  const stepper = (
    <PeriodStepper
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

  const scored = totals.presentDays + totals.absentDays;
  const attendancePct = scored ? Math.round((totals.presentDays / scored) * 1000) / 10 : 0;
  const attendanceTone = attendancePct >= 75 ? 'good' : attendancePct >= 50 ? 'warning' : 'critical';
  const money = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());
  const initials = (employee?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join('');

  if (loading) return <p className="p-4 text-center text-sm text-slate-500">Loading…</p>;
  if (!employeeId) return <p className="p-4 pt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>;

  return (
    <PageBody>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent p-4 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-white">{initials || '?'}</span>
          <div>
            <h2 className="text-lg font-bold text-ink">{employee?.name ?? 'My payroll'}</h2>
            <p className="text-xs font-bold text-black">ENROLL ID {employee?.fingerprint_id ?? '—'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {stepper}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
            <CalendarGlyph className="h-3.5 w-3.5 shrink-0 text-accent" />
            {rangeText}
          </div>
          {employee?.salary != null && totalEarned != null && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm" title={employee.date_of_joining ? `Since ${formatAdDate(employee.date_of_joining, system)}` : undefined}>
              Earned to date <span className="font-bold text-good-text">{totalEarned.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* The five figures are one green; only Attendance changes colour, with how well the month went. */}
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Basic Salary</span>
          <div className="mt-1 text-base font-bold text-good-text">{money(breakdown?.basic)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">{periodWorkingDays} working days</div>
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">OT Salary</span>
          <div className="mt-1 text-base font-bold text-good-text">{money(breakdown?.ot)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">This period</div>
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Net Pay</span>
          <div className="mt-1 text-base font-bold text-good-text">{money(breakdown?.totalSalary)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">After deductions</div>
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Overtime</span>
          <div className="mt-1 text-base font-bold text-good-text">{fmtHrs(totals.overtimeHours)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">This period</div>
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Total Hours</span>
          <div className="mt-1 text-base font-bold text-good-text">{fmtHrs(totals.totalHours)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">This period</div>
        </div>
        <div className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${ATTENDANCE_TILE[attendanceTone].box}`}>
          <span className={`text-xs font-medium ${ATTENDANCE_TILE[attendanceTone].label}`}>Attendance</span>
          <div className={`mt-1 text-base font-bold ${ATTENDANCE_TILE[attendanceTone].value}`}>{attendancePct}%</div>
          <div className={`mt-0.5 text-[11px] ${ATTENDANCE_TILE[attendanceTone].sub}`}>
            {totals.presentDays}P / {totals.paidOffDays}W / {totals.absentDays}A
          </div>
        </div>
      </div>

      {breakdown && (
        <section aria-label="Pay statement" className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Pay statement</h2>
            <span className="text-xs text-slate-500">
              {period.label}
              {pastRows.length < dayRows.length ? ` · ${pastRows.length} of ${dayRows.length} days so far` : ''}
            </span>
          </div>
          <div className="mt-3 grid gap-x-10 gap-y-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Earnings</p>
              <LedgerRow label="Basic salary" hint={`${totals.presentDays} present · ${totals.paidOffDays} paid week-off`} amount={breakdown.basic} />
              <LedgerRow label="Allowance" amount={breakdown.allowance} />
              <LedgerRow label="Overtime" hint={fmtHrs(totals.overtimeHours)} amount={breakdown.ot} />
              <LedgerRow label="Gross" amount={gross} strong />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions</p>
              <LedgerRow label="Provident fund" hint={`${pfRate}% of basic`} amount={breakdown.pf} negative />
              <LedgerRow label="Social security fund" hint={`${ssfRate}% of basic`} amount={breakdown.ssf} negative />
              <LedgerRow label="Tax at source" hint={`${tdsRate}% of basic`} amount={breakdown.tds} negative />
              <LedgerRow label="Total deductions" amount={deductions} negative strong />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-good-bg px-4 py-3">
            <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Net Pay</span>
            <span className="text-xl font-bold tabular-nums text-good-text">{breakdown.totalSalary.toLocaleString()}</span>
          </div>
        </section>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="md:hidden">
          <table className="w-full table-fixed text-center text-[10px]">
            <colgroup>
              <col className="w-[11%]" />
              <col className="w-[20%]" />
              <col className="w-[15%]" />
              <col className="w-[14%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
                <th className="truncate px-0.5 py-1 font-medium">Date</th>
                <th className="truncate px-0.5 py-1 font-medium">In / Out</th>
                <th className="truncate px-0.5 py-1 font-medium">Late / Early</th>
                <th className="truncate px-0.5 py-1 font-medium">Status</th>
                <th className="truncate px-0.5 py-1 font-medium">OT</th>
                <th className="truncate px-0.5 py-1 font-medium">Hrs</th>
                <th className="truncate px-0.5 py-1 font-medium">Salary</th>
              </tr>
            </thead>
            <tbody>
              {pastRows.map((d, i) => {
                const earning = d.checkIn || d.paidOff ? earnOf(d) : null;
                return (
                  <tr key={d.date} className={`border-b border-slate-100 last:border-0 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                    <td className="truncate px-0.5 py-0.5 text-ink">{formatDdMmYyyy(d.date, system).slice(0, 5)}</td>
                    <td className="whitespace-normal break-words px-0.5 py-0.5 leading-tight text-slate-600">
                      {d.checkIn ? fmtTime(d.checkIn) : '–:–'} – {d.checkOut ? fmtTime(d.checkOut) : '–:–'}
                    </td>
                    <td className="whitespace-normal break-words px-0.5 py-0.5 font-medium leading-tight">
                      <TimingPair lateMinutes={d.lateMinutes} earlyArrivalMinutes={d.earlyArrivalMinutes} earlyMinutes={d.earlyMinutes} lateDepartureMinutes={d.lateDepartureMinutes} />
                    </td>
                    <td className="truncate px-0.5 py-0.5 font-medium">
                      <StatusText checkIn={d.checkIn} status={d.status} />
                    </td>
                    <td className="whitespace-normal break-words px-0.5 py-0.5 leading-tight text-info-text">{fmtHrs(d.overtime)}</td>
                    <td className="whitespace-normal break-words px-0.5 py-0.5 leading-tight text-slate-600">{fmtHrs(d.hours)}</td>
                    <td className="whitespace-normal break-words px-0.5 py-0.5 font-semibold leading-tight text-good-text">{earning ? Math.round(earning.total).toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
              {upcomingText && (
                <tr className="border-b border-slate-100 bg-slate-50">
                  <td colSpan={7} className="px-2 py-1.5 text-center text-slate-500">
                    {upcomingText}
                  </td>
                </tr>
              )}
              {dayRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-slate-400">
                    No attendance records for this month yet.
                  </td>
                </tr>
              )}
            </tbody>
            {dayRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-ink">
                  <td className="truncate px-0.5 py-1 text-left font-semibold" colSpan={3}>
                    Total
                  </td>
                  <td className="truncate px-0.5 py-1 text-[9px] font-semibold">
                    <span className="text-good-text">{totals.presentDays}P</span> / <span className="text-accent">{totals.paidOffDays}W</span> / <span className="text-critical-text">{totals.absentDays}A</span>
                  </td>
                  <td className="whitespace-normal break-words px-0.5 py-1 font-semibold leading-tight text-info-text">{fmtHrs(totals.overtimeHours)}</td>
                  <td className="whitespace-normal break-words px-0.5 py-1 font-semibold leading-tight">{fmtHrs(totals.totalHours)}</td>
                  <td className="whitespace-normal break-words px-0.5 py-1 font-semibold leading-tight text-good-text">{Math.round(totals.totalSalary).toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="hidden overflow-x-auto pb-2 md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-3 py-2 font-medium">Date</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">In / Out</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Total Hours</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Overtime</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Check-In</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Check-Out</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">My Salary</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">OT Salary</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Total Salary</th>
              </tr>
            </thead>
            <tbody>
              {pastRows.map((d, i) => {
                const earning = d.checkIn || d.paidOff ? earnOf(d) : null;
                return (
                  <tr key={d.date} className={`border-b border-slate-100 last:border-0 hover:bg-slate-100 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatAdDate(d.date, system)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {d.checkIn ? fmtTime(d.checkIn) : '–:–'} – {d.checkOut ? fmtTime(d.checkOut) : '–:–'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {fmtHrs(d.hours)}
                      {d.pending && <span className="ml-1 text-[10px] text-slate-400">(live)</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{fmtHrs(d.overtime)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <TimingCell lateMinutes={d.lateMinutes} earlyMinutes={d.earlyArrivalMinutes} lateClass="text-warning-text" earlyClass="text-good-text" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <TimingCell lateMinutes={d.lateDepartureMinutes} earlyMinutes={d.earlyMinutes} lateClass="text-info-text" earlyClass="text-critical-text" />
                    </td>
                    <td className="px-3 py-2">{statusBadge(d)}</td>
                    <td className="px-3 py-2 text-slate-600">{earning ? Math.round(earning.base).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{earning ? Math.round(earning.overtime).toLocaleString() : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-bold text-good-text">{earning ? Math.round(earning.total).toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
              {upcomingText && (
                <tr className="border-b border-slate-100 bg-slate-50">
                  <td colSpan={10} className="px-3 py-2.5 text-slate-500">
                    {upcomingText}
                  </td>
                </tr>
              )}
              {dayRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    No attendance records for this month yet.
                  </td>
                </tr>
              )}
            </tbody>
            {dayRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-sm font-bold text-ink">
                  <td colSpan={2} className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtHrs(totals.totalHours)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtHrs(totals.overtimeHours)}</td>
                  <td colSpan={2} />
                  <td className="whitespace-nowrap px-3 py-2 text-xs font-semibold">
                    <span className="text-good-text">{totals.presentDays}P</span>
                    {' / '}
                    <span className="text-accent">{totals.paidOffDays}W</span>
                    {' / '}
                    <span className="text-critical-text">{totals.absentDays}A</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{Math.round(totals.totalSalary - totals.overtimeEarning).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2">{Math.round(totals.overtimeEarning).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-good-text">{Math.round(totals.totalSalary).toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <section aria-label="Earning trend" className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Earning trend</h2>
          {peak && (
            <span className="text-xs tabular-nums text-slate-500">
              Highest day: {formatDdMmYyyy(peak.date, system).slice(0, 5)} at {peak.value.toLocaleString()}
            </span>
          )}
        </div>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No data to chart yet.</p>
        ) : (
          <div className="overflow-x-auto">
            {/* text-accent so the line and fill (currentColor) are the theme green */}
            <div className="h-44 w-[var(--chart-w)] text-accent lg:w-full" style={{ ['--chart-w' as string]: `${Math.max(chartData.length * 30, 320)}px` }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v: number) => [v.toLocaleString(), 'Earning']} />
                  <Area type="monotone" dataKey="earning" name="earning" stroke="currentColor" strokeWidth={2} fill="currentColor" fillOpacity={0.1} dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>
    </PageBody>
  );
}

const ATTENDANCE_TILE = {
  good: { box: 'bg-good-bg ring-good/10', label: 'text-good-text/80', value: 'text-good-text', sub: 'text-good-text/70' },
  warning: { box: 'bg-warning-bg ring-warning/10', label: 'text-warning-text/80', value: 'text-warning-text', sub: 'text-warning-text/70' },
  critical: { box: 'bg-critical-bg ring-critical/10', label: 'text-critical-text/80', value: 'text-critical-text', sub: 'text-critical-text/70' },
} as const;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Present / Holiday / Week Off / Leave / Upcoming / Absent as a badge, the same as the admin's detail page. */
function statusBadge(d: DayDetail) {
  if (d.checkIn) return <Badge tone="good">Present</Badge>;
  if (d.status === 'Holiday') return <Badge tone="neutral">Holiday</Badge>;
  if (d.status === 'Week Off') return <Badge tone="neutral">Week Off</Badge>;
  if (d.status === 'Leave') return <Badge tone="info">Leave</Badge>;
  if (d.status === 'Upcoming') return <Badge tone="neutral">Upcoming</Badge>;
  return <Badge tone="critical">Absent</Badge>;
}

/** One line of the pay statement: a label with an optional note, and its amount. */
function LedgerRow({ label, hint, amount, negative, strong }: { label: string; hint?: string; amount: number; negative?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-slate-100 py-2 text-sm first:mt-1">
      <div>
        <span className={strong ? 'font-semibold text-ink' : 'text-slate-600'}>{label}</span>
        {hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}
      </div>
      <div className={`tabular-nums ${strong ? 'font-bold text-ink' : 'font-medium text-ink'}`}>
        {negative && amount > 0 ? '−' : ''}
        {amount.toLocaleString()}
      </div>
    </div>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** ‹ month ▾ ›. The month label is a real <select> laid invisibly over the text, so it opens the
 * browser's own list on every device. */
function PeriodStepper({
  label,
  value,
  options,
  onPick,
  onPrev,
  onNext,
}: {
  label: string;
  value: string;
  options: CalendarPeriod[];
  onPick: (key: string) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const arrow = 'flex h-9 w-9 shrink-0 items-center justify-center text-accent hover:bg-slate-50 disabled:opacity-40';
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-accent/30 bg-white shadow-sm">
      <button type="button" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Previous month" className={arrow}>
        <ChevronLeftIcon className="h-4 w-4" />
      </button>
      <label className="relative flex h-9 min-w-[8.5rem] items-center justify-center gap-1.5 px-2 text-sm font-bold text-ink">
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
        <select aria-label="Month" value={value} onChange={e => onPick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {options.map(o => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next month" className={arrow}>
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
