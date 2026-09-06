'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import TimingPair, { TimingCell, TimingTotal } from '@/components/PunctualityCell';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import StatusText from '@/components/StatusText';
import { buildMonth, formatAdDate, formatDdMmYyyy, todayAnchor, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatHoursMinutes, type DailyShiftByDate, type WeeklyPatternByEmployee } from '@/lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning, type DayDetail } from '@/lib/payrollDetail';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from '@/lib/weekOff';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from '@/lib/types';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Decimal hours (e.g. d.hours, d.overtime) -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

function statusBadge(d: DayDetail) {
  if (d.checkIn) return <Badge tone="good">Present</Badge>;
  if (d.status === 'Week Off') return <Badge tone="neutral">Week Off</Badge>;
  if (d.status === 'Leave') return <Badge tone="info">Leave</Badge>;
  if (d.status === 'Upcoming') return <Badge tone="neutral">Upcoming</Badge>;
  return <Badge tone="critical">Absent</Badge>;
}

function parseAdKey(value: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

function startOfMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
}

export default function PayrollEmployeeDetailPage() {
  return (
    <Suspense fallback={null}>
      <PayrollEmployeeDetailView />
    </Suspense>
  );
}

function PayrollEmployeeDetailView() {
  const { system } = useCalendarSystem();
  const params = useParams<{ employeeId: string }>();
  const searchParams = useSearchParams();
  const employeeId = params.employeeId;

  // The period and overtime settings come from whichever Payroll page link
  // was clicked — this page has no period picker of its own, it always
  // shows exactly the period the admin was looking at. Falls back to the
  // current AD month + Payroll's own defaults if opened without them.
  const start = searchParams.get('start') ?? startOfMonthIso();
  const end = searchParams.get('end') ?? todayIso();
  const otHoursPerDay = Number(searchParams.get('otHoursPerDay') ?? 8) || 8;
  const otMultiplier = Number(searchParams.get('otMultiplier') ?? 1.5) || 1.5;
  // Overtime pay is optional per employee (some employees just aren't paid
  // extra for it) — on by default, toggled here on the employee's own page.
  // Seeded from the link that opened this page, then owned locally.
  const [otOn, setOtOn] = useState(searchParams.get('otOn') !== 'false');

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ weekday: number; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ weeklyOffDay, rosterMode }) => {
      setWeeklyOffDay(weeklyOffDay);
      // Not date-scoped (a pattern applies to every week), and only ever
      // relevant in 'weekly' roster_mode — see resolveShiftForDate().
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('weekday, shift_id')
          .eq('employee_id', employeeId)
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('employees').select('*').eq('id', employeeId).single(),
      supabase.from('shifts').select('*'),
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end),
      supabase
        .from('attendance_logs')
        .select(ATTENDANCE_LOG_COLUMNS)
        .eq('employee_id', employeeId)
        .gte('punch_time', `${start}T00:00:00Z`)
        .lte('punch_time', `${end}T23:59:59Z`),
      supabase
        .from('employee_daily_shifts')
        .select('work_date, shift_id')
        .eq('employee_id', employeeId)
        .gte('work_date', start)
        .lte('work_date', end),
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

  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);
  const monthLabel = useMemo(() => buildMonth(system, parseAdKey(start) ?? todayAnchor()).label, [system, start]);
  // The flat "salary ÷ days in period" rate — same figure on every row,
  // shown for reference next to My Salary/OT Salary which are earned per
  // hour instead (see dailySalaryEarning() in lib/payrollDetail.ts).
  const salaryPerDay = useMemo(() => (employee?.salary != null ? employee.salary / daysInRange : null), [employee, daysInRange]);

  // Gender-scoped holidays (e.g. Teej) count as a paid day off only for the
  // employees they cover — see weekOffDatesInRange().
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
    () =>
      employee
        ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end, dailyShiftByDate, weekOffDates, leaveDates, weeklyPattern)
        : [],
    [employee, shifts, summaries, logs, start, end, dailyShiftByDate, weekOffDates, leaveDates, weeklyPattern]
  );

  const dayTotals = useMemo(() => {
    let hours = 0;
    let overtime = 0;
    let lateMinutes = 0;
    let earlyArrivalMinutes = 0;
    let earlyMinutes = 0;
    let lateDepartureMinutes = 0;
    let mySalary = 0;
    let otSalary = 0;
    let totalSalary = 0;
    let presentDays = 0;
    let absentDays = 0;
    let paidOffDays = 0;
    for (const d of dayRows) {
      hours += d.hours;
      overtime += d.overtime;
      lateMinutes += d.lateMinutes;
      earlyArrivalMinutes += d.earlyArrivalMinutes;
      earlyMinutes += d.earlyMinutes;
      lateDepartureMinutes += d.lateDepartureMinutes;
      if (d.checkIn) presentDays += 1;
      else if (d.status === 'Week Off' || d.status === 'Leave') paidOffDays += 1;
      else if (d.status !== 'Upcoming') absentDays += 1;
      const earning = dailySalaryEarning(d, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, otOn);
      if (earning) {
        mySalary += earning.base;
        otSalary += earning.overtime;
        totalSalary += earning.total;
      }
    }
    return { hours, overtime, lateMinutes, earlyArrivalMinutes, earlyMinutes, lateDepartureMinutes, mySalary, otSalary, totalSalary, presentDays, absentDays, paidOffDays };
  }, [dayRows, employee, daysInRange, otHoursPerDay, otMultiplier, otOn]);


  const periodQuery = `?start=${start}&end=${end}&otHoursPerDay=${otHoursPerDay}&otMultiplier=${otMultiplier}&otOn=${otOn}`;

  function exportCsv() {
    if (!employee) return;
    const header = ['Date', 'In', 'Out', 'Total Hours', 'Overtime', 'Late In (min)', 'Early In (min)', 'Early Out (min)', 'Late Out (min)', 'Status', 'Salary/Day', 'My Salary', 'OT Salary', 'Total Salary'];
    const lines = dayRows.map(d => {
      const earning = dailySalaryEarning(d, employee.salary, daysInRange, otHoursPerDay, otMultiplier, otOn);
      return [
        d.date,
        d.checkIn ? fmtTime(d.checkIn) : '',
        d.checkOut ? fmtTime(d.checkOut) : '',
        d.hours.toFixed(1),
        d.overtime.toFixed(1),
        d.lateMinutes || '',
        d.earlyArrivalMinutes || '',
        d.earlyMinutes || '',
        d.lateDepartureMinutes || '',
        d.checkIn ? 'Present' : d.status,
        salaryPerDay != null ? Math.round(salaryPerDay) : '',
        earning ? Math.round(earning.base) : '',
        earning ? Math.round(earning.overtime) : '',
        earning ? Math.round(earning.total) : '',
      ];
    });
    downloadExcel(`payroll_${employee.name.replace(/\s+/g, '_')}_${start}_to_${end}.csv`, header, lines);
  }

  return (
    <AppShell title={employee ? employee.name : 'Payroll Detail'}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/payroll${periodQuery}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-accent"
        >
          <BackIcon className="h-4 w-4" />
          Back to Payroll
        </Link>
        {employee && <TableExportBar onExportCsv={exportCsv} />}
      </div>

      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employee ? (
        <p className="text-center text-sm text-critical">Employee not found.</p>
      ) : (
        <>
          <h2 className="mb-3 text-center text-lg font-bold text-ink">
            {employee.name} — {monthLabel} Breakdown
          </h2>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent p-4 shadow-sm sm:p-6 print:hidden">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-white">
                {employee.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(part => part[0]!.toUpperCase())
                  .join('')}
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">{employee.name}</h2>
                <p className="text-xs font-bold text-black">ENROLL ID {employee.fingerprint_id ?? '—'}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Overtime Salary</span>
                <button
                  type="button"
                  onClick={() => setOtOn(v => !v)}
                  title={otOn ? 'Overtime pay counted for this employee' : 'Overtime pay not counted for this employee'}
                  className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${otOn ? 'bg-good' : 'bg-slate-300'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      otOn ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              <div className="rounded-lg border border-accent/30 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm">{monthLabel}</div>
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                {formatAdDate(start, system)} to {formatAdDate(end, system)}
                <span className="text-slate-400">({daysInRange}d)</span>
              </div>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:hidden">
            <div className="rounded-xl bg-accent/10 p-3 shadow-sm ring-1 ring-inset ring-accent/10">
              <span className="text-xs font-medium text-accent/80">My Salary</span>
              <div className="mt-1 text-base font-bold text-accent">{Math.round(dayTotals.mySalary).toLocaleString()}</div>
              <div className="mt-0.5 text-[11px] text-accent/70">
                {salaryPerDay != null ? `${Math.round(salaryPerDay).toLocaleString()}/day` : 'This period'}
              </div>
            </div>
            <div className="rounded-xl bg-warning-bg p-3 shadow-sm ring-1 ring-inset ring-warning/10">
              <span className="text-xs font-medium text-warning-text/80">OT Salary</span>
              <div className="mt-1 text-base font-bold text-warning-text">{Math.round(dayTotals.otSalary).toLocaleString()}</div>
              <div className="mt-0.5 text-[11px] text-warning-text/70">This period</div>
            </div>
            <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
              <span className="text-xs font-medium text-good-text/80">Total Salary</span>
              <div className="mt-1 text-base font-bold text-good-text">{Math.round(dayTotals.totalSalary).toLocaleString()}</div>
              <div className="mt-0.5 text-[11px] text-good-text/70">Earned this period</div>
            </div>
            <div className="rounded-xl bg-purple-50 p-3 shadow-sm ring-1 ring-inset ring-purple-200">
              <span className="text-xs font-medium text-purple-700/80">Overtime</span>
              <div className="mt-1 text-base font-bold text-purple-700">{fmtHrs(dayTotals.overtime)}</div>
              <div className="mt-0.5 text-[11px] text-purple-700/70">This period</div>
            </div>
            <div className="rounded-xl bg-info-bg p-3 shadow-sm ring-1 ring-inset ring-info/10">
              <span className="text-xs font-medium text-info-text/80">Total Hours</span>
              <div className="mt-1 text-base font-bold text-info-text">{fmtHrs(dayTotals.hours)}</div>
              <div className="mt-0.5 text-[11px] text-info-text/70">This period</div>
            </div>
            {(() => {
              const scored = dayTotals.presentDays + dayTotals.absentDays;
              const attendancePct = scored ? Math.round((dayTotals.presentDays / scored) * 1000) / 10 : 0;
              return (
                <div
                  className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${
                    attendancePct >= 75
                      ? 'bg-good-bg ring-good/10'
                      : attendancePct >= 50
                        ? 'bg-warning-bg ring-warning/10'
                        : 'bg-critical-bg ring-critical/10'
                  }`}
                >
                  <span
                    className={`text-xs font-medium ${
                      attendancePct >= 75 ? 'text-good-text/80' : attendancePct >= 50 ? 'text-warning-text/80' : 'text-critical-text/80'
                    }`}
                  >
                    Attendance
                  </span>
                  <div
                    className={`mt-1 text-base font-bold ${
                      attendancePct >= 75 ? 'text-good-text' : attendancePct >= 50 ? 'text-warning-text' : 'text-critical-text'
                    }`}
                  >
                    {attendancePct}%
                  </div>
                  <div
                    className={`mt-0.5 text-[11px] ${
                      attendancePct >= 75 ? 'text-good-text/70' : attendancePct >= 50 ? 'text-warning-text/70' : 'text-critical-text/70'
                    }`}
                  >
                    {dayTotals.presentDays}P / {dayTotals.paidOffDays}W / {dayTotals.absentDays}A
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
            {/* Phones get the same dense per-day table as My Calendar/My
                Payroll instead of one card per day — the My/OT Salary
                breakdown stays on the desktop table below, this shows just
                the Total Salary headline to keep columns readable. */}
            <div className="mt-3 md:hidden print:hidden">
              <table className="w-full table-fixed text-center text-[10px]">
                <colgroup>
                  <col className="w-[12%]" />
                  <col className="w-[19%]" />
                  <col className="w-[16%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[21%]" />
                </colgroup>
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
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
                  {dayRows.map((d, i) => {
                    const earning = dailySalaryEarning(d, employee.salary, daysInRange, otHoursPerDay, otMultiplier, otOn);
                    return (
                      <tr key={d.date} className={`border-b border-slate-100 last:border-0 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                        <td className="truncate px-0.5 py-0.5 text-ink">{formatDdMmYyyy(d.date, system).slice(0, 5)}</td>
                        <td className="whitespace-normal break-words px-0.5 py-0.5 leading-tight text-slate-600">
                          {d.checkIn ? fmtTime(d.checkIn) : '–:–'} – {d.checkOut ? fmtTime(d.checkOut) : '–:–'}
                        </td>
                        <td className="whitespace-normal break-words px-0.5 py-0.5 leading-tight font-medium">
                          <TimingPair
                            lateMinutes={d.lateMinutes}
                            earlyArrivalMinutes={d.earlyArrivalMinutes}
                            earlyMinutes={d.earlyMinutes}
                            lateDepartureMinutes={d.lateDepartureMinutes}
                          />
                        </td>
                        <td className="truncate px-0.5 py-0.5 font-medium">
                          <StatusText checkIn={d.checkIn} status={d.status} />
                        </td>
                        <td className="whitespace-normal break-words px-0.5 py-0.5 leading-tight text-info-text">{fmtHrs(d.overtime)}</td>
                        <td className="whitespace-normal break-words px-0.5 py-0.5 leading-tight text-slate-600">{fmtHrs(d.hours)}</td>
                        <td className="whitespace-normal break-words px-0.5 py-0.5 font-semibold leading-tight text-good-text">
                          {earning ? Math.round(earning.total).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {dayRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-8 text-center text-slate-400">
                        No days in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
                {dayRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 text-ink">
                      <td className="truncate px-0.5 py-1 text-left font-semibold" colSpan={2}>
                        Total
                      </td>
                      <td className="whitespace-normal break-words px-0.5 py-1 font-semibold leading-tight">
                        <TimingPair
                          lateMinutes={dayTotals.lateMinutes}
                          earlyArrivalMinutes={dayTotals.earlyArrivalMinutes}
                          earlyMinutes={dayTotals.earlyMinutes}
                          lateDepartureMinutes={dayTotals.lateDepartureMinutes}
                        />
                      </td>
                      <td className="truncate px-0.5 py-1 font-semibold text-[9px]">
                        <span className="text-good-text">{dayTotals.presentDays}P</span> / <span className="text-accent">{dayTotals.paidOffDays}W</span> / <span className="text-critical-text">{dayTotals.absentDays}A</span>
                      </td>
                      <td className="whitespace-normal break-words px-0.5 py-1 font-semibold leading-tight text-info-text">
                        {fmtHrs(dayTotals.overtime)}
                      </td>
                      <td className="whitespace-normal break-words px-0.5 py-1 font-semibold leading-tight">{fmtHrs(dayTotals.hours)}</td>
                      <td className="whitespace-normal break-words px-0.5 py-1 font-semibold leading-tight text-good-text">
                        {Math.round(dayTotals.totalSalary).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="mt-4 hidden overflow-x-auto pb-2 md:block print:!block print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Date</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">In / Out</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Total Hours</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Overtime</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Check-In</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Check-Out</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Salary/Day</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">My Salary</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">OT Salary</th>
                    <th className="sticky right-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 font-medium shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none">
                      Total Salary
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((d, i) => {
                    const earning = dailySalaryEarning(d, employee.salary, daysInRange, otHoursPerDay, otMultiplier, otOn);
                    const rowBg = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                    return (
                      <tr key={d.date} className={`border-b border-slate-100 last:border-0 hover:bg-slate-100 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatAdDate(d.date, system)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                          {d.checkIn ? fmtTime(d.checkIn) : '–:–'} – {d.checkOut ? fmtTime(d.checkOut) : '–:–'}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {fmtHrs(d.hours)}{d.pending && <span className="ml-1 text-[10px] text-slate-400">(live)</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{fmtHrs(d.overtime)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          <TimingCell
                            lateMinutes={d.lateMinutes}
                            earlyMinutes={d.earlyArrivalMinutes}
                            lateClass="text-warning-text"
                            earlyClass="text-good-text"
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          <TimingCell
                            lateMinutes={d.lateDepartureMinutes}
                            earlyMinutes={d.earlyMinutes}
                            lateClass="text-info-text"
                            earlyClass="text-critical-text"
                          />
                        </td>
                        <td className="px-3 py-2">{statusBadge(d)}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {salaryPerDay != null ? Math.round(salaryPerDay).toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{earning ? Math.round(earning.base).toLocaleString() : '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{earning ? Math.round(earning.overtime).toLocaleString() : '—'}</td>
                        <td
                          className={`sticky right-0 z-[1] whitespace-nowrap px-3 py-2 font-bold text-good-text shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none ${rowBg}`}
                        >
                          {earning ? Math.round(earning.total).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {dayRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                        No days in this period.
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
                      <td className="whitespace-nowrap px-3 py-2">{fmtHrs(dayTotals.hours)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtHrs(dayTotals.overtime)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        <TimingTotal
                          lateMinutes={dayTotals.lateMinutes}
                          earlyMinutes={dayTotals.earlyArrivalMinutes}
                          lateClass="text-warning-text"
                          earlyClass="text-good-text"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        <TimingTotal
                          lateMinutes={dayTotals.lateDepartureMinutes}
                          earlyMinutes={dayTotals.earlyMinutes}
                          lateClass="text-info-text"
                          earlyClass="text-critical-text"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs font-semibold">
                        <span className="text-good-text">{dayTotals.presentDays}P</span>
                        {' / '}
                        <span className="text-critical-text">{dayTotals.absentDays}A</span>
                      </td>
                      <td />
                      <td className="whitespace-nowrap px-3 py-2">{Math.round(dayTotals.mySalary).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2">{Math.round(dayTotals.otSalary).toLocaleString()}</td>
                      <td className="sticky right-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 text-good-text shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] print:static print:shadow-none">
                        {Math.round(dayTotals.totalSalary).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
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
