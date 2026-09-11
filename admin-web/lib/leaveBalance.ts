import NepaliDate from 'nepali-date-converter';
import { supabase } from './supabase';
import { buildEmployeeDayRows, type DayDetail } from './payrollDetail';
import {
  buildWeeklyPatternByEmployee,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from './shift';
import { leaveDatesByEmployee, weekOffDatesByGender } from './weekOff';
import type { AttendanceLog, CompanyHoliday, Employee, LeaveRequest, PayrollSummary, Shift } from './types';
import { ATTENDANCE_LOG_COLUMNS, PAYROLL_SUMMARY_COLUMNS } from './types';

/**
 * A yearly paid-leave balance (companies.paid_leave_days_per_year /
 * week_off_work_earns_leave, 20260911100000_company_paid_leave_balance.sql).
 *
 * Every employee starts each Nepal fiscal year (1 Shrawan) with their own
 * yearly allowance (employees.annual_leave_days, set on the Leave page), or
 * the company's `daysPerYear` when they have none. Walking the year day by
 * day, in order:
 *
 *   - a finished working day with no attendance (Absent), or taken as
 *     approved leave, is paid out of the balance -- as long as there is any.
 *     Once it reaches 0 the day is unpaid, exactly as before the balance
 *     existed.
 *   - approved leave of type 'unpaid' is unpaid and leaves the balance alone.
 *   - attendance on the employee's Week Off, when the company turns that on,
 *     ADDS one whole day for every full hoursPerLeaveDay worked (8h = 1 day,
 *     16h = 2, 24h = 3; under 8h adds nothing -- there are no half days) and
 *     is not counted as overtime.
 *
 * Unused days lapse at the next 1 Shrawan. Nothing is stored: the ledger is
 * rebuilt from the attendance on record, so a correction to a past day moves
 * the balance on its own.
 */
export type LeavePolicy = {
  daysPerYear: number;
  weekOffWorkEarnsLeave: boolean;
  /** Hours that make one leave day — the company's standard day
   * (companies.ot_hours_per_day, 8 by default). */
  hoursPerLeaveDay: number;
};

export const NO_LEAVE_POLICY: LeavePolicy = { daysPerYear: 0, weekOffWorkEarnsLeave: false, hoursPerLeaveDay: 8 };

/** This employee's yearly allowance: their own number if an admin set one,
 * otherwise the company default. */
export function employeeLeaveAllowance(emp: Pick<Employee, 'annual_leave_days'>, p: LeavePolicy): number {
  const own = emp.annual_leave_days;
  return own != null && Number.isFinite(Number(own)) ? Number(own) : p.daysPerYear;
}

/** Whether a balance is tracked at all: a company default, Week Off work
 * earning leave, or at least one employee given their own allowance. */
export function leavePolicyActive(p: LeavePolicy, employees?: Pick<Employee, 'annual_leave_days'>[]): boolean {
  return p.daysPerYear > 0 || p.weekOffWorkEarnsLeave || !!employees?.some(e => Number(e.annual_leave_days) > 0);
}

/** Whole leave days earned by `hours` of Week Off work: one per full
 * standard day, never a part day. */
export function weekOffLeaveCredit(hours: number, hoursPerLeaveDay: number): number {
  // The epsilon keeps an exact 8h stored as 7.9999… from rounding down.
  return Math.floor(hours / Math.max(1, hoursPerLeaveDay) + 1e-6);
}

/** The caller's company leave policy. The two columns come from a migration
 * that may not be applied everywhere yet, so they're read on their own and a
 * failure just means "no policy" — like overtime_rate in lib/weekOff.ts. */
export async function fetchLeavePolicy(): Promise<LeavePolicy & { companyId: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ...NO_LEAVE_POLICY, companyId: null };
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  const companyId = profile?.company_id ?? null;
  if (!companyId) return { ...NO_LEAVE_POLICY, companyId: null };
  const { data: base } = await supabase.from('companies').select('ot_hours_per_day').eq('id', companyId).single();
  const { data, error } = await supabase
    .from('companies')
    .select('paid_leave_days_per_year, week_off_work_earns_leave')
    .eq('id', companyId)
    .single();
  const hoursPerLeaveDay = Number(base?.ot_hours_per_day) > 0 ? Number(base!.ot_hours_per_day) : 8;
  if (error || !data) return { ...NO_LEAVE_POLICY, hoursPerLeaveDay, companyId };
  const row = data as { paid_leave_days_per_year: number | null; week_off_work_earns_leave: boolean | null };
  return {
    companyId,
    daysPerYear: Number(row.paid_leave_days_per_year) || 0,
    weekOffWorkEarnsLeave: !!row.week_off_work_earns_leave,
    hoursPerLeaveDay,
  };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function adKeyOf(nd: NepaliDate): string {
  const ad = nd.getAD();
  return `${ad.year}-${pad(ad.month + 1)}-${pad(ad.date)}`;
}

function bsOf(adKey: string) {
  const [y, m, d] = adKey.split('-').map(Number);
  return NepaliDate.fromAD(new Date(y, m - 1, d)).getBS();
}

/** 1 Shrawan (BS month index 3) on or before `adKey`, as an AD date key. */
export function fiscalYearStart(adKey: string): string {
  const bs = bsOf(adKey);
  const year = bs.month >= 3 ? bs.year : bs.year - 1;
  return adKeyOf(new NepaliDate(year, 3, 1));
}

/** Last day of the fiscal year that starts on `fyStartKey` (end of Ashadh). */
export function fiscalYearEnd(fyStartKey: string): string {
  const bs = bsOf(fyStartKey);
  const next = new NepaliDate(bs.year + 1, 3, 1).getAD();
  const d = new Date(Date.UTC(next.year, next.month, next.date - 1));
  return d.toISOString().slice(0, 10);
}

/** "2083/84" for the fiscal year starting on `fyStartKey`. */
export function fiscalYearLabel(fyStartKey: string): string {
  const y = bsOf(fyStartKey).year;
  return `${y}/${pad((y + 1) % 100)}`;
}

function addDays(key: string, n: number): string {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Round a day count to 2 decimals so 0.1 + 0.2 style drift never shows. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "1", "0.5", "2.25" — a day count with no trailing zeros. */
export function formatLeaveDays(n: number): string {
  return String(r2(n));
}

export type LeaveEntry = {
  date: string;
  /** earned: Week Off attendance added to the balance.
   *  absent: a working day with no attendance.
   *  leave:  approved paid leave on a working day.
   *  unpaid-leave: approved 'unpaid' leave -- never drawn from the balance. */
  kind: 'earned' | 'absent' | 'leave' | 'unpaid-leave';
  /** earned: days added. absent/leave: days paid from the balance. */
  days: number;
  /** The part of the day NOT covered by the balance, so not paid. */
  unpaid: number;
  /** Hours worked, for an earned entry. */
  hours?: number;
  /** Balance after this entry. */
  balance: number;
};

export type LeaveLedger = {
  employeeId: string;
  /** 1 Shrawan of the fiscal year `until` is in. */
  fyStart: string;
  /** First day actually counted: the fiscal-year start, or later if the
   * employee joined (or the company started punching) after it. */
  from: string;
  /** Last day counted (yesterday, or earlier for a past period). */
  until: string;
  /** Totals for that fiscal year. */
  entitlement: number;
  earned: number;
  used: number;
  unpaidDays: number;
  balance: number;
  entries: LeaveEntry[];
  /** date -> part of that working day (0..1) paid from the balance, across
   * every fiscal year walked. What the payroll reports add to paid days. */
  coveredByDate: Map<string, number>;
};

/** Walks one employee's finished days in date order and builds the ledger.
 * `days` must be chronological; days on or after `today` are ignored. */
export function buildLeaveLedger(opts: {
  employeeId: string;
  days: DayDetail[];
  isOffDay: (date: string) => boolean;
  isUnpaidLeave: (date: string) => boolean;
  policy: LeavePolicy;
  /** This employee's yearly allowance (employeeLeaveAllowance()). */
  entitlement: number;
  from: string;
  until: string;
}): LeaveLedger {
  const { policy, entitlement } = opts;
  const coveredByDate = new Map<string, number>();
  let fy = '';
  let balance = 0;
  let earned = 0;
  let used = 0;
  let unpaidDays = 0;
  let entries: LeaveEntry[] = [];

  for (const d of opts.days) {
    if (d.date < opts.from || d.date > opts.until) continue;
    const dayFy = fiscalYearStart(d.date);
    if (dayFy !== fy) {
      // A new fiscal year: whatever was left lapses, and everyone starts over.
      fy = dayFy;
      balance = entitlement;
      earned = 0;
      used = 0;
      unpaidDays = 0;
      entries = [];
    }
    const offDay = opts.isOffDay(d.date);
    const attended = d.status === 'Present' || d.status === 'Late';

    if (attended) {
      const credit = offDay && policy.weekOffWorkEarnsLeave ? weekOffLeaveCredit(d.hours, policy.hoursPerLeaveDay) : 0;
      if (credit > 0) {
        balance = r2(balance + credit);
        earned = r2(earned + credit);
        entries.push({ date: d.date, kind: 'earned', days: credit, unpaid: 0, hours: d.hours, balance });
      }
      continue;
    }
    // A Week Off with no attendance is already paid (Basic is spread over
    // working days only), so it never touches the balance.
    if (offDay) continue;

    let kind: LeaveEntry['kind'] | null = null;
    if (d.status === 'Leave') kind = opts.isUnpaidLeave(d.date) ? 'unpaid-leave' : 'leave';
    else if (d.status === 'Absent') kind = 'absent';
    if (!kind) continue;

    if (kind === 'unpaid-leave') {
      unpaidDays = r2(unpaidDays + 1);
      entries.push({ date: d.date, kind, days: 0, unpaid: 1, balance });
      continue;
    }
    const covered = r2(Math.min(1, Math.max(0, balance)));
    balance = r2(balance - covered);
    used = r2(used + covered);
    unpaidDays = r2(unpaidDays + (1 - covered));
    if (covered > 0) coveredByDate.set(d.date, covered);
    entries.push({ date: d.date, kind, days: covered, unpaid: r2(1 - covered), balance });
  }

  const fyStart = fy || fiscalYearStart(opts.until);
  const hasDays = fy !== '';
  return {
    employeeId: opts.employeeId,
    fyStart,
    from: opts.from > fyStart ? opts.from : fyStart,
    until: opts.until,
    entitlement,
    earned: hasDays ? earned : 0,
    used: hasDays ? used : 0,
    unpaidDays: hasDays ? unpaidDays : 0,
    balance: hasDays ? balance : entitlement,
    entries,
    coveredByDate,
  };
}

const PAGE = 1000;

/** Every row of a query, a page at a time — a whole fiscal year of punches
 * can pass PostgREST's per-request row cap. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error || !Array.isArray(data)) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Ledgers for `employees`, covering the fiscal year that contains `until`
 * (plus, for a period that straddles 1 Shrawan, the tail of the year before
 * it — see `periodStart`). Fetches its own attendance so any page can call
 * it, and runs the same day classification the payroll reports use
 * (buildEmployeeDayRows), so a day that reads Absent there is the day the
 * balance pays for.
 *
 * Days before an employee's date_of_joining, and before the company's very
 * first punch on record, are not counted — otherwise a mid-year joiner, or a
 * company that started on the system after 1 Shrawan, would open with a
 * balance already spent on "absences" from before they existed here.
 */
export async function loadLeaveLedgers(opts: {
  employees: Employee[];
  policy: LeavePolicy;
  weeklyOffDay: number | null;
  rosterMode: 'weekly' | 'monthly';
  /** Last day to count. Clamped to yesterday: today isn't finished. */
  until: string;
  /** Start of the pay period being viewed, if any — the walk starts at the
   * fiscal year of whichever is earlier, so every day of the period has a
   * ledger answer. */
  periodStart?: string;
}): Promise<Map<string, LeaveLedger>> {
  const result = new Map<string, LeaveLedger>();
  if (!leavePolicyActive(opts.policy, opts.employees) || opts.employees.length === 0) return result;

  const yesterday = addDays(nepalTodayIso(), -1);
  const until = opts.until < yesterday ? opts.until : yesterday;
  const anchor = opts.periodStart && opts.periodStart < until ? opts.periodStart : until;
  const walkStart = fiscalYearStart(anchor);
  if (walkStart > until) {
    for (const e of opts.employees) {
      result.set(
        e.id,
        buildLeaveLedger({
          employeeId: e.id,
          days: [],
          isOffDay: () => false,
          isUnpaidLeave: () => false,
          policy: opts.policy,
          entitlement: employeeLeaveAllowance(e, opts.policy),
          from: walkStart,
          until,
        })
      );
    }
    return result;
  }

  const [firstPunch, summaries, logs, shifts, roster, holidays, leave, pattern] = await Promise.all([
    supabase.from('attendance_logs').select('punch_time').order('punch_time', { ascending: true }).limit(1),
    fetchAll<PayrollSummary>((a, b) =>
      supabase.from('payroll_summaries').select(PAYROLL_SUMMARY_COLUMNS).gte('work_date', walkStart).lte('work_date', until).order('work_date').range(a, b)
    ),
    // A day either side: an overnight duty's tap-out lands on the next date,
    // and the Kathmandu day starts 5h45m before the UTC one.
    fetchAll<AttendanceLog>((a, b) =>
      supabase
        .from('attendance_logs')
        .select(ATTENDANCE_LOG_COLUMNS)
        .gte('punch_time', `${addDays(walkStart, -1)}T00:00:00Z`)
        .lte('punch_time', `${addDays(until, 1)}T23:59:59Z`)
        .order('punch_time')
        .range(a, b)
    ),
    supabase.from('shifts').select('*'),
    fetchAll<{ employee_id: string; work_date: string; shift_id: string | null }>((a, b) =>
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', walkStart).lte('work_date', until).order('work_date').range(a, b)
    ),
    supabase.from('company_holidays').select('*').gte('holiday_date', walkStart).lte('holiday_date', until),
    supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', until).gte('end_date', walkStart),
    opts.rosterMode === 'weekly'
      ? supabase.from('employee_weekly_pattern').select('employee_id, weekday, shift_id')
      : Promise.resolve({ data: [] as { employee_id: string; weekday: number; shift_id: string | null }[] }),
  ]);

  const firstPunchIso = firstPunch.data?.[0]?.punch_time as string | undefined;
  // Kathmandu date of the company's first punch (UTC+5:45).
  const companyStart = firstPunchIso
    ? new Date(new Date(firstPunchIso).getTime() + 345 * 60000).toISOString().slice(0, 10)
    : null;
  const shiftList = (shifts.data ?? []) as Shift[];
  const leaveRows = (leave.data ?? []) as LeaveRequest[];
  const dailyShiftByDate: DailyShiftByDate = new Map();
  for (const r of roster) {
    let perDate = dailyShiftByDate.get(r.employee_id);
    if (!perDate) {
      perDate = new Map();
      dailyShiftByDate.set(r.employee_id, perDate);
    }
    perDate.set(r.work_date, r.shift_id);
  }
  const weeklyPattern = buildWeeklyPatternByEmployee(pattern.data ?? []);
  const weekOffDatesFor = weekOffDatesByGender(walkStart, until, opts.weeklyOffDay, (holidays.data ?? []) as CompanyHoliday[]);
  const leaveByEmployee = leaveDatesByEmployee(leaveRows);
  const unpaidLeaveByEmployee = leaveDatesByEmployee(leaveRows.filter(r => r.leave_type === 'unpaid'));

  for (const emp of opts.employees) {
    let from = walkStart;
    if (emp.date_of_joining && emp.date_of_joining > from) from = emp.date_of_joining.slice(0, 10);
    if (companyStart && companyStart > from) from = companyStart;
    const weekOffDates = weekOffDatesFor(emp.gender);
    const days =
      from > until
        ? []
        : buildEmployeeDayRows(emp, shiftList, summaries, logs, from, until, dailyShiftByDate, weekOffDates, leaveByEmployee.get(emp.id), weeklyPattern);
    const unpaid = unpaidLeaveByEmployee.get(emp.id);
    result.set(
      emp.id,
      buildLeaveLedger({
        employeeId: emp.id,
        days,
        isOffDay: date =>
          weekOffDates.has(date) || isWeekOff(resolveShiftForDate(emp, shiftList, date, dailyShiftByDate, weekOffDates, weeklyPattern)),
        isUnpaidLeave: date => unpaid?.has(date) ?? false,
        policy: opts.policy,
        entitlement: employeeLeaveAllowance(emp, opts.policy),
        from,
        until,
      })
    );
  }
  return result;
}

/** Days of `ledger` inside [start, end] paid from the balance. */
export function coveredDaysInRange(ledger: LeaveLedger | undefined, start: string, end: string): number {
  if (!ledger) return 0;
  let sum = 0;
  for (const [date, covered] of ledger.coveredByDate) {
    if (date >= start && date <= end) sum += covered;
  }
  return r2(sum);
}
