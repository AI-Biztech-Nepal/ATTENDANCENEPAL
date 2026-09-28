-- Superadmin "Delete company" — two tiers, per the actual risk of each:
--
-- 1. Suspend (soft, reversible): flips companies.status and bans every
--    login under that company via the Auth Admin API (done in the API
--    route, not here — banning is a GoTrue Admin call, not SQL). All data
--    stays intact; unsuspending just lifts the ban. This is a status flag
--    only — nothing in this migration enforces it (no RLS/my_company_id()
--    change), since the ban itself is what actually locks people out at
--    sign-in; the column exists so the superadmin panel can show/filter by
--    it.
--
-- 2. Hard delete (permanent, no undo): superadmin_delete_company() below,
--    a single SECURITY DEFINER function so the whole cascade runs as ONE
--    transaction — if anything in here fails (an FK I didn't anticipate,
--    a table added later without being wired in here), Postgres rolls the
--    entire call back and the company is left exactly as it was, never
--    half-deleted. Restricted to service_role only (see the revoke/grant
--    at the bottom) — this must never be callable directly by an
--    authenticated client, only by the superadmin API route (which does
--    its own allowlist check before ever calling this).
--
--    Deletes `profiles` rows directly by company_id here, rather than
--    deleting auth.users first and relying on profiles.id's own cascade —
--    this function never touches the auth schema at all, so it has zero
--    dependency on the Auth Admin API. The Next.js route deletes the
--    now-orphaned auth.users rows in a second pass AFTER this commits,
--    using the same admin.auth.admin.deleteUser() already used elsewhere
--    in this codebase (see bridge-credentials, create-login). That
--    ordering means a failure in the auth cleanup pass can only ever leave
--    a few harmless orphaned logins behind (no company, no profile, no
--    employee) — never a half-deleted company.

alter table companies add column if not exists status text not null default 'active' check (status in ('active', 'suspended'));
alter table companies add column if not exists suspended_at timestamptz;

create or replace function superadmin_delete_company(target_company_id uuid)
returns void as $$
begin
  -- Level 0: leaf tables — nothing else references these, safe to delete
  -- first regardless of order among themselves. reviewed_by/assigned_by/
  -- created_by/requested_by pointers at profiles(id) are already
  -- on-delete-set-null (see 20260817180000_nullify_deleted_user_references)
  -- so deleting profiles later in this same function never blocks on them.
  delete from attendance_correction_requests where company_id = target_company_id;
  delete from attendance_gps_requests where company_id = target_company_id;
  delete from leave_requests where company_id = target_company_id;
  delete from payroll_summaries where company_id = target_company_id;
  delete from point_redemptions where company_id = target_company_id;
  delete from push_tokens where company_id = target_company_id;
  delete from employee_education where company_id = target_company_id;
  delete from employee_work_experience where company_id = target_company_id;
  delete from employee_daily_shifts where company_id = target_company_id;
  delete from employee_weekly_pattern where company_id = target_company_id;
  delete from device_sync_events where company_id = target_company_id;
  delete from device_command_queue where company_id = target_company_id;
  delete from task_time_logs where company_id = target_company_id;
  delete from attendance_logs where company_id = target_company_id;
  delete from company_holidays where company_id = target_company_id;

  -- Level 1: referenced by level 0 (tasks by task_time_logs, shifts by
  -- employee_daily_shifts/employee_weekly_pattern, qr_tokens by
  -- attendance_logs, devices by attendance_logs/device_sync_events/
  -- device_command_queue) — all now clear of level-0 rows.
  delete from tasks where company_id = target_company_id;
  delete from shifts where company_id = target_company_id;
  delete from qr_tokens where company_id = target_company_id;
  delete from devices where company_id = target_company_id;

  -- profiles.employee_id -> employees(id) with no on-delete clause means
  -- employees can't be deleted while a profile still points at one — so
  -- profiles has to go before employees, not after (and not via deleting
  -- auth.users — see the file header for why this deletes profiles
  -- directly instead).
  delete from profiles where company_id = target_company_id;

  -- Level 2: employees (now unreferenced by shifts/tasks/profiles/every
  -- level-0 table above) and branch_departments (branch_id/department_id
  -- both already on-delete-cascade from branches/departments, but deleted
  -- explicitly here too rather than relying on that).
  delete from employees where company_id = target_company_id;
  delete from branch_departments where company_id = target_company_id;

  -- Level 3: departments and branches — now unreferenced by employees,
  -- devices, qr_tokens, or branch_departments.
  delete from departments where company_id = target_company_id;
  delete from branches where company_id = target_company_id;

  -- Finally the company row itself.
  delete from companies where id = target_company_id;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function superadmin_delete_company(uuid) from public;
revoke execute on function superadmin_delete_company(uuid) from anon;
revoke execute on function superadmin_delete_company(uuid) from authenticated;
grant execute on function superadmin_delete_company(uuid) to service_role;
