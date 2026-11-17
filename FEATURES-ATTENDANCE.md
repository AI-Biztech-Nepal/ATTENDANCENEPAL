# Attendance: per-organization features (Step 0 inventory)

Attendance's half of the shared feature-flag brief (`FEATURE-FLAGS.md`, owned by the Portal). This is
**Step 0**: what is genuinely separable today, with proposed keys. Nothing is enforced yet — see
[Status](#status). Keys are permanent once the Portal catalogue ships, so confirm them first.

Checked against the code and both Supabase projects on 2026-11-06.

## Status

| | |
|---|---|
| Portal contract (`core.features`, `core.org_features`, `core.feature_on`, `core.org_features()`) | **Not built.** The portal project's `core` schema has neither table and no functions at all. |
| Where Attendance runs | The **old** project (`whaahjtqmlbwrfppogsw`). `admin-web/.env.local` points at it. The portal holds only a staging copy (13 companies, mapped to orgs in `core.legacy_tenant_map`). |
| Consequence | There is nothing to read flags from yet, and any migration in `supabase/migrations/` that mentions `core.*` would **fail on push** (the old project has no `core` schema). So no guards or UI gating are added in this repo yet. |

Order of work: confirm this inventory → Portal PR (tables, functions, catalogue seed from
[§6](#6-catalogue-seed-for-the-portal-pr)) → Attendance cut-over → Attendance guards and UI gating, in the
portal-era migration set.

## 1. Proposed features

All default **on**: every one of these exists today, and installed phone apps must treat a missing flag as
the default, never as off.

| Key | Name | Needs | Default | Touches |
|---|---|---|---|---|
| `attendance.devices` | Biometric devices (ZKTeco) | | on | **DB** `devices`, `device_command_queue`, `device_sync_events`; `queue_device_userinfo_sync`, `devices_with_punches`. **API** `admin-web/app/api/bridge-credentials`; the `zkteco-bridge` worker. **Web** `/devices`, the dashboard's "Devices n/m online" line and "Biometric devices" section (device names on punches stay: that is attribution). **Mobile** Devices screen, More-tile online count. |
| `attendance.tasks` | Tasks | | on | **DB** `tasks`, `task_time_logs`; `start_task`, `start_task_timer`, `stop_task_timer`, `submit_task`. **Web** `/tasks`, `/my-tasks`. **Mobile** Tasks tile, My Tasks tab. |
| `attendance.points` | Points and rewards | `attendance.tasks` | on | **DB** `point_redemptions`; `approve_point_redemption`, `get_leaderboard`. **Web** redemptions on `/tasks`, `PointsCard`, `Leaderboard`. **Mobile** `Leaderboard`, redemption flows in the Tasks screens. Points are the sum of approved task points, hence the dependency. |
| `attendance.hr_records` | HR file (documents, history, conduct, performance, CV) | | on | **DB** `employee_documents` (+ storage bucket `employee-documents`), `employee_history`, `employee_conduct_records`, `employee_appraisals`, `employee_awards`, `employee_education`, `employee_work_experience`, `employee_training`; `update_my_hr_profile`, `log_employee_history`. **Web** HR sections of `/employees/[id]` and `/my-profile`. **Mobile** `components/hr/*`, `components/employee/My*Cards`. |
| `attendance.hr_alerts` | Contract-end alerts | `attendance.hr_records` | on | **DB** `hr_alert_log`. **API** Edge Function `notify-hr-alerts` (daily). **Mobile** `HrAlertsProvider`, `lib/hrAlerts.ts`. |
| `attendance.payroll` | Payroll and salary | | on | **DB** `employees.salary`, `employees.allowance`, `employees.ssf_no`; company rates (`pf_rate`, `ssf_rate`, `ssf_employer_rate`, `tds_rate`, `overtime_rate`, `ot_*`, `payroll_format`, `payroll_report_columns`). **Web** `/payroll`, `/payroll/[employeeId]`, `/salary-structure`, `/my-payroll`, `StaffSalarySheet`, `PayrollColumnsMenu`. **Mobile** Payroll tabs (admin and employee), `AdminPayrollDetailScreen`. |
| `attendance.corrections` | Corrections and out-of-fence requests | | on | **DB** `attendance_correction_requests`, `attendance_gps_requests`; `approve_attendance_correction`, `approve_attendance_gps_request`. **Web** `/corrections`, the "fix a missed punch" view and the out-of-fence request inside `/checkin` (these are views of one page, not nav items, so gating must hide them within the page), `lib/pendingApprovals.ts`. **Mobile** Corrections screen, `FixPunchScreen`, `PendingApprovals`. |

Corrected punches stay in `attendance_logs` (and `payroll_summaries.manually_corrected`) when this is off:
switching off hides the request flow, it does not undo anything already approved.

## 2. Stays core (not a feature)

A flag only fits what can be off without breaking the rest of the service. These can't:

| Area | Why it is core |
|---|---|
| **Holidays / week-off** (`company_holidays`, `employee_weekly_pattern`, `employee_daily_shifts`) | Read by the attendance report, dashboard, calendar and payroll (25+ files) to tell *holiday* from *absent*. The brief's example `attendance.holidays` does not hold. |
| **Leave** (`leave_requests`) | Same: read by the report, dashboard and calendar (26 files), and `block_attendance_on_leave` sits on the punch path. Could become `attendance.leave` later, but only after deciding whether *approved past leave* should still colour the report once it is off. |
| **Daily results** (`payroll_summaries`, `compute_payroll_summaries`) | Despite the name this holds hours, late, early and overtime only — no money. The dashboard, report and calendar read it. `attendance.payroll` covers the *salary* side only. |
| **Separations / Resigned** (`employee_separations`) | Drives employee status and the directory filter (10 files). |
| Check-in methods (GPS, QR, selfie), shifts, roster, branches | Per-branch/employee **policy** and the base of the punch ledger — configuration, not features. |
| Notifications, push, superadmin and impersonation | Platform plumbing, not per-org options. |

## 3. Corrections to the brief's example keys

- `attendance.holidays` → **core** (above). Drop it.
- `attendance.points` → needs `attendance.tasks`.
- `attendance.payroll` → narrower than it reads: pay and salary screens only; the daily summary engine keeps running.

## 4. How each layer would enforce it here

Attendance has no REST server of its own. Both apps call Supabase directly, so the layers map like this:

- **Database (the real gate).** RLS on each feature's tables, plus a guard at the top of each feature's
  `SECURITY DEFINER` RPC, both calling `core.feature_on(org, key)`. Attendance rows carry `company_id`, not an
  org id, so this needs a company→org helper. In the portal copy the link is `core.legacy_tenant_map`
  (`service_key = 'attendance'`, `legacy_id = company id`); there is no `org_id` column. **Ask the Portal to
  expose that as a function** rather than every policy joining the map.
- **API.** Only two places are API-shaped: `app/api/bridge-credentials` (`attendance.devices`) and the
  Edge Function `notify-hr-alerts` (skip companies with `attendance.hr_alerts` off). Everything else is the
  database layer above. Return `403 {"feature": "..."}` from those two.
- **UI.** Web: `components/Sidebar.tsx` `NAV_ITEMS`, `EmployeeShell.tsx` nav, the tabs on `/employees/[id]`, the
  dashboard tiles. Mobile: `MoreScreen.tsx` tiles, the tabs in `App.tsx`, the screens. Load
  `core.org_features(org)` once per session; a missing flag means the default; a hidden URL shows a polite "not
  enabled for your organization" page.

## 5. Known hard part: `attendance.payroll` in the database

Salary lives in **columns of `employees`** (`salary`, `allowance`, `ssf_no`), and the HR directory reads that
table, so RLS cannot hide just those columns. Three honest options, in rising effort:

1. Gate the screens and RPCs only, and accept that a hand-made direct query could still read the salary column.
2. Revoke column-level `select` on those columns and expose them through a feature-guarded view or RPC.
3. Move salary data to its own table (a migration plus app changes) and put RLS on it.

The brief says "hiding a menu item is not enforcement", which rules out 1 for a customer who must not see
salaries. This needs your call before `attendance.payroll` is wired.

## 6. Catalogue seed (for the Portal PR)

Descriptions are owner-facing. Same shape as the brief's `core.features`.

```sql
insert into core.features (key, service_key, name, description, requires, default_on) values
  ('attendance.devices',     'attendance', 'Biometric devices',
   'Connect fixed fingerprint terminals (ZKTeco) and sync their punches.', '{}', true),
  ('attendance.tasks',       'attendance', 'Tasks',
   'Assign tasks to employees and track the time they spend.', '{}', true),
  ('attendance.points',      'attendance', 'Points and rewards',
   'Employees earn points for approved tasks and can redeem them.', '{attendance.tasks}', true),
  ('attendance.hr_records',  'attendance', 'HR file',
   'Documents, work history, conduct, performance and CV for each employee.', '{}', true),
  ('attendance.hr_alerts',   'attendance', 'Contract-end alerts',
   'Notify admins and HR before an employee''s contract ends.', '{attendance.hr_records}', true),
  ('attendance.payroll',     'attendance', 'Payroll and salary',
   'Salary structure, payroll reports and employees'' own pay view.', '{}', true),
  ('attendance.corrections', 'attendance', 'Corrections and requests',
   'Missed-punch corrections and out-of-location check-in requests.', '{}', true);
```

## 7. Decisions needed

1. **Which keys ship?** Rule 5 says a flag exists only when a real second customer needs the feature absent.
   Registering all seven in the catalogue costs nothing (all default on); the question is which get
   *enforcement* built first. Which customer is asking, and for what?
2. **`attendance.payroll` database approach** — option 1, 2 or 3 in §5.
3. **Leave and holidays stay core** — confirm, or say if a customer needs leave switched off (see §2 for the
   open question that comes with it).
4. **Portal:** will it expose a company→org function for Attendance (§4)?
