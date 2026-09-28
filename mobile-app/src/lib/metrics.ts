import type { AttendanceLog, Employee, Shift } from '../types';
import { isWeekOff, resolveShiftForDate, type DailyShiftByDate, type WeeklyPatternByEmployee } from './shift';

export function dateKey(iso: string) {
  return iso.slice(0, 10);
}

function minutesOfDayUTC(iso: string) {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// Legacy break punches ('2'/'3', no longer created) are excluded from the
// fallback so an old Start Break with no prior check-in never gets mistaken
// for one (same filter as shift.ts's selectDayPunches).
export function firstCheckIn(logsForDay: AttendanceLog[]): AttendanceLog | undefined {
  const sorted = logsForDay
    .filter(l => l.punch_type !== '2' && l.punch_type !== '3')
    .sort((a, b) => a.punch_time.localeCompare(b.punch_time));
  return sorted.find(l => l.punch_type === '0') ?? sorted[0];
}

export function isLate(
  employee: Employee,
  shifts: Shift[],
  logsForDay: AttendanceLog[],
  date: string,
  dailyShiftByDate?: DailyShiftByDate,
  companyWeekOffDates?: Set<string>,
  weeklyPattern?: WeeklyPatternByEmployee
) {
  const checkIn = firstCheckIn(logsForDay);
  if (!checkIn) return false;
  const shift = resolveShiftForDate(employee, shifts, date, dailyShiftByDate, companyWeekOffDates, weeklyPattern);
  if (isWeekOff(shift)) return false;
  const startMin = toMinutes(shift.start_time);
  return minutesOfDayUTC(checkIn.punch_time) > startMin + shift.grace_minutes;
}

export function presentEmployeeIds(logs: AttendanceLog[], day: string) {
  const ids = new Set<string>();
  for (const log of logs) {
    if (dateKey(log.punch_time) === day) ids.add(log.employee_id);
  }
  return ids;
}
