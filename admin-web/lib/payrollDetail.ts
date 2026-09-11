import type { AttendanceLog, Employee, PayrollSummary, Shift } from './types';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  dropPunchesClaimedBySummaries,
  edgePunctuality,
  isWeekOff,
  nepalDateKey,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
  type WeeklyPatternByEmployee,
} from './shift';

export type DayDetail = {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  overtime: number;
  /** Check-in vs shift start: minutes late (arrived after) / minutes early
   * (arrived before). Both 0 on a punchless day. */
  lateMinutes: number;
  earlyArrivalMinutes: number;
  /** Check-out vs shift end: minutes early (left before) / minutes late
   * (left after — overlaps overtime). Both 0 on a punchless day. */
  earlyMinutes: number;
  lateDepartureMinutes: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming' | 'Week Off' | 'Leave';
  /** No payroll_summaries row yet (only computed by the nightly job or
   * "Recalculate month" on the Payroll page) — computed live client-side
   * from the raw punches instead of left blank until that job runs. */
  pending?: boolean;
  /** True for a company-wide Week-off or approved-Leave day with no punch —
   * still earns a full day's pay (see dailySalaryEarning), distinct from a
   * genuine Absent. */
  paidOff?: boolean;
};

/** Day 1 through `end`, for one employee — same payroll_summaries-or-live-
 * computed-from-punches fallback the Payroll page's own totals and the
 * Attendance Report page use, just per-day instead of aggregated. Shared
 * by the Payroll page and the per-employee detail page so both agree. */
