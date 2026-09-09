import type { AttendanceLog, Employee, Shift } from './types';

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

/** employeeId -> work_date (YYYY-MM-DD) -> shift_id, from employee_daily_shifts.
 * A `null` value means an explicit Week Off row exists for that date. No entry
 * for a date at all means "not on the roster" — falls back to resolveShift(). */
export type DailyShiftByDate = Map<string, Map<string, string | null>>;

/** employeeId -> weekday (0=Sunday..6=Saturday) -> shift_id, from
 * employee_weekly_pattern (20260818100000) — only ever meaningful when the
 * company's roster_mode is 'weekly'; callers in 'monthly' mode (the default)
 * pass undefined here and resolution behaves exactly as it always has. Same
 * null-means-Week-Off convention as DailyShiftByDate. */
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

/** Sentinel for "explicitly no shift today" (Week Off), distinct from a day
 * with no roster entry at all (which still resolves via resolveShift()). */
export const WEEK_OFF = { id: 'week-off', name: 'Week Off' } as const;
export type ResolvedShift = Shift | typeof DEFAULT_SHIFT | typeof WEEK_OFF;

export function isWeekOff(shift: ResolvedShift): shift is typeof WEEK_OFF {
  return shift === WEEK_OFF;
}

/** Mirrors find_employee_shift_for_date() in the roster migration: an
 * employee_daily_shifts row for this exact date wins (its shift, or
 * WEEK_OFF if shift_id is null) — a deliberate, specific override, so it
 * beats everything else including a company-wide Week-off below. No roster
 * row at all falls through, in 'weekly' roster_mode companies only, to a
 * matching weekday in employee_weekly_pattern (20260818100000) — same
 * override-wins priority as the exact-date roster, since it's the same kind
 * of deliberate assignment, just recurring instead of one-off. After that,
 * falls through to a company-wide Week-off date (weeklyOffDay or a
 * company_holidays row, passed in by the caller — see lib/weekOff.ts) if
 * this date is one, and only then to the normal own-shift/department/
 * default chain — companies using none of these features see no change. */
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

function isOvernightShift(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  return toMinutes(shift.end_time) <= toMinutes(shift.start_time);
}

export function formatShiftHours(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  const hh = (t: string) => t.slice(0, 2);
  return `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)} (${hh(shift.start_time)}-${hh(shift.end_time)})`;
}

export type DayStatus = {
  hasIn: boolean;
  hasOut: boolean;
  isLate: boolean;
  isEarly: boolean;
  checkIn: AttendanceLog;
  checkOut: AttendanceLog | null;
  /** Minutes the check-in was AFTER shift start (0 if on time / early). */
  lateMinutes: number;
  /** Minutes the check-out was BEFORE shift end (0 if on time / late). */
  earlyMinutes: number;
  /** Minutes the check-in was BEFORE shift start (0 if on time / late). */
  earlyArrivalMinutes: number;
  /** Minutes the check-out was AFTER shift end (0 if on time / early). */
  lateDepartureMinutes: number;
  /** Worked minutes this day — 0 until there's both an in and an out. */
  totalMinutes: number;
  /** Minutes worked beyond the shift's duration — 0 unless totalMinutes exceeds it. */
  overtimeMinutes: number;
};

/** Punch type -> the label shown everywhere a single punch is rendered
 * (live feeds, history rows, request review). Only '0'/'1' are produced now;
 * legacy '2'/'3' (break punches, since removed) fall through to Check In. */
export function punchTypeLabel(punchType: string): string {
  return punchType === '1' ? 'Check Out' : 'Check In';
}

/** Minutes -> "Xh Ym" — used everywhere a duration (late-by, early-by, total
 * hours, overtime) is shown, so every table reads the same way. */
export function formatHoursMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

/** Asia/Kathmandu is a fixed UTC+5:45 offset (no DST) — same value
 * calc_payroll_fields() in supabase/payroll.sql converts to via
 * `at time zone 'Asia/Kathmandu'`. */
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

/** Today's date, in Nepal local time, as "YYYY-MM-DD" — computed from the
 * viewer's real UTC instant plus the fixed Nepal offset, not the viewer's own
 * system clock/timezone. Used to tell whether a payroll_summaries row for a
 * given work_date can still change (the day isn't over yet in Nepal, so more
 * punches — like a checkout — can still land after that row was computed). */
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

/** Minute-of-day for a punch, in Nepal local time — computed from the punch's
 * real UTC instant plus the fixed Nepal offset, NOT the viewer's own system
 * clock. This used to read the browser's local time (via Date#getHours()),
 * which only produced correct Late/Early numbers when the person looking at
 * the screen happened to have their computer set to Nepal time too — anyone
 * viewing from a different timezone got systematically wrong late/early
 * minutes for every "live" (not yet in payroll_summaries) row, while
 * finalized rows (computed server-side with the fixed Asia/Kathmandu
 * conversion) were correct. Must keep agreeing with that server-side
 * conversion for live and finalized numbers to match. */
export function punchMinuteOfDay(iso: string) {
  const d = new Date(iso);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (((utcMinutes + NEPAL_OFFSET_MINUTES) % 1440) + 1440) % 1440;
}

