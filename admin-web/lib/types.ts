export type Branch = {
  id: string;
  name: string;
  branch_code: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
};

/** employees.gender — a null/unset gender behaves like 'other': only
 * company-wide ('all') holidays apply to them, never a gender-scoped one. */
export type Gender = 'male' | 'female' | 'other';

/** company_holidays.applies_to — 'all' is the default and every holiday's
 * behaviour before gender scoping existed. */
export type HolidayScope = 'all' | 'male' | 'female';

export type Department = {
  id: string;
  name: string;
  created_at: string;
};

export type BranchDepartment = {
  branch_id: string;
  department_id: string;
};

export type Employee = {
  id: string;
  employee_code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  department: string | null;
  designation: string | null;
  branch_id: string | null;
  fingerprint_id: string | null;
  username: string | null;
  profile_photo_url: string | null;
  gender: Gender | null;
  status: 'active' | 'inactive';
  date_of_joining: string | null;
  resigned_at: string | null;
  salary: number | null;
  allowance: number | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  skills: string[];
  pan_no: string | null;
  ssf_no: string | null;
  attendance_exempt: boolean;
  created_at: string;
};

export type EmployeeEducation = {
  id: string;
  employee_id: string;
  degree: string;
  institution: string | null;
  year: number | null;
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

export type PointRedemption = {
  id: string;
  employee_id: string;
  points_requested: number;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  employee_id: string | null;
  role: 'admin' | 'hr' | 'employee';
  full_name: string | null;
  company_name: string | null;
  pan_no: string | null;
  location: string | null;
  photo_url: string | null;
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

export type AttendanceLog = {
  id: string;
  employee_id: string;
  device_id: string | null;
  punch_time: string;
  punch_type: '0' | '1' | '2' | '3';
  method: 'zkteco' | 'gps' | 'qr' | 'selfie';
  verification_mode: string | null;
};

/** Column list for `.from('attendance_logs').select(...)` — exactly the
 * AttendanceLog fields. The table also has lat/lng/accuracy_m/qr_token_id/
 * selfie_url/match_score/created_at, which nothing reads; `select('*')` pulled
 * those on every punch row (a big chunk of egress on the payroll/report pages). */
export const ATTENDANCE_LOG_COLUMNS = 'id, employee_id, device_id, punch_time, punch_type, method, verification_mode';

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

export type TaskTimeLog = {
  id: string;
  task_id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
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

export type CompanyHoliday = {
  id: string;
  company_id: string;
  holiday_date: string;
  name: string;
  applies_to: HolidayScope;
  created_by: string | null;
  created_at: string;
};

export type PayrollSummary = {
  id: string;
  employee_id: string;
  work_date: string;
  shift_name: string | null;
  check_in: string | null;
  check_out: string | null;
  total_hours: number;
  is_late: boolean;
  late_minutes: number;
  is_early_departure: boolean;
  early_departure_minutes: number;
  overtime_hours: number;
  manually_corrected: boolean;
  overtime_approved: boolean;
  computed_at: string;
};

/** Column list for `.from('payroll_summaries').select(...)` — exactly the
 * PayrollSummary fields, so `select(PAYROLL_SUMMARY_COLUMNS)` is identical to
 * `select('*')` for the code but future-proof against wide columns. */
export const PAYROLL_SUMMARY_COLUMNS =
  'id, employee_id, work_date, shift_name, check_in, check_out, total_hours, is_late, late_minutes, is_early_departure, early_departure_minutes, overtime_hours, manually_corrected, overtime_approved, computed_at';
