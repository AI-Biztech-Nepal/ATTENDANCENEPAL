export type SeparationType = 'resignation' | 'termination' | 'retirement' | 'other';
export const SEPARATION_TYPES: { value: SeparationType; label: string }[] = [
  { value: 'resignation', label: 'Resignation' },
  { value: 'termination', label: 'Termination' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'other', label: 'Other' },
];

/** Returned / pending, plus "not applicable" for something the person never had. */
export type ReturnStatus = 'pending' | 'returned' | 'not_applicable';
export type ClearanceStatus = 'pending' | 'in_progress' | 'cleared';
export type SettlementStatus = 'pending' | 'processed' | 'completed';

/** One row of employee_separations (20261101180000_employee_separations.sql). */
export type EmployeeSeparation = {
  id: string;
  employee_id: string;
  separation_type: SeparationType;
  resignation_submitted_on: string | null;
  resignation_effective_on: string | null;
  last_working_on: string | null;
  notice_required_days: number | null;
  notice_served_days: number | null;
  separation_reason: string | null;
  exit_interview_status: 'pending' | 'completed';
  exit_interview_on: string | null;
  clearance_status: ClearanceStatus;
  clearance_note: string | null;
  uniform_id_status: ReturnStatus;
  asset_keys_status: ReturnStatus;
  asset_equipment_status: ReturnStatus;
  asset_device_status: ReturnStatus;
  asset_other_status: ReturnStatus;
  asset_other_note: string | null;
  experience_letter_status: 'pending' | 'issued';
  experience_letter_on: string | null;
  final_salary: number;
  leave_encashment: number;
  incentive_settlement: number;
  other_payments: number;
  outstanding_advances: number;
  other_deductions: number;
  other_dues_note: string | null;
  settlement_status: SettlementStatus;
  settlement_on: string | null;
  /** True when the employee handed in the resignation themselves (20261103140000_employee_self_edit_hris.sql). */
  requested_by_employee?: boolean;
  updated_at: string;
};

export const SETTLEMENT_LABEL: Record<SettlementStatus, string> = {
  pending: 'Pending',
  processed: 'Processed',
  completed: 'Completed',
};

const DAY_MS = 86400000;

function parseKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Whole days from one date key (YYYY-MM-DD) to another; null if either is missing. */
export function daysBetweenKeys(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = parseKey(from);
  const b = parseKey(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/** Days actually served: from handing in the resignation to the last working day. */
export function servedFromDates(submittedOn: string | null, lastWorkingOn: string | null): number | null {
  const days = daysBetweenKeys(submittedOn, lastWorkingOn);
  return days !== null && days >= 0 ? days : null;
}

/** How many days short of the required notice they left, or null if either figure is missing. */
export function noticeShortfall(required: number | null, served: number | null): number | null {
  if (required === null || served === null) return null;
  return Math.max(0, required - served);
}

export type SettlementAmounts = Pick<
  EmployeeSeparation,
  'final_salary' | 'leave_encashment' | 'incentive_settlement' | 'other_payments' | 'outstanding_advances' | 'other_deductions'
>;

/** What the company owes, what comes off, and the difference. A negative net
 * means the person owes the company. Rounded to paisa so a sum of decimals
 * doesn't print as 28000.499999. */
export function settlementTotals(a: SettlementAmounts) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const payments = round(a.final_salary + a.leave_encashment + a.incentive_settlement + a.other_payments);
  const deductions = round(a.outstanding_advances + a.other_deductions);
  return { payments, deductions, net: round(payments - deductions) };
}

export type ChecklistItem = { key: string; label: string; done: boolean };

/** The eight things to tick off before someone has fully left. Money is tracked
 * separately, by the settlement status. */
export function checklist(
  s: Pick<
    EmployeeSeparation,
    | 'exit_interview_status'
    | 'clearance_status'
    | 'uniform_id_status'
    | 'asset_keys_status'
    | 'asset_equipment_status'
    | 'asset_device_status'
    | 'asset_other_status'
    | 'experience_letter_status'
  >
): ChecklistItem[] {
  const handled = (v: ReturnStatus) => v !== 'pending';
  return [
    { key: 'exit', label: 'Exit interview', done: s.exit_interview_status === 'completed' },
    { key: 'clearance', label: 'Department clearance', done: s.clearance_status === 'cleared' },
    { key: 'uniform', label: 'Uniform / ID card', done: handled(s.uniform_id_status) },
    { key: 'keys', label: 'Keys', done: handled(s.asset_keys_status) },
    { key: 'equipment', label: 'Equipment', done: handled(s.asset_equipment_status) },
    { key: 'device', label: 'Device', done: handled(s.asset_device_status) },
    { key: 'other', label: 'Other company assets', done: handled(s.asset_other_status) },
    { key: 'letter', label: 'Experience letter', done: s.experience_letter_status === 'issued' },
  ];
}

/** Nothing for HR to have started yet: no checklist item ticked, no notice period, no money entered.
 * The employee can still change or withdraw a resignation they handed in while this holds — the same
 * test as separation_is_untouched() in the database, which is what actually enforces it. */
export function isUntouched(s: EmployeeSeparation): boolean {
  return (
    s.exit_interview_status === 'pending' &&
    s.clearance_status === 'pending' &&
    s.uniform_id_status === 'pending' &&
    s.asset_keys_status === 'pending' &&
    s.asset_equipment_status === 'pending' &&
    s.asset_device_status === 'pending' &&
    s.asset_other_status === 'pending' &&
    s.experience_letter_status === 'pending' &&
    s.settlement_status === 'pending' &&
    s.notice_required_days === null &&
    s.final_salary === 0 &&
    s.leave_encashment === 0 &&
    s.incentive_settlement === 0 &&
    s.other_payments === 0 &&
    s.outstanding_advances === 0 &&
    s.other_deductions === 0
  );
}

export function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
