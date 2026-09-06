'use client';

import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import { buildPeriodOptions, currentSystemYearMonth, formatDdMmYyyy, systemPeriod, type CalendarPeriod } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatHoursMinutes, nepalTodayIso, type DailyShiftByDate, type WeeklyPatternByEmployee } from '@/lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning, type DayDetail } from '@/lib/payrollDetail';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '@/lib/weekOff';

/** Decimal hours -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

export default function MyPayrollPage() {
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

  const { start, end } = period;

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode, otHoursPerDay, otMultiplier, pfRate, ssfRate, tdsRate }) => {
      setWeeklyOffDay(weeklyOffDay);
      setOtHoursPerDay(otHoursPerDay);
      setOtMultiplier(otMultiplier);
      setPfRate(pfRate);
      setSsfRate(ssfRate);
      setTdsRate(tdsRate);
      // Not date-scoped (a pattern applies to every week), and only ever
      // relevant in 'weekly' roster_mode — see resolveShiftForDate().
      if (rosterMode === 'weekly' && employeeId) {
        supabase
          .from('employee_weekly_pattern')
          .select('weekday, shift_id')
          .eq('employee_id', employeeId)
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
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
      employee ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, undefined, weeklyPattern) : [],
    [employee, shifts, summaries, logs, start, end, dailyShiftByDate, paidOffDates, weeklyPattern]
  );
  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);

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
            weeklyPattern
          )
        : [],
    [employee, shifts, lifetimeSummaries, lifetimeLogs, dailyShiftByDate, paidOffDates, weeklyPattern]
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
      for (const row of rows) {
        const earning = dailySalaryEarning(row, employee.salary, daysInMonth, otHoursPerDay, otMultiplier, true);
        if (earning) total += earning.total;
      }
    }
    return Math.round(total);
  }, [lifetimeDayRows, employee]);

  const totals = useMemo(() => {
    const totalHours = dayRows.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = dayRows.reduce((s, r) => s + r.overtime, 0);
    const lateDays = dayRows.filter(r => r.status === 'Late').length;
    const earlyDays = dayRows.filter(r => r.earlyMinutes > 0).length;
    const presentDays = dayRows.filter(r => r.checkIn).length;
    const absentDays = dayRows.filter(r => r.status === 'Absent').length;
    const paidOffDays = dayRows.filter(r => r.status === 'Week Off').length;
    let baseEarning = 0;
    let overtimeEarning = 0;
    for (const r of dayRows) {
      const earning = dailySalaryEarning(r, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, true);
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
  }, [dayRows, employee, daysInRange]);

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
        const earning =
          r.checkIn || r.paidOff ? dailySalaryEarning(r, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, true) : null;
        return {
          label: formatDdMmYyyy(r.date, system).slice(0, 2),
          earning: earning ? Math.round(earning.total) : 0,
        };
      }),
    [dayRows, system, employee, daysInRange]
  );

  return (
    <EmployeeShell title="Payroll">
      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employeeId ? (
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <>
          {employee?.salary != null && breakdown && (
            <>
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SalaryTile label="Basic Salary" value={breakdown.basic} tone="good" />
                <SalaryTile label="Allowance" value={breakdown.allowance} tone="info" />
                <SalaryTile label="Total" value={breakdown.total} tone="accent" />
                <SalaryTile label="PF" value={breakdown.pf} tone="critical" negative />
                <SalaryTile label="SSF" value={breakdown.ssf} tone="critical" negative />
                <SalaryTile label="OT" value={breakdown.ot} tone="info" />
                <SalaryTile label="TDS" value={breakdown.tds} tone="critical" negative />
                <SalaryTile label="Total Salary" value={breakdown.totalSalary} tone="warning" bold />
              </div>
              <div className="mb-5 rounded-xl bg-slate-50 p-3 text-center">
                <div className="text-[10px] font-medium uppercase text-slate-500">Total Earned till date</div>
                <div className="text-sm font-bold text-ink">{totalEarned != null ? totalEarned.toLocaleString() : '—'}</div>
              </div>
            </>
          )}

          <div className="mb-4 space-y-2">
            <select
              value={period.key}
              onChange={e => {
                const found = periodOptions.find(o => o.key === e.target.value);
                if (found) setPeriod(found);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-ink"
            >
              {periodOptions.map(o => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
            </div>
          </div>

          <h2 className="mb-2 mt-4 text-sm font-semibold text-ink">Daily Breakdown of {period.label}</h2>
          {dayRows.length === 0 ? (
            <p className="mt-2 text-center text-sm text-slate-400">No attendance records for this month yet.</p>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white">
              <table className="w-full table-fixed text-center text-[11px]">
                <colgroup>
                  <col className="w-[11%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[12%]" />
                  <col className="w-[23%]" />
                  <col className="w-[24%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
                    <th className="truncate px-1 py-1 font-medium">Date</th>
                    <th className="truncate px-0.5 py-1 font-medium">Hrs</th>
                    <th className="truncate px-0.5 py-1 font-medium">OT</th>
                    <th className="truncate px-0.5 py-1 font-medium">Status</th>
                    <th className="truncate px-0.5 py-1 font-medium">My Salary</th>
                    <th className="truncate px-1 py-1 font-medium">Total(OT)</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((row, i) => {
                    const earning =
                      row.checkIn || row.paidOff
                        ? dailySalaryEarning(row, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, true)
                        : null;
                    return (
                      <tr key={row.date} className={`border-b border-slate-100 last:border-0 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                        <td className="truncate px-1 py-0.5 text-ink">{formatDdMmYyyy(row.date, system).slice(0, 5)}</td>
                        <td className="whitespace-nowrap px-0.5 py-0.5 text-slate-600">{row.checkIn ? fmtHrs(row.hours) : '—'}</td>
                        <td className="whitespace-nowrap px-0.5 py-0.5 text-info-text">{row.checkIn ? fmtHrs(row.overtime) : '—'}</td>
                        <td className="truncate px-0.5 py-0.5 font-medium">
                          {row.checkIn ? (
                            <span className="text-good-text">Present</span>
                          ) : row.status === 'Week Off' ? (
                            <span className="text-accent">Week Off</span>
                          ) : row.status === 'Absent' ? (
                            <span className="text-critical-text">Absent</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="truncate px-0.5 py-0.5 text-slate-600">
                          {earning ? Math.round(earning.base).toLocaleString() : '—'}
                        </td>
                        <td className="truncate px-1 py-0.5 font-semibold text-good-text">
                          {earning ? (
                            <>
                              {Math.round(earning.total).toLocaleString()}
                              {earning.overtime > 0 && (
                                <span className="text-info-text">({Math.round(earning.overtime).toLocaleString()})</span>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 text-ink">
                    <td className="truncate px-1 py-1 font-semibold">Total</td>
                    <td className="truncate px-0.5 py-1 font-semibold">{fmtHrs(totals.totalHours)}</td>
                    <td className="truncate px-0.5 py-1 font-semibold text-info-text">{fmtHrs(totals.overtimeHours)}</td>
                    <td className="px-0.5 py-1" />
                    <td className="truncate px-0.5 py-1 font-semibold">
                      {Math.round(totals.totalSalary - totals.overtimeEarning).toLocaleString()}
                    </td>
                    <td className="truncate px-1 py-1 font-bold text-good-text">
                      {Math.round(totals.totalSalary).toLocaleString()}
                      {totals.overtimeEarning > 0 && (
                        <span className="text-info-text">({Math.round(totals.overtimeEarning).toLocaleString()})</span>
                      )}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-200 bg-slate-50 text-ink">
                    <td className="truncate px-1 py-1 font-semibold" colSpan={4}>
                      P/W/A
                    </td>
                    <td className="truncate px-0.5 py-1 font-semibold text-good-text" colSpan={2}>
                      {totals.presentDays} / <span className="text-accent">{totals.paidOffDays}</span> /{' '}
                      <span className="text-critical-text">{totals.absentDays}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="mb-2 mt-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Earning Trend</h2>
            <span className="text-[10px] text-slate-400">Scroll to see all days →</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            {chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No data to chart yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ width: Math.max(chartData.length * 30, 320), height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: '#64748b' }}
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: '#7c3aed' }}
                        axisLine={false}
                        tickLine={false}
                        width={34}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                        formatter={(v: number) => [v.toLocaleString(), 'Earning']}
                      />
                      <Line
                        type="monotone"
                        dataKey="earning"
                        name="earning"
                        stroke="#7c3aed"
                        strokeWidth={2}
                        dot={{ r: 2, fill: '#7c3aed' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </EmployeeShell>
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

const TILE_TONES = {
  good: { bg: 'bg-good-bg', text: 'text-good-text' },
  info: { bg: 'bg-info-bg', text: 'text-info-text' },
  warning: { bg: 'bg-warning-bg', text: 'text-warning-text' },
  critical: { bg: 'bg-critical-bg', text: 'text-critical-text' },
  accent: { bg: 'bg-accent/10', text: 'text-accent' },
} as const;

function SalaryTile({
  label,
  value,
  tone,
  negative,
  bold,
}: {
  label: string;
  value: number;
  tone: keyof typeof TILE_TONES;
  negative?: boolean;
  bold?: boolean;
}) {
  const { bg, text } = TILE_TONES[tone];
  return (
    <div className={`rounded-xl ${bg} p-2.5 text-center`}>
      <div className={`text-[9px] font-medium uppercase ${text}`}>{label}</div>
      <div className={`text-sm ${bold ? 'font-extrabold' : 'font-bold'} text-ink`}>
        {negative && value > 0 ? '-' : ''}
        {value.toLocaleString()}
      </div>
    </div>
  );
}
