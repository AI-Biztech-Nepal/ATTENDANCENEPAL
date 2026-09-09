import type { AttendanceLog, Employee, Shift } from '../types';

const DEFAULT_SHIFT: Pick<Shift, 'id' | 'name' | 'start_time' | 'end_time' | 'grace_minutes'> = {
  id: 'default',
  name: 'Default',
  start_time: '09:00',
  end_time: '18:00',
  grace_minutes: 10,
};

// Lowest `id` among matches, not just the first one the array happens to
// list first — shifts are fetched with no `.order()` anywhere, so array
// order isn't guaranteed. If an admin ever creates two shift templates for
// the same employee or department (nothing stops that), this needs to pick
// the SAME one every time and agree with the server's own tiebreak
// (`order by s.id limit 1` in find_employee_shift, supabase/payroll.sql).
function lowestId<T extends { id: string }>(candidates: T[]): T | undefined {
  return candidates.reduce<T | undefined>((min, s) => (!min || s.id < min.id ? s : min), undefined);
}

// Mirrors find_employee_shift() in supabase/payroll.sql: employee's own shift,
// else their department's, else the default.
export function resolveShift(employee: Employee, shifts: Shift[]) {
  const own = lowestId(shifts.filter(s => s.employee_id === employee.id));
  if (own) return own;
  const dept = lowestId(shifts.filter(s => s.employee_id === null && s.department === employee.department));
  if (dept) return dept;
  return DEFAULT_SHIFT;
}

export type DailyShiftByDate = Map<string, Map<string, string | null>>;

/** employeeId -> weekday (0=Sunday..6=Saturday) -> shift_id, from
 * employee_weekly_pattern — only meaningful when the company's roster_mode
 * is 'weekly'; callers in 'monthly' mode (the default) pass undefined and
 * resolution behaves exactly as it always has. Same null-means-Week-Off
 * convention as DailyShiftByDate. */
export type WeeklyPatternByEmployee = Map<string, Map<number, string | null>>;

export function buildWeeklyPatternByEmployee(
  rows: { employee_id: string; weekday: number; shift_id: string | null }[]
): WeeklyPatternByEmployee {
  const map: WeeklyPatternByEmployee = new Map();
  for (const r of rows) {
    let perWeekday = map.get(r.employee_id);
    if (!perWeekday) {
      perWeekday = new Map();
      map.set(r.employee_id, perWeekday);
    }
    perWeekday.set(r.weekday, r.shift_id);
  }
  return map;
}

export const WEEK_OFF = { id: 'week-off', name: 'Week Off' } as const;
export type ResolvedShift = Shift | typeof DEFAULT_SHIFT | typeof WEEK_OFF;

export function isWeekOff(shift: ResolvedShift): shift is typeof WEEK_OFF {
  return shift === WEEK_OFF;
}

