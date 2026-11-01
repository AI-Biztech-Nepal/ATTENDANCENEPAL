import type { Employee, EmployeeEducation } from '../types';

export const EMPLOYMENT_TYPES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
  { value: 'part_time', label: 'Part-time' },
] as const;

export function employmentTypeLabel(value: string | null | undefined): string {
  return EMPLOYMENT_TYPES.find(t => t.value === value)?.label ?? '';
}

export type EmploymentStatus = 'active' | 'probation' | 'suspended' | 'terminated' | 'resigned';

export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  active: 'Active',
  probation: 'Probation',
  suspended: 'Suspended',
  terminated: 'Terminated',
  resigned: 'Resigned',
};

/** The statuses an admin can pick for someone who still works here. Leaving
 * (Resigned / Terminated) goes through "Mark Resigned" on the directory, which
 * also takes the person out of the active views. */
export const WORKING_STATUSES: EmploymentStatus[] = ['active', 'probation', 'suspended'];

export const STATUS_TONE: Record<EmploymentStatus, 'good' | 'info' | 'warning' | 'critical' | 'neutral'> = {
  active: 'good',
  probation: 'info',
  suspended: 'warning',
  terminated: 'critical',
  resigned: 'neutral',
};

/** What to show as someone's employment status. `status` (active / inactive)
 * is the flag attendance, payroll and the mobile app run on; `employment_status`
 * is the HR label on top of it. They can disagree — the mobile app's Resigned
 * screen only flips `status` — so the label never says someone works here when
 * they are inactive, nor that someone who works here has left. Rows loaded
 * before the migration have no `employment_status` and read as Active. */
export function effectiveStatus(e: Pick<Employee, 'status' | 'employment_status'>): EmploymentStatus {
  const label = e.employment_status ?? 'active';
  if (e.status === 'inactive') return label === 'terminated' ? 'terminated' : 'resigned';
  return label === 'probation' || label === 'suspended' ? label : 'active';
}

export const MARITAL_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'other', label: 'Other' },
] as const;

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const NEPAL_PROVINCES = ['Koshi', 'Madhesh', 'Bagmati', 'Gandaki', 'Lumbini', 'Karnali', 'Sudurpashchim'] as const;

export type AddressKind = 'permanent' | 'temporary';
export const ADDRESS_PARTS = ['province', 'district', 'municipality', 'ward', 'tole'] as const;
export type AddressPart = (typeof ADDRESS_PARTS)[number];

export function addressKey(kind: AddressKind, part: AddressPart) {
  return `${kind}_${part}` as const;
}

/** "Tole, Ward 5, Municipality, District, Province" — empty parts are skipped. */
export function formatAddress(e: Partial<Record<string, unknown>>, kind: AddressKind): string {
  const get = (part: AddressPart) => {
    const v = e[addressKey(kind, part)];
    return typeof v === 'string' ? v.trim() : '';
  };
  const ward = get('ward');
  return [get('tole'), ward ? `Ward ${ward}` : '', get('municipality'), get('district'), get('province')]
    .filter(Boolean)
    .join(', ');
}

/** The columns added by 20261101120000_employee_hr_profile.sql. */
export const PROFILE_COLUMNS = [
  'employment_type',
  'employment_status',
  'contract_start',
  'contract_end',
  'reporting_to',
  'official_phone',
  'personal_email',
  'date_of_birth',
  'nationality',
  'marital_status',
  'blood_group',
  'citizenship_no',
  'citizenship_issued_district',
  'citizenship_issue_date',
  'permanent_province',
  'permanent_district',
  'permanent_municipality',
  'permanent_ward',
  'permanent_tole',
  'temporary_province',
  'temporary_district',
  'temporary_municipality',
  'temporary_ward',
  'temporary_tole',
  'father_name',
  'mother_name',
  'grandfather_name',
  'spouse_name',
  'emergency_contact_address',
] as const;

/** Until the migration above has been run, a loaded employee row has none of
 * the PROFILE_COLUMNS keys. Sending them anyway would make every save fail on
 * an unknown column — including edits to the long-standing fields — so keep a
 * value in the update only when the row already has that column, or the person
 * actually filled it in (which then fails with a clear message). */
export function withKnownColumns<T extends Record<string, unknown>>(row: object | null, values: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(values) as (keyof T)[]) {
    const value = values[key];
    if ((row && (key as string) in row) || (value !== null && value !== '' && value !== undefined)) out[key] = value;
  }
  return out;
}

// --- Education ---------------------------------------------------------------

const DEGREE_RANK: Record<string, number> = { 'Under SEE': 1, SEE: 2, Intermediate: 3, Bachelors: 4, Masters: 5 };

/** "Intermediate" is stored as-is (existing rows); +2 is what Nepal calls it. */
export function degreeLabel(degree: string): string {
  return degree === 'Intermediate' ? 'Intermediate (+2)' : degree;
}

export function highestQualification(rows: EmployeeEducation[]): EmployeeEducation | null {
  let best: EmployeeEducation | null = null;
  for (const row of rows) {
    if (!(row.degree in DEGREE_RANK)) continue;
    if (!best || DEGREE_RANK[row.degree] > DEGREE_RANK[best.degree]) best = row;
  }
  return best;
}

export function formatPassingYear(row: Pick<EmployeeEducation, 'year' | 'year_calendar'>): string {
  return row.year ? `${row.year}${row.year_calendar === 'BS' ? ' BS' : ''}` : '';
}

// --- Work experience ---------------------------------------------------------

const DAY_MS = 86400000;

type DateRange = { start: string | null; end: string | null };

/** Days covered by the ranges, counting overlapping stretches once. A range
 * with no start is ignored; no end means "until today". */
export function daysCovered(ranges: DateRange[], today: Date = new Date()): number {
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const spans: [number, number][] = [];
  for (const r of ranges) {
    if (!r.start) continue;
    const start = Date.parse(r.start);
    const end = r.end ? Date.parse(r.end) : todayMs;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    spans.push([start, end]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = 0;
  let curEnd = 0;
  let open = false;
  for (const [s, e] of spans) {
    if (open && s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      if (open) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
      open = true;
    }
  }
  if (open) total += curEnd - curStart;
  return Math.round(total / DAY_MS);
}

/** "3 yrs 2 mos", "5 mos", "Under a month". */
export function formatDuration(days: number): string {
  if (days <= 0) return '—';
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - years * 365.25) / 30.4375);
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} mo${months === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' ') : 'Under a month';
}

/** Experience before joining, time with this company, and the two combined
 * (overlaps counted once — someone who joined while still finishing a job
 * elsewhere isn't credited twice for those weeks). */
export function experienceSummary(
  experience: { start_date: string | null; end_date: string | null }[],
  dateOfJoining: string | null,
  resignedAt: string | null,
  today: Date = new Date()
) {
  const before: DateRange[] = experience.map(x => ({ start: x.start_date, end: x.end_date }));
  const here: DateRange = { start: dateOfJoining, end: resignedAt };
  return {
    previous: daysCovered(before, today),
    here: daysCovered([here], today),
    total: daysCovered([...before, here], today),
  };
}
