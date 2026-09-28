import type { AttendanceLog, Employee, Shift } from './types';
import {
  isWeekOff,
  nepalDateKey,
  nepalTodayIso,
  punchMinuteOfDay,
  resolveShiftForDate,
  type DailyShiftByDate,
  type WeeklyPatternByEmployee,
} from './shift';

// Nepal-local, not a raw UTC slice — a punch between Nepal midnight and
// 5:44 AM is still the previous UTC calendar date, so `iso.slice(0, 10)`
// bucketed those punches under the wrong day.
export const dateKey = nepalDateKey;

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// Mirrors calc.js: earliest '0' punch, else earliest punch overall — legacy
// break punches ('2'/'3', no longer created) are excluded from the fallback
// so an old Start Break with no prior check-in never gets mistaken for one
// (same filter as shift.ts's selectDayPunches).
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
  if (employee.attendance_exempt) return false;
  const checkIn = firstCheckIn(logsForDay);
  if (!checkIn) return false;
  const shift = resolveShiftForDate(employee, shifts, date, dailyShiftByDate, companyWeekOffDates, weeklyPattern);
  // Week Off: nothing scheduled, so there's no start time to be late against.
  if (isWeekOff(shift)) return false;
  const startMin = toMinutes(shift.start_time);
  return punchMinuteOfDay(checkIn.punch_time) > startMin + shift.grace_minutes;
}

export function presentEmployeeIds(logs: AttendanceLog[], day: string) {
  const ids = new Set<string>();
  for (const log of logs) {
    if (dateKey(log.punch_time) === day) ids.add(log.employee_id);
  }
  return ids;
}

export function last7Days(): string[] {
  // Anchored on Nepal-local "today", not a raw UTC Date — for roughly six
  // hours a day (Nepal midnight through 5:44 AM is still the previous UTC
  // calendar date), a UTC anchor would generate the wrong 7-day window
  // relative to what's actually "today" in Nepal.
  const today = nepalTodayIso();
  const [y, m, d] = today.split('-').map(Number);
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.UTC(y, m - 1, d - i));
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

export const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
