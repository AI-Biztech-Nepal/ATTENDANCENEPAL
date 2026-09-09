import type { AttendanceLog, Employee, PayrollSummary, Shift } from '../types';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
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
  lateMinutes: number;
  earlyMinutes: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming' | 'Week Off';
  pending?: boolean;
  /** True for a company-wide Week-off or approved-Leave day with no punch —
   * still earns a full day's pay (see dailySalaryEarning), distinct from a
   * genuine Absent. */
  paidOff?: boolean;
};

export function buildEmployeeDayRows(
  employee: Employee,
  shifts: Shift[],
  summaries: PayrollSummary[],
  logs: AttendanceLog[],
  start: string,
  end: string,
  dailyShiftByDate?: DailyShiftByDate,
  /** Company-wide Week-off dates and this employee's own approved-Leave
   * dates — a punchless day matching either is 'Week Off' (paid). */
  paidOffDates?: Set<string>,
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

  const employeeLogs = logs.filter(l => l.employee_id === employee.id);
  const byDate = new Map<string, AttendanceLog[]>();
  for (const day of days) {
    const dayLogs = employeeLogs.filter(l => nepalDateKey(l.punch_time) === day);
    if (dayLogs.length > 0) byDate.set(day, dayLogs);
  }
  applyOvernightShiftCorrection(byDate, employeeLogs, employee, shifts, dailyShiftByDate, paidOffDates, weeklyPattern, days);

  const today = nepalTodayIso();
  return days.map(day => {
    const summary = day === today ? undefined : summaries.find(s => s.employee_id === employee.id && s.work_date === day);
    // A summary row with no check_in isn't a "Present" day — the nightly job
    // swept in a Week Off / Absent day, or the only punch was claimed by an
    // overnight shift the day before. Fall through to the punchless branch.
    if (summary && summary.check_in) {
      return {
        date: day,
        checkIn: summary.check_in,
        checkOut: summary.check_out,
        hours: Number(summary.total_hours),
        overtime: Number(summary.overtime_hours),
        lateMinutes: summary.is_late && !employee.attendance_exempt ? summary.late_minutes : 0,
        earlyMinutes: summary.is_early_departure && !employee.attendance_exempt ? summary.early_departure_minutes : 0,
        status: summary.is_late && !employee.attendance_exempt ? ('Late' as const) : ('Present' as const),
      };
    }
    const dayLogs = (byDate.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
    if (dayLogs.length === 0) {
      // A per-employee Week Off picked on the Weekly/Monthly Roster (an
      // employee_daily_shifts row with shift_id null) beats a company-wide
      // Week-off date — check it the same way a day WITH punches already
      // does below via resolveShiftForDate(), instead of only paidOffDates.
      if (paidOffDates?.has(day) || isWeekOff(resolveShiftForDate(employee, shifts, day, dailyShiftByDate, paidOffDates, weeklyPattern))) {
        return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, status: 'Week Off' as const, paidOff: true };
      }
      const status = day > today ? ('Upcoming' as const) : ('Absent' as const);
      return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, status };
    }
    const resolved = resolveShiftForDate(employee, shifts, day, dailyShiftByDate, paidOffDates, weeklyPattern);
    const live = computeDayStatusForResolvedShift(dayLogs, resolved);
    return {
      date: day,
      checkIn: live.checkIn.punch_time,
      checkOut: live.checkOut?.punch_time ?? null,
      hours: live.totalMinutes / 60,
      overtime: live.overtimeMinutes / 60,
      lateMinutes: employee.attendance_exempt ? 0 : live.lateMinutes,
      earlyMinutes: employee.attendance_exempt ? 0 : live.earlyMinutes,
      status: live.isLate && !employee.attendance_exempt ? ('Late' as const) : ('Present' as const),
      pending: true,
    };
  });
}

export function dailySalaryEarning(
  d: DayDetail,
  salary: number | null,
  daysInRange: number,
  otHoursPerDay: number,
  otMultiplier: number,
  otOn: boolean
): { base: number; overtime: number; total: number } | null {
  if (salary == null) return null;
  const hourlyRate = salary / (daysInRange * otHoursPerDay);
  if (d.paidOff) return { base: hourlyRate * otHoursPerDay, overtime: 0, total: hourlyRate * otHoursPerDay };
  const regularHours = Math.max(0, d.hours - d.overtime);
  const base = hourlyRate * regularHours;
  const overtime = otOn && d.overtime > 0 ? hourlyRate * otMultiplier * d.overtime : 0;
  return { base, overtime, total: base + overtime };
}
