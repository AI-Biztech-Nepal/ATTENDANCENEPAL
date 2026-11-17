// Types and helpers for appraisals, awards and conduct records
// (20261101200000_employee_performance_conduct.sql).

export type PeriodType = 'monthly' | 'quarterly' | 'annual';
export const PERIOD_TYPES: { value: PeriodType; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
];

export type Appraisal = {
  id: string;
  employee_id: string;
  appraisal_date: string;
  period_type: PeriodType;
  period_start: string | null;
  period_end: string | null;
  rating: number;
  remarks: string | null;
  evaluated_by: string | null;
  skills_assessment: string | null;
};

export type Award = {
  id: string;
  employee_id: string;
  title: string;
  awarded_on: string;
  description: string | null;
};

export type ConductKind = 'warning' | 'disciplinary' | 'grievance';
export const CONDUCT_KINDS: { value: ConductKind; label: string; plural: string }[] = [
  { value: 'warning', label: 'Warning', plural: 'Warnings' },
  { value: 'disciplinary', label: 'Disciplinary action', plural: 'Disciplinary actions' },
  { value: 'grievance', label: 'Grievance', plural: 'Grievances' },
];

export type WarningLevel = 'verbal' | 'written' | 'show_cause' | 'final_warning';
export const WARNING_LEVELS: { value: WarningLevel; label: string }[] = [
  { value: 'verbal', label: 'Verbal warning' },
  { value: 'written', label: 'Written warning' },
  { value: 'show_cause', label: 'Show-cause notice' },
  { value: 'final_warning', label: 'Final warning' },
];

export type ConductStatus = 'open' | 'under_review' | 'closed';
export const CONDUCT_STATUSES: { value: ConductStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'under_review', label: 'Under review' },
  { value: 'closed', label: 'Closed' },
];

export type ConductRecord = {
  id: string;
  employee_id: string;
  kind: ConductKind;
  record_date: string;
  title: string;
  details: string | null;
  warning_level: WarningLevel | null;
  status: ConductStatus;
  final_decision: string | null;
  decided_on: string | null;
};

/** The word for a score out of 5. A half step stays in the band below it — 3.5 is
 * still "Meets expectations", and only a full 5 is "Outstanding" — so a label
 * never reads kinder than the number. */
export function ratingLabel(rating: number): string {
  switch (Math.floor(rating)) {
    case 1:
      return 'Poor';
    case 2:
      return 'Needs improvement';
    case 3:
      return 'Meets expectations';
    case 4:
      return 'Exceeds expectations';
    default:
      return 'Outstanding';
  }
}

/** Mean rating to one decimal, or null with nothing to average. */
export function averageRating(appraisals: Pick<Appraisal, 'rating'>[]): number | null {
  if (appraisals.length === 0) return null;
  const mean = appraisals.reduce((sum, a) => sum + Number(a.rating), 0) / appraisals.length;
  return Math.round(mean * 10) / 10;
}

export function periodLabel(type: PeriodType): string {
  return PERIOD_TYPES.find(p => p.value === type)?.label ?? type;
}

export function warningLevelLabel(level: WarningLevel | null): string {
  return WARNING_LEVELS.find(l => l.value === level)?.label ?? 'Warning';
}

export function statusLabel(status: ConductStatus): string {
  return CONDUCT_STATUSES.find(s => s.value === status)?.label ?? status;
}

/** Half-star display for a score out of 5: 4.5 → "★★★★½" (no emoji, just glyphs). */
export function starString(rating: number): string {
  const whole = Math.floor(rating);
  const half = rating - whole >= 0.5;
  return '★'.repeat(whole) + (half ? '½' : '') + '☆'.repeat(5 - whole - (half ? 1 : 0));
}