/** One calendar day's punches -> the two that actually count: first
 * check-in (or earliest punch) is "in", last check-out (or latest punch, if
 * there's more than one) is "out". Any other punch that day (duplicate
 * ZKTeco taps, etc.) is neither. Mirrors calculateDailyRecord() in calc.js.
 *
 * Legacy break punches ('2'/'3', no longer created) are filtered out first —
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

/** One calendar day's punches -> attendance state for that day. */
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
  // Arrived ahead of the shift. Clamped: a value beyond half a day is a
  // minute-of-day wrap artefact on an overnight shift, not a real early-in.
  const rawEarlyArrival = inMin < shiftStartMin ? shiftStartMin - inMin : 0;
  const earlyArrivalMinutes = rawEarlyArrival > 720 ? 0 : rawEarlyArrival;

  const outMin = hasOut ? punchMinuteOfDay(checkOut!.punch_time) : null;
  const isEarly = outMin !== null && outMin < shiftEndMin;
  const earlyMinutes = isEarly ? shiftEndMin - outMin! : 0;
  // Stayed past the shift end (overlaps the Overtime column, shown here too
  // as a punctuality signal). Same overnight-wrap clamp as early arrival.
  const rawLateDeparture = outMin !== null && outMin > shiftEndMin ? outMin - shiftEndMin : 0;
  const lateDepartureMinutes = rawLateDeparture > 720 ? 0 : rawLateDeparture;

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
    earlyArrivalMinutes,
    lateDepartureMinutes,
    totalMinutes,
    overtimeMinutes,
  };
}

/** Early-arrival / late-departure minutes computed straight from two ISO
 * punch timestamps against a shift — for callers that have a finalized
 * payroll_summaries row (its check_in/check_out) rather than raw punches.
 * Same overnight-wrap clamp as computeDayStatus(). */
export function edgePunctuality(
  checkInIso: string | null,
  checkOutIso: string | null,
  shift: Pick<Shift, 'start_time' | 'end_time'>
): { earlyArrivalMinutes: number; lateDepartureMinutes: number } {
  const shiftStartMin = toMinutes(shift.start_time);
  const shiftEndMin = toMinutes(shift.end_time);
  let earlyArrivalMinutes = 0;
  let lateDepartureMinutes = 0;
  if (checkInIso) {
    const inMin = punchMinuteOfDay(checkInIso);
    const raw = inMin < shiftStartMin ? shiftStartMin - inMin : 0;
    earlyArrivalMinutes = raw > 720 ? 0 : raw;
  }
  if (checkOutIso) {
    const outMin = punchMinuteOfDay(checkOutIso);
    const raw = outMin > shiftEndMin ? outMin - shiftEndMin : 0;
    lateDepartureMinutes = raw > 720 ? 0 : raw;
  }
  return { earlyArrivalMinutes, lateDepartureMinutes };
}

/** Same as computeDayStatus(), but for a ResolvedShift that might be
 * WEEK_OFF — a day nothing was scheduled, so never late/early, but any
 * hours actually punched still count (entirely as overtime, since there
 * were 0 scheduled hours to exceed). Mirrors calc_payroll_fields()'s
 * is_week_off branch. */
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
      earlyArrivalMinutes: 0,
      lateDepartureMinutes: 0,
      totalMinutes,
      overtimeMinutes: totalMinutes,
    };
  }
  return computeDayStatus(logs, resolved);
}

/** The UTC instant for `time` (HH:MM) on `dateKey` (YYYY-MM-DD), read as
 * Nepal local time — the inverse of punchMinuteOfDay()'s conversion. */
export function nepalDateTimeToUtcMs(dateKey: string, time: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.slice(0, 5).split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - NEPAL_OFFSET_MINUTES * 60000;
}

/** Corrects a `byDate` grouping (built by each call site the usual way —
 * bucketing raw punches by their own calendar date) for overnight shifts
 * (Night Duty, Day & Night Duty): a shift starting in the evening has its
 * check-out land on the NEXT calendar date, so naive same-date bucketing
 * loses the shift entirely (the start date sees no matching check-out, and
 * the end date mislabels the lone check-out as its own stray check-in).
 * Mirrors shift_window_for_date()/compute_payroll_summaries()'s fix
 * server-side: for any date whose resolved shift crosses midnight, rebuild
 * that date's bucket from a window starting at the shift's scheduled start
 * and spanning its duration plus a 2-hour overtime allowance, then strip
 * whatever punches that window claimed out of neighboring dates' buckets
 * so nothing gets double-counted. Mutates and returns `byDate`.
 *
 * `rangeDates` (every calendar date the caller is showing) also lets this
 * rescue a rostered overnight-shift date that has NO same-date punch at all:
 * someone doing a 24-hour duty often taps just once — on the way out the
 * next morning — so the duty date's bucket is empty (reads as Absent) while
 * the following day, usually their Week Off, gets that tap and wrongly reads
 * as Present. When the day after is a Week Off (or outside the shown range),
 * the lone morning tap is pulled back onto the duty date. The guard keeps a
 * real working day from ever losing its own check-in this way. */
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

  // Rostered overnight-shift dates with no same-date punch — candidates for
  // the next-morning-tap-only rescue described above.
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
    // Window starts at midnight, not the scheduled start minute, so a punch
    // a few minutes early (arriving ahead of shift) isn't excluded.
    const windowStartMs = nepalDateTimeToUtcMs(date, '00:00');
    const windowEndMs = nepalDateTimeToUtcMs(date, resolved.start_time) + (durationMin + 120) * 60000;

    const dayLogs = allLogs.filter(l => {
      const t = new Date(l.punch_time).getTime();
      return t >= windowStartMs && t < windowEndMs;
    });

    if (!punchedDates.has(date)) {
      // A zero-punch duty date: only rescue when the window actually caught a
      // tap AND the day after is a Week Off / out of range, so we can never
      // steal a following working day's own check-in.
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
