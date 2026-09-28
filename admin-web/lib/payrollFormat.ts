import { supabase } from './supabase';

/**
 * Which payroll report the current user's company sees.
 *
 * 'staff_salary_sheet' — the Staff Salary Sheet: Basic earned per day
 *   present, Allowance, SSF gross-up, Net. Every company's format, and the
 *   column default for new ones (20260911140000).
 * 'standard' — the older hourly attendance-based Payroll report, kept for a
 *   company set back to it with
 *   `update companies set payroll_format = 'standard' where id = ...`.
 *
 * Deliberately isolated from lib/weekOff.ts's shared config fetch: a missing
 * company degrades to 'standard' rather than breaking anything.
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
 * The current company's display name — printed as the document header on the
 * payroll reports. Returns '' when there's no company or the row can't be
 * read.
 */
export async function fetchCompanyName(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return '';
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  if (!profile?.company_id) return '';
  const { data } = await supabase.from('companies').select('name').eq('id', profile.company_id).single();
  return (data?.name as string | null)?.trim() ?? '';
}

/**
 * Config the Staff Salary Sheet needs beyond the standard company config —
 * the editable SSF employer / employee rates and the overtime policy. Its own
 * fetch (not folded into the shared lib/weekOff.ts one) so a not-yet-applied
 * ssf_employer_rate migration only degrades this sheet, nothing else.
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
