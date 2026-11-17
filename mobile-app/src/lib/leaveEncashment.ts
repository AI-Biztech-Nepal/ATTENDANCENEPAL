// Ported from admin-web/lib/leaveEncashment.ts — keep the two in step.
import NepaliDate from 'nepali-date-converter';
import { supabase } from './supabase';
import { bsPeriod } from './calendar';
import { fetchMyCompanyWeekOffConfig, weekOffDatesInRange } from './weekOff';
import { fetchLeavePolicy, fiscalYearLabel, loadLeaveLedgers, type LeaveLedger } from './leaveBalance';
import { nepalTodayIso } from './shift';
import type { CompanyHoliday, Employee } from '../types';

/**
 * What someone leaving is owed for the paid leave they never used, worked out from the same yearly balance
 * the Leave page shows (lib/leaveBalance.ts):
 *
 *   unused leave days  ×  one day's pay  =  leave encashment
 *
 * - Unused days are the balance on the last working day, in the leave year (1 Shrawan to the end of Ashadh)
 *   that day falls in. Earlier years lapsed, as they always do in the balance. A last working day that has
 *   not happened yet counts up to yesterday — the balance can still change until then.
 * - One day's pay is Basic ÷ working days of that Nepali month (the month minus weekly offs and holidays),
 *   exactly how the Payroll report divides Basic, so the two never disagree.
 *
 * It is a suggestion: the settlement field stays editable for anything the rules here don't cover.
 */
export type LeaveEncashmentEstimate =
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'ready';
      /** Paid leave still unused on the last working day. */
      days: number;
      basic: number;
      workingDays: number;
      /** "Bhadra 2083" — the month the day's pay is taken from. */
      monthLabel: string;
      /** One day's pay, rounded to paisa for display; `amount` is worked from the exact figure. */
      dayRate: number;
      amount: number;
      /** "2083/84" */
      leaveYear: string;
      entitlement: number;
      earned: number;
      used: number;
      /** The last day the balance was counted to (AD key) — earlier than the last working day when that day is still ahead. */
      countedThrough: string;
    };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The estimate from a finished ledger. No fetching, so it can be tested on its own. */
export function composeEstimate(input: {
  basic: number | null | undefined;
  ledger: LeaveLedger | undefined;
  workingDays: number;
  monthLabel: string;
}): LeaveEncashmentEstimate {
  const basic = Number(input.basic);
  if (!Number.isFinite(basic) || basic <= 0) {
    return { kind: 'unavailable', reason: 'There is no Basic salary on file for this employee, so a day’s pay can’t be worked out.' };
  }
  const { ledger } = input;
  if (!ledger) {
    return { kind: 'unavailable', reason: 'Yearly paid leave isn’t set up for this employee. Give them leave days on the Leave page first.' };
  }
  const workingDays = Math.max(1, input.workingDays);
  const days = Math.max(0, ledger.balance);
  return {
    kind: 'ready',
    days,
    basic,
    workingDays,
    monthLabel: input.monthLabel,
    dayRate: round2(basic / workingDays),
    amount: round2((days * basic) / workingDays),
    leaveYear: fiscalYearLabel(ledger.fyStart),
    entitlement: ledger.entitlement,
    earned: ledger.earned,
    used: ledger.used,
    countedThrough: ledger.until,
  };
}

function daysBetween(startKey: string, endKey: string): number {
  return Math.round((Date.parse(endKey + 'T00:00:00Z') - Date.parse(startKey + 'T00:00:00Z')) / 86400000);
}

/** Works out the leave encashment for `employee` as of their last working day (today when none is set yet). */
export async function estimateLeaveEncashment(employee: Employee, lastWorkingOn: string | null): Promise<LeaveEncashmentEstimate> {
  const asOf = lastWorkingOn && /^\d{4}-\d{2}-\d{2}/.test(lastWorkingOn) ? lastWorkingOn.slice(0, 10) : nepalTodayIso();

  let period: ReturnType<typeof bsPeriod>;
  try {
    const [y, m, d] = asOf.split('-').map(Number);
    const bs = NepaliDate.fromAD(new Date(y, m - 1, d)).getBS();
    period = bsPeriod(bs.year, bs.month);
  } catch {
    return { kind: 'unavailable', reason: 'That last working date is outside the Nepali calendar this works from.' };
  }

  const [config, policy] = await Promise.all([fetchMyCompanyWeekOffConfig(), fetchLeavePolicy()]);
  const { data: holidays, error } = await supabase.from('company_holidays').select('*').gte('holiday_date', period.start).lte('holiday_date', period.end);
  if (error) throw error;
  const off = weekOffDatesInRange(period.start, period.end, config.weeklyOffDay, (holidays ?? []) as CompanyHoliday[], employee.gender);
  const workingDays = daysBetween(period.start, period.end) + 1 - off.size;

  const ledgers = await loadLeaveLedgers({ employees: [employee], policy, weeklyOffDay: config.weeklyOffDay, rosterMode: config.rosterMode, until: asOf });
  return composeEstimate({ basic: employee.salary, ledger: ledgers.get(employee.id), workingDays, monthLabel: period.label });
}
