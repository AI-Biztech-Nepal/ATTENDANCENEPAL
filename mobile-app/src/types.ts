export type PunchMethod = 'zkteco' | 'gps' | 'qr' | 'selfie';

/** employees.gender — nullable; a null/unset gender gets company-wide ('all')
 * holidays only, never a gender-scoped one. */
export type Gender = 'male' | 'female';

/** company_holidays.applies_to — 'all' is the default. */
export type HolidayScope = 'all' | 'male' | 'female';

export type Profile = {
  id: string;
  employee_id: string | null;
  role: 'admin' | 'hr' | 'employee';
};

export type Employee = {
  id: string;
  employee_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  branch_id: string | null;
  fingerprint_id: string | null;
  /** Paid-leave days this employee gets each fiscal year, set on the
   * dashboard's Leave page. Null = none (there is no company-wide default). */
  annual_leave_days?: number | null;
  username: string | null;
  gender: Gender | null;
  status: 'active' | 'inactive';
  salary: number | null;
  allowance: number | null;
  profile_photo_url: string | null;
  date_of_joining: string | null;
  resigned_at: string | null;
  pan_no: string | null;
  ssf_no: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  skills: string[];
  attendance_exempt: boolean;
  /** The company this employee belongs to — names the top folder of their stored documents. */
  company_id?: string | null;

  // HR profile columns (supabase/migrations/20261101120000_employee_hr_profile.sql).
  // Optional: a row loaded before that migration has been run doesn't carry them.
  employment_type?: 'permanent' | 'contract' | 'part_time' | null;
  /** HR label layered on `status` — read it through effectiveStatus(). */
  employment_status?: 'active' | 'probation' | 'suspended' | 'terminated' | 'resigned';
  contract_start?: string | null;
  contract_end?: string | null;
  reporting_to?: string | null;
  official_phone?: string | null;
  personal_email?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  marital_status?: 'single' | 'married' | 'other' | null;
  blood_group?: string | null;
  citizenship_no?: string | null;
  citizenship_issued_district?: string | null;
  citizenship_issue_date?: string | null;
  permanent_province?: string | null;
  permanent_district?: string | null;
  permanent_municipality?: string | null;
  permanent_ward?: string | null;
  permanent_tole?: string | null;
  temporary_province?: string | null;
  temporary_district?: string | null;
  temporary_municipality?: string | null;
  temporary_ward?: string | null;
  temporary_tole?: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  grandfather_name?: string | null;
  spouse_name?: string | null;
  emergency_contact_address?: string | null;
};

export type EmployeeEducation = {
  id: string;
  employee_id: string;
  degree: string;
  institution: string | null;
  /** Awarding board / university. Optional until the HR profile migration is run. */
  board_university?: string | null;
  year: number | null;
  /** Whether `year` is Bikram Sambat or AD. */
  year_calendar?: 'AD' | 'BS';
};

export type EmployeeWorkExperience = {
  id: string;
  employee_id: string;
  employer: string;
  role: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type EmployeeTraining = {
  id: string;
  employee_id: string;
  title: string;
  provider: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type Branch = {
  id: string;
  name: string;
  branch_code: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
};

export type Department = {
  id: string;
  name: string;
};

export type BranchDepartment = {
  branch_id: string;
  department_id: string;
};

export type Device = {
  id: string;
  name: string;
  branch_id: string | null;
  ip_address: string;
  port: number;
  serial_number: string | null;
  status: 'online' | 'offline';
  last_sync: string | null;
};

export type DeviceSyncEvent = {
  id: string;
  device_id: string;
  sync_type: 'users' | 'logs';
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  requested_at: string;
  completed_at: string | null;
  summary: string | null;
  error: string | null;
};

export type Shift = {
  id: string;
  name: string;
  type: 'fixed' | 'flexible' | 'rotational';
  start_time: string;
  end_time: string;
  grace_minutes: number;
  department: string | null;
  employee_id: string | null;
};

export type PayrollSummary = {
  id: string;
  employee_id: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  total_hours: number;
  overtime_hours: number;
  is_late: boolean;
  late_minutes: number;
  is_early_departure: boolean;
  early_departure_minutes: number;
};

export type AttendanceLog = {
  id: string;
  employee_id: string;
  device_id?: string | null;
  punch_time: string;
  punch_type: '0' | '1' | '2' | '3';
  method: PunchMethod;
  lat?: number | null;
  lng?: number | null;
  selfie_url?: string | null;
  match_score?: number | null;
};

/** Columns to request for a fetched AttendanceLog. Only these are read from
 * fetched rows; lat/lng/selfie_url/match_score/accuracy_m/etc. that `select('*')`
 * also pulled are never read back, just written on insert. */
export const ATTENDANCE_LOG_COLUMNS = 'id, employee_id, device_id, punch_time, punch_type, method';

/** Columns to request for a fetched PayrollSummary — exactly the type's fields. */
export const PAYROLL_SUMMARY_COLUMNS =
  'id, employee_id, work_date, check_in, check_out, total_hours, overtime_hours, is_late, late_minutes, is_early_departure, early_departure_minutes';

export type TaskStatus = 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected';
export type TaskSource = 'assigned' | 'self';

export type Task = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_by: string | null;
  points: number;
  status: TaskStatus;
  source: TaskSource;
  due_date: string | null;
  work_notes: string | null;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type LeaderboardRow = {
  employee_id: string;
  name: string;
  department: string | null;
  total_points: number;
  tasks_completed: number;
  profile_photo_url: string | null;
};

export type TaskTimeLog = {
  id: string;
  task_id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

export type LeaveType = 'sick' | 'casual' | 'annual' | 'unpaid';

export type LeaveRequest = {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type CompanyHoliday = {
  id: string;
  company_id: string;
  holiday_date: string;
  name: string;
  applies_to: HolidayScope;
  created_by: string | null;
  created_at: string;
};

export type CorrectionRequest = {
  id: string;
  employee_id: string;
  work_date: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  lat: number | null;
  lng: number | null;
};

export type AttendanceGpsRequest = {
  id: string;
  employee_id: string;
  punch_type: '0' | '1' | '2' | '3';
  punch_time: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};
