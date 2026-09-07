import { supabase } from './supabase';

/**
 * Which payroll report the current user's company sees.
 *
 * 'standard' — the attendance-based Payroll report every company gets.
 * 'staff_salary_sheet' — a fixed-salary sheet enabled for exactly one
 *   customer via `update companies set payroll_format = 'staff_salary_sheet'`.
 *
 * Deliberately isolated from lib/weekOff.ts's shared config fetch: only the
 * Payroll Report page calls this, and a not-yet-applied migration (or no
 * company) degrades to 'standard' rather than breaking anything.
 */
export type PayrollFormat = 'standard' | 'staff_salary_sheet';

export async function fetchCompanyPayrollFormat(): Promise<PayrollFormat> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return 'standard';
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  if (!profile?.company_id) return 'standard';
  const { data } = await supabase.from('companies').select('payroll_format').eq('id', profile.company_id).single();
  return (data?.payroll_format as PayrollFormat) ?? 'standard';
}

/**
 * Config the Staff Salary Sheet needs beyond the standard company config —
 * the editable SSF employer / employee rates and the overtime policy. Its own
 * fetch (not folded into the shared lib/weekOff.ts one) so a not-yet-applied
 * ssf_employer_rate migration only degrades this sheet, nothing else. Called
 * only when payroll_format is 'staff_salary_sheet'.
 */
export type StaffSheetConfig = {
  ssfEmployerRate: number; // % of Basic
  ssfEmployeeRate: number; // % of Basic
  otHoursPerDay: number;
  otMultiplier: number;
};

const STAFF_SHEET_DEFAULTS: StaffSheetConfig = { ssfEmployerRate: 20, ssfEmployeeRate: 11, otHoursPerDay: 8, otMultiplier: 1.5 };

export async function fetchStaffSheetConfig(): Promise<StaffSheetConfig> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return STAFF_SHEET_DEFAULTS;
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  if (!profile?.company_id) return STAFF_SHEET_DEFAULTS;
  const { data } = await supabase
    .from('companies')
    .select('ssf_employer_rate, ssf_rate, ot_hours_per_day, ot_multiplier')
    .eq('id', profile.company_id)
    .single();
  return {
    ssfEmployerRate: data?.ssf_employer_rate ?? STAFF_SHEET_DEFAULTS.ssfEmployerRate,
    ssfEmployeeRate: data?.ssf_rate ?? STAFF_SHEET_DEFAULTS.ssfEmployeeRate,
    otHoursPerDay: data?.ot_hours_per_day ?? STAFF_SHEET_DEFAULTS.otHoursPerDay,
    otMultiplier: data?.ot_multiplier ?? STAFF_SHEET_DEFAULTS.otMultiplier,
  };
}
