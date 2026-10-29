import { dateKey, isLate, presentEmployeeIds } from './metrics';
import { isWeekOff, resolveShiftForDate, type DailyShiftByDate, type WeeklyPatternByEmployee } from './shift';
import type { AttendanceLog, Employee, Gender, Shift } from './types';

export type TodayStatus = 'present' | 'late' | 'leave' | 'weekOff' | 'exempt' | 'absent';

/** Each ACTIVE employee's attendance for `today`, by the same rules as the
 * tenant Dashboard's Present / Late / On Leave / Week-off / Absent cards
 * (app/(admin)/page.tsx and its superadmin mirror,
 * api/superadmin/companies/[id]/dashboard): a punch today means Present
 * (or Late, past the shift's grace), else approved leave, else a Week Off
 * (company-wide, or this employee's own roster/pattern), else an
 * attendance-exempt employee is never counted absent — anyone left is
 * Absent. Every input must already be scoped to ONE company: shifts match
 * departments by name alone (see resolveShift()). */
export function todayStatusByEmployee(opts: {
  activeEmployees: Employee[];
  shifts: Shift[];
  logs: AttendanceLog[];
  onLeaveIds: Set<string>;
  today: string;
  dailyShiftByDate: DailyShiftByDate;
  weeklyPattern: WeeklyPatternByEmployee;
  weekOffDatesFor: (gender: Gender | null | undefined) => Set<string>;
}): Map<string, TodayStatus> {
  const { activeEmployees, shifts, logs, onLeaveIds, today, dailyShiftByDate, weeklyPattern, weekOffDatesFor } = opts;
  const presentIds = presentEmployeeIds(logs, today);
  const todayIsWeekOff = weekOffDatesFor(null).has(today);

  const todayLogsByEmployee = new Map<string, AttendanceLog[]>();
  for (const log of logs) {
    if (dateKey(log.punch_time) !== today) continue;
    const list = todayLogsByEmployee.get(log.employee_id);
    if (list) list.push(log);
    else todayLogsByEmployee.set(log.employee_id, [log]);
  }

  const statuses = new Map<string, TodayStatus>();
  for (const emp of activeEmployees) {
    const weekOffDates = weekOffDatesFor(emp.gender);
    let status: TodayStatus;
    if (presentIds.has(emp.id)) {
      const empLogs = todayLogsByEmployee.get(emp.id) ?? [];
      status = isLate(emp, shifts, empLogs, today, dailyShiftByDate, weekOffDates, weeklyPattern) ? 'late' : 'present';
    } else if (onLeaveIds.has(emp.id)) {
      status = 'leave';
    } else if (todayIsWeekOff || isWeekOff(resolveShiftForDate(emp, shifts, today, dailyShiftByDate, weekOffDates, weeklyPattern))) {
      status = 'weekOff';
    } else if (emp.attendance_exempt) {
      status = 'exempt';
    } else {
      status = 'absent';
    }
    statuses.set(emp.id, status);
  }
  return statuses;
}