export function buildEmployeeDayRows(
  employee: Employee,
  shifts: Shift[],
  summaries: PayrollSummary[],
  logs: AttendanceLog[],
  start: string,
  end: string,
  dailyShiftByDate?: DailyShiftByDate,
  /** Company-wide Week-off dates (weekOffDatesInRange()) — a punchless day
   * matching this is 'Week Off' (paid), not 'Absent'/'Upcoming'. */
  weekOffDates?: Set<string>,
  /** This employee's own approved-Leave dates — takes priority over
   * weekOffDates for the label (a requested leave is a Leave even if it
   * happens to fall on a company off day), but is paid identically. */
  leaveDates?: Set<string>,
  /** Only populated (by the caller) when the company's roster_mode is
   * 'weekly' — see resolveShiftForDate() in lib/shift.ts. */
  weeklyPattern?: WeeklyPatternByEmployee
): DayDetail[] {
  const days: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Raw same-date bucketing first (unchanged for normal shifts), then
  // corrected for any day whose resolved shift crosses midnight (Night
  // Duty/Day & Night Duty) — see applyOvernightShiftCorrection().
  const employeeLogs = logs.filter(l => l.employee_id === employee.id);
  const byDate = new Map<string, AttendanceLog[]>();
  for (const day of days) {
    const dayLogs = employeeLogs.filter(l => nepalDateKey(l.punch_time) === day);
    if (dayLogs.length > 0) byDate.set(day, dayLogs);
  }
  applyOvernightShiftCorrection(byDate, employeeLogs, employee, shifts, dailyShiftByDate, weekOffDates, weeklyPattern, days);

  const today = nepalTodayIso();
  // A punch another day's saved row already owns isn't this day's too.
  dropPunchesClaimedBySummaries(byDate, summaries.filter(s => s.employee_id === employee.id), today);
  return days.map(day => {
    // Today can still gain punches after its payroll_summaries row was
    // computed (not re-run until tomorrow's nightly job), so always compute
    // today live instead of trusting a possibly-stale summary.
    const summary = day === today ? undefined : summaries.find(s => s.employee_id === employee.id && s.work_date === day);
    // A summary row can exist with NO check_in — the nightly job ran for a
    // day whose only punch was then claimed by an overnight shift on the day
    // before, or a Week Off / Absent day it swept in anyway. That is not a
    // "Present" day; fall through to the punchless classification below so it
    // reads as Week Off / Leave / Absent like it should.
    if (summary && summary.check_in) {
      // Early-arrival / late-departure aren't stored on the summary row, so
      // derive them live from its check_in/check_out against the shift.
      const resolvedForEdges = resolveShiftForDate(employee, shifts, day, dailyShiftByDate, weekOffDates, weeklyPattern);
      const edges =
        employee.attendance_exempt || isWeekOff(resolvedForEdges)
          ? { earlyArrivalMinutes: 0, lateDepartureMinutes: 0 }
          : edgePunctuality(summary.check_in, summary.check_out, resolvedForEdges);
      return {
        date: day,
        checkIn: summary.check_in,
        checkOut: summary.check_out,
        hours: Number(summary.total_hours),
        overtime: Number(summary.overtime_hours),
        lateMinutes: summary.is_late && !employee.attendance_exempt ? summary.late_minutes : 0,
        earlyArrivalMinutes: edges.earlyArrivalMinutes,
        earlyMinutes: summary.is_early_departure && !employee.attendance_exempt ? summary.early_departure_minutes : 0,
        lateDepartureMinutes: edges.lateDepartureMinutes,
        status: summary.is_late && !employee.attendance_exempt ? 'Late' : 'Present',
      };
    }
    const dayLogs = (byDate.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
    if (dayLogs.length === 0) {
      // A company Week-off or approved Leave day is a known, paid day off
      // regardless of whether it's already passed — takes priority over the
      // Upcoming/Absent distinction below. Leave wins the label if both
      // happen to match the same date; either way it's paid the same.
      if (leaveDates?.has(day)) {
        return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyArrivalMinutes: 0, earlyMinutes: 0, lateDepartureMinutes: 0, status: 'Leave', paidOff: true };
      }
      // A per-employee Week Off picked on the Weekly/Monthly Roster (a
      // employee_daily_shifts row with shift_id null) is a deliberate
      // override that beats a company-wide Week-off — see resolveShiftForDate
      // — so check it the same way a day WITH punches already does below,
      // instead of only weekOffDates (company-wide only).
      if (weekOffDates?.has(day) || isWeekOff(resolveShiftForDate(employee, shifts, day, dailyShiftByDate, weekOffDates, weeklyPattern))) {
        return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyArrivalMinutes: 0, earlyMinutes: 0, lateDepartureMinutes: 0, status: 'Week Off', paidOff: true };
      }
      // A day that hasn't happened yet isn't "Absent" — it just hasn't
      // occurred. Only mark days up to and including today that way.
      const status = day > today ? ('Upcoming' as const) : ('Absent' as const);
      return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyArrivalMinutes: 0, earlyMinutes: 0, lateDepartureMinutes: 0, status };
    }
    const resolved = resolveShiftForDate(employee, shifts, day, dailyShiftByDate, weekOffDates, weeklyPattern);
    const live = computeDayStatusForResolvedShift(dayLogs, resolved);
    return {
      date: day,
      checkIn: live.checkIn.punch_time,
      checkOut: live.checkOut?.punch_time ?? null,
      hours: live.totalMinutes / 60,
      overtime: live.overtimeMinutes / 60,
      lateMinutes: employee.attendance_exempt ? 0 : live.lateMinutes,
      earlyArrivalMinutes: employee.attendance_exempt ? 0 : live.earlyArrivalMinutes,
      earlyMinutes: employee.attendance_exempt ? 0 : live.earlyMinutes,
      lateDepartureMinutes: employee.attendance_exempt ? 0 : live.lateDepartureMinutes,
      status: live.isLate && !employee.attendance_exempt ? 'Late' : 'Present',
      pending: true,
    };
  });
}

/** How the monthly Basic becomes this period's pay — the modes the Payroll
 * report's header toggle offers. Attendance always matters: an absent working
 * day earns nothing in every mode. `'flat'` is kept as an alias of `'daily'`
 * for links that still pass it. */
export type SalaryMode = 'hourly' | 'daily' | 'flat';

