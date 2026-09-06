import { supabase } from './supabase';
import type { CompanyHoliday, Gender, HolidayScope } from './types';

/** Company-wide Week-off: a recurring weekly day (0=Sunday..6=Saturday, from
 * companies.weekly_off_day) plus ad-hoc dates (company_holidays). Applies to
 * every employee at once — distinct from the per-employee roster Week Off
 * (employee_daily_shifts.shift_id = null, see lib/shift.ts's WEEK_OFF). */
export type RosterMode = 'weekly' | 'monthly';

export type CompanyWeekOffConfig = {
  companyId: string | null;
  weeklyOffDay: number | null;
  /** Which roster drives real employee shifts — 'monthly' (the default) is
   * today's exact-date employee_daily_shifts model; 'weekly' means
   * employee_weekly_pattern is consulted instead (see resolveShiftForDate in
   * lib/shift.ts). Defaults to 'monthly' when there's no company yet. */
  rosterMode: RosterMode;
  /** Overtime policy (companies.ot_hours_per_day/ot_multiplier,
   * 20260825160000_company_overtime_settings.sql) — the admin-set default
   * a "standard day" and OT pay rate use everywhere overtime pay is
   * calculated (Payroll page, an employee's own My Payroll page). Defaults
   * to 8h/1.5x, same as the column defaults, when there's no company yet. */
  otHoursPerDay: number;
  otMultiplier: number;
  /** Statutory contribution rates as a percentage of Basic Salary
   * (companies.pf_rate/ssf_rate/tds_rate,
   * 20260901120000_company_contribution_rates.sql) — one figure per company,
   * set on the Salary Structure page, read by every payroll breakdown.
   * Defaults to the common Nepal figures (PF 10%, SSF 11%, TDS 0%) when
   * there's no company yet. */
  pfRate: number;
  ssfRate: number;
  tdsRate: number;
};

const DEFAULT_CONFIG: CompanyWeekOffConfig = {
  companyId: null,
  weeklyOffDay: null,
  rosterMode: 'monthly',
  otHoursPerDay: 8,
  otMultiplier: 1.5,
  pfRate: 10,
  ssfRate: 11,
  tdsRate: 0,
};

/** The current user's own company_id + weekly_off_day + roster_mode +
 * overtime policy + contribution rates. Reads go through `profiles` first
 * (RLS-scoped to the caller's own row) to find company_id, then `companies`
 * itself (RLS-scoped to id = my_company_id(), see
 * 20260814180000_companies_rls_policies.sql). */
export async function fetchMyCompanyWeekOffConfig(): Promise<CompanyWeekOffConfig> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return DEFAULT_CONFIG;
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  const companyId = profile?.company_id ?? null;
  if (!companyId) return DEFAULT_CONFIG;
  const { data: company } = await supabase
    .from('companies')
    .select('weekly_off_day, roster_mode, ot_hours_per_day, ot_multiplier, pf_rate, ssf_rate, tds_rate')
    .eq('id', companyId)
    .single();
  return {
    companyId,
    weeklyOffDay: company?.weekly_off_day ?? null,
    rosterMode: (company?.roster_mode as RosterMode) ?? 'monthly',
    otHoursPerDay: company?.ot_hours_per_day ?? DEFAULT_CONFIG.otHoursPerDay,
    otMultiplier: company?.ot_multiplier ?? DEFAULT_CONFIG.otMultiplier,
    pfRate: company?.pf_rate ?? DEFAULT_CONFIG.pfRate,
    ssfRate: company?.ssf_rate ?? DEFAULT_CONFIG.ssfRate,
    tdsRate: company?.tds_rate ?? DEFAULT_CONFIG.tdsRate,
  };
}

type HolidayLike = Pick<CompanyHoliday, 'holiday_date'> & { applies_to?: HolidayScope | null };

/** Whether a holiday's scope covers an employee of this gender. A holiday with
 * no `applies_to` (or 'all') covers everyone; a 'male'/'female' holiday covers
 * only that gender — a null/'other' gender is never covered by a scoped one. */
export function holidayCoversGender(scope: HolidayScope | null | undefined, gender: Gender | null | undefined): boolean {
  const s = scope ?? 'all';
  return s === 'all' || s === gender;
}

/** Dates within [start, end] (inclusive, 'YYYY-MM-DD') that are a company-wide
 * Week-off: either the weekly recurring day or a company_holidays row. When
 * `gender` is given, gender-scoped holidays are included only if they cover
 * that gender; omitting it (or passing null) yields company-wide holidays
 * only — the behaviour every caller had before holiday scoping existed. */
export function weekOffDatesInRange(
  start: string,
  end: string,
  weeklyOffDay: number | null,
  holidays: HolidayLike[],
  gender?: Gender | null
): Set<string> {
  const set = new Set<string>();
  for (const h of holidays) {
    if (holidayCoversGender(h.applies_to, gender)) set.add(h.holiday_date);
  }
  if (weeklyOffDay == null) return set;
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    if (cur.getUTCDay() === weeklyOffDay) set.add(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return set;
}

/** For a multi-employee view (the Payroll report, Attendance report, Staff
 * Salary Sheet): pre-computes the week-off date set for each gender bucket
 * once, then returns a per-employee lookup. `null`/`'other'` genders get the
 * company-wide set. */
export function weekOffDatesByGender(
  start: string,
  end: string,
  weeklyOffDay: number | null,
  holidays: HolidayLike[]
): (gender: Gender | null | undefined) => Set<string> {
  const base = weekOffDatesInRange(start, end, weeklyOffDay, holidays);
  const male = weekOffDatesInRange(start, end, weeklyOffDay, holidays, 'male');
  const female = weekOffDatesInRange(start, end, weeklyOffDay, holidays, 'female');
  return gender => (gender === 'male' ? male : gender === 'female' ? female : base);
}

/** employee_id -> Set of 'YYYY-MM-DD' dates covered by an approved leave
 * request, expanded across each request's start_date..end_date. */
export function leaveDatesByEmployee(leaveRequests: { employee_id: string; start_date: string; end_date: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const req of leaveRequests) {
    let set = map.get(req.employee_id);
    if (!set) {
      set = new Set();
      map.set(req.employee_id, set);
    }
    const cur = new Date(req.start_date + 'T00:00:00Z');
    const endDate = new Date(req.end_date + 'T00:00:00Z');
    while (cur <= endDate) {
      set.add(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return map;
}