export function resolveShiftForDate(
  employee: Employee,
  shifts: Shift[],
  date: string,
  dailyShiftByDate?: DailyShiftByDate,
  companyWeekOffDates?: Set<string>,
  weeklyPattern?: WeeklyPatternByEmployee
): ResolvedShift {
  const perDate = dailyShiftByDate?.get(employee.id);
  if (perDate?.has(date)) {
    const shiftId = perDate.get(date);
    if (shiftId === null) return WEEK_OFF;
    const shift = shifts.find(s => s.id === shiftId);
    if (shift) return shift;
  }
  const perWeekday = weeklyPattern?.get(employee.id);
  if (perWeekday?.size) {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    if (perWeekday.has(weekday)) {
      const shiftId = perWeekday.get(weekday);
      if (shiftId === null) return WEEK_OFF;
      const shift = shifts.find(s => s.id === shiftId);
      if (shift) return shift;
    }
  }
  if (companyWeekOffDates?.has(date)) return WEEK_OFF;
  return resolveShift(employee, shifts);
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

export function formatShiftHours(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  const hh = (t: string) => t.slice(0, 2);
  return `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)} (${hh(shift.start_time)}-${hh(shift.end_time)})`;
}

/** Minutes -> "Xh Ym". */
export function formatHoursMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

/** Asia/Kathmandu is a fixed UTC+5:45 offset (no DST). */
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

export function nepalTodayIso() {
  return nepalDateKey(new Date().toISOString());
}

/** Which Nepal-local calendar date (YYYY-MM-DD) a punch's real UTC instant
 * falls on — NOT `iso.slice(0, 10)`, which reads the UTC date. Nepal is
 * UTC+5:45, so any punch between 00:00-05:44 Nepal time is still the
 * PREVIOUS UTC calendar date; a raw slice silently bucketed those punches
 * under the wrong day everywhere it was used instead of this. */
export function nepalDateKey(iso: string) {
  const d = new Date(new Date(iso).getTime() + NEPAL_OFFSET_MINUTES * 60000);
  return d.toISOString().slice(0, 10);
}

function punchMinuteOfDay(iso: string) {
  const d = new Date(iso);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (((utcMinutes + NEPAL_OFFSET_MINUTES) % 1440) + 1440) % 1440;
}

export type DayStatus = {
  hasIn: boolean;
  hasOut: boolean;
  isLate: boolean;
  isEarly: boolean;
  checkIn: AttendanceLog;
  checkOut: AttendanceLog | null;
  lateMinutes: number;
  earlyMinutes: number;
  totalMinutes: number;
  overtimeMinutes: number;
};

/** Punch type -> the label shown everywhere a single punch is rendered.
 * Only '0'/'1' are produced now; legacy '2'/'3' (break punches, since
 * removed) fall through to Check In. */
export function punchTypeLabel(punchType: string): string {
  return punchType === '1' ? 'Check Out' : 'Check In';
}

/** Legacy break punches ('2'/'3', no longer created) are filtered out first —
 * one could otherwise be mistaken for the day's check-out. */
export function selectDayPunches(logs: AttendanceLog[]): { checkIn: AttendanceLog; checkOut: AttendanceLog | null } {
  const sorted = logs
    .filter(l => l.punch_type !== '2' && l.punch_type !== '3')
    .sort((a, b) => a.punch_time.localeCompare(b.punch_time));
  const checkIn = sorted.find(l => l.punch_type === '0') ?? sorted[0];
  const outCandidates = sorted.filter(l => l.punch_type === '1');
  const checkOut = outCandidates.length
    ? outCandidates[outCandidates.length - 1]
    : sorted.length > 1
      ? sorted[sorted.length - 1]
      : null;
  return { checkIn, checkOut: checkOut !== checkIn ? checkOut : null };
}

export function computeDayStatus(
  logs: AttendanceLog[],
  shift: Pick<Shift, 'start_time' | 'end_time' | 'grace_minutes'>
): DayStatus {
  const { checkIn, checkOut } = selectDayPunches(logs);
  const hasOut = !!checkOut;

  const shiftStartMin = toMinutes(shift.start_time);
  const shiftEndMin = toMinutes(shift.end_time);
  const inMin = punchMinuteOfDay(checkIn.punch_time);
  const isLate = inMin > shiftStartMin + shift.grace_minutes;
  const lateMinutes = isLate ? inMin - shiftStartMin : 0;

  const outMin = hasOut ? punchMinuteOfDay(checkOut!.punch_time) : null;
  const isEarly = outMin !== null && outMin < shiftEndMin;
  const earlyMinutes = isEarly ? shiftEndMin - outMin! : 0;

  const shiftDurationMin =
    shiftEndMin > shiftStartMin ? shiftEndMin - shiftStartMin : 24 * 60 - shiftStartMin + shiftEndMin;
  const totalMinutes = hasOut
    ? Math.round((new Date(checkOut!.punch_time).getTime() - new Date(checkIn.punch_time).getTime()) / 60000)
    : 0;
  const overtimeMinutes = totalMinutes > shiftDurationMin ? totalMinutes - shiftDurationMin : 0;

  return {
    hasIn: true,
    hasOut,
    isLate,
    isEarly,
    checkIn,
    checkOut: hasOut ? checkOut : null,
    lateMinutes,
    earlyMinutes,
    totalMinutes,
    overtimeMinutes,
  };
}

export function computeDayStatusForResolvedShift(logs: AttendanceLog[], resolved: ResolvedShift): DayStatus {
  if (isWeekOff(resolved)) {
    const { checkIn, checkOut } = selectDayPunches(logs);
    const hasOut = !!checkOut;
    const totalMinutes = hasOut
      ? Math.round((new Date(checkOut!.punch_time).getTime() - new Date(checkIn.punch_time).getTime()) / 60000)
      : 0;
    return {
      hasIn: true,
      hasOut,
      isLate: false,
      isEarly: false,
      checkIn,
      checkOut: hasOut ? checkOut : null,
      lateMinutes: 0,
      earlyMinutes: 0,
      totalMinutes,
      overtimeMinutes: totalMinutes,
    };
  }
  return computeDayStatus(logs, resolved);
}

function isOvernightShift(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  return toMinutes(shift.end_time) <= toMinutes(shift.start_time);
}

export function nepalDateTimeToUtcMs(dateKey: string, time: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.slice(0, 5).split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - NEPAL_OFFSET_MINUTES * 60000;
}

export function applyOvernightShiftCorrection(
  byDate: Map<string, AttendanceLog[]>,
  allLogs: AttendanceLog[],
  employee: Employee,
  shifts: Shift[],
  dailyShiftByDate?: DailyShiftByDate,
  companyWeekOffDates?: Set<string>,
  weeklyPattern?: WeeklyPatternByEmployee,
  rangeDates?: string[]
): Map<string, AttendanceLog[]> {
  const punchedDates = new Set(byDate.keys());
  const claimed = new Set<string>();
  const overnightDates = new Set<string>();

  const nextDay = (date: string) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const resolvedFor = (date: string) =>
    resolveShiftForDate(employee, shifts, date, dailyShiftByDate, companyWeekOffDates, weeklyPattern);

  // Rostered overnight-shift dates with no same-date punch: someone doing a
  // 24-hour duty often taps just once, on the way out the next morning, so
  // the duty date reads as Absent while the following day (usually their
  // Week Off) wrongly reads as Present. Pull that lone tap back onto the
  // duty date — but only when the day after is a Week Off / out of range,
  // so a real working day never loses its own check-in this way.
  const zeroPunchOvernight = (rangeDates ?? []).filter(d => {
    if (punchedDates.has(d)) return false;
    const r = resolvedFor(d);
    return !isWeekOff(r) && isOvernightShift(r);
  });

  for (const date of [...punchedDates, ...zeroPunchOvernight]) {
    const resolved = resolvedFor(date);
    if (isWeekOff(resolved) || !isOvernightShift(resolved)) continue;

    const startMin = toMinutes(resolved.start_time);
    const endMin = toMinutes(resolved.end_time);
    const durationMin = 24 * 60 - startMin + endMin;
    const windowStartMs = nepalDateTimeToUtcMs(date, '00:00');
    const windowEndMs = nepalDateTimeToUtcMs(date, resolved.start_time) + (durationMin + 120) * 60000;

    const dayLogs = allLogs.filter(l => {
      const t = new Date(l.punch_time).getTime();
      return t >= windowStartMs && t < windowEndMs;
    });

    if (!punchedDates.has(date)) {
      const next = nextDay(date);
      const nextIsWeekOff = isWeekOff(resolvedFor(next)) || (companyWeekOffDates?.has(next) ?? false);
      const nextInRange = rangeDates?.includes(next) ?? false;
      if (dayLogs.length === 0 || (nextInRange && !nextIsWeekOff)) continue;
    }

    overnightDates.add(date);
    for (const l of dayLogs) claimed.add(l.id);
    byDate.set(date, dayLogs);
  }

  if (claimed.size > 0) {
    for (const [date, list] of byDate) {
      if (overnightDates.has(date)) continue;
      const filtered = list.filter(l => !claimed.has(l.id));
      if (filtered.length !== list.length) {
        if (filtered.length > 0) byDate.set(date, filtered);
        else byDate.delete(date);
      }
    }
  }

  return byDate;
}