export type DailyEarningOpts = {
  /** Calendar days in the period MINUS this employee's weekly-offs and
   * holidays. The divisor for the per-day / per-hour rate — matches the
   * Payroll report exactly, so the per-day rows here add up to the report's
   * "Calculated Salary" for the same period. */
  workingDays: number;
  otHoursPerDay: number;
  otMultiplier: number;
  otOn: boolean;
  mode: SalaryMode;
  /** This date is a company Week-off / holiday (not a working day). A paid
   * Leave that lands on one earns nothing extra — the divisor already
   * covers it — exactly as the Payroll report scores it. */
  isCompanyOffDay: boolean;
  /** Today, in the Nepal timezone (nepalTodayIso()). A per-day-rate mode
   * ('daily'/'flat') pays nothing for today and later — an in-progress day
   * isn't earned yet, matching the Staff Salary Sheet's accrual. Omit to
   * count every day (a finished past period). */
  today?: string;
};

/** One day's slice of the monthly Salary — the per-day form of the Payroll
 * report's calculatedSalary()/overtimeSalary(), so the daily rows here sum
 * to the same period total the report shows.
 *
 *  hourly:       rate = Basic / (workingDays × hours/day), paid per hour
 *                actually worked; a paid Leave day earns one clean day.
 *  daily / flat: rate = Basic / workingDays, paid per day present (a partial
 *                day still counts as a whole day) or on paid Leave. A full
 *                set of working days pays the whole Basic; each absence
 *                docks one day.
 *
 * `d.hours` already includes any overtime portion (see computeDayStatus), so
 * it's subtracted back out for the regular-hours base and paid separately at
 * the multiplier. Week-offs contribute nothing — they're already priced into
 * the working-days divisor. */
export function dailySalaryEarning(
  d: DayDetail,
  salary: number | null,
  opts: DailyEarningOpts
): { base: number; overtime: number; total: number } | null {
  if (salary == null) return null;
  const { otHoursPerDay, otMultiplier, otOn, mode } = opts;
  const workingDays = Math.max(1, opts.workingDays);
  const hourlyRate = salary / (workingDays * otHoursPerDay);
  const dayRate = salary / workingDays;

  // A week-off / holiday: `buildEmployeeDayRows` may mark it 'Week Off' from a
  // roster override even when it isn't in the company weekOff set, so trust
  // the resolved status too. Either way it earns nothing here — the monthly
  // salary is spread over WORKING days only, so a full set of working days
  // already pays the whole Basic.
  const offDay = opts.isCompanyOffDay || d.status === 'Week Off';
  if (offDay) return { base: 0, overtime: 0, total: 0 };

  // Approved Leave on a working day is paid like a day present.
  const onPaidLeave = d.paidOff || d.status === 'Leave';
  // Otherwise the employee must actually have attended (a summary row or live
  // punches → 'Present' / 'Late'); 'Absent' and 'Upcoming' earn nothing.
  const attended = d.status === 'Present' || d.status === 'Late';

  if (!attended && !onPaidLeave) return { base: 0, overtime: 0, total: 0 };

  const notFinished = opts.today != null && d.date >= opts.today;

  if (mode === 'flat' || mode === 'daily') {
    // Nothing for an in-progress day — pay only lands once a day is finished,
    // like the Staff Salary Sheet's accrual.
    if (notFinished) return { base: 0, overtime: 0, total: 0 };
    // One whole day at the flat rate for every day present or on paid leave —
    // a partial day still counts as a day. Absence is what shrinks the total.
    return { base: dayRate, overtime: 0, total: dayRate };
  }

  // hourly: pay per hour actually worked (a clean standard day for a paid
  // Leave day, which has no punches to derive hours from — but not for a
  // Leave day that hasn't happened yet).
  if (onPaidLeave && !attended) {
    return notFinished
      ? { base: 0, overtime: 0, total: 0 }
      : { base: hourlyRate * otHoursPerDay, overtime: 0, total: hourlyRate * otHoursPerDay };
  }
  const regularHours = Math.max(0, d.hours - d.overtime);
  const base = hourlyRate * regularHours;
  const overtime = otOn && d.overtime > 0 ? hourlyRate * otMultiplier * d.overtime : 0;
  return { base, overtime, total: base + overtime };
}
