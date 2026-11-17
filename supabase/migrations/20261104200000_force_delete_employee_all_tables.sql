-- Removing a former employee for good ("Remove" on the Former staff list) failed for anyone who had a daily
-- roster, a weekly shift pattern, or a phone registered for notifications: those three tables point at the
-- employee with no "on delete" rule, and admin_force_delete_employee() never cleared them, so the database
-- refused with a foreign-key error.
--
-- This is the same function as in 20260805120000_tenant_rpc_updates.sql (admins only, and only people in the
-- admin's own company), with those three deletes added. Everything else that points at an employee either is
-- deleted below or goes with them automatically (documents, exit records, appraisals, notifications, history).
--
-- Re-runnable. Run once in the Supabase SQL editor.

create or replace function admin_force_delete_employee(p_employee_id uuid)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admins can permanently delete an employee';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and company_id = my_company_id()) then
    raise exception 'Employee not found';
  end if;

  delete from task_time_logs where employee_id = p_employee_id;
  delete from tasks where assigned_to = p_employee_id;
  delete from point_redemptions where employee_id = p_employee_id;
  delete from employee_education where employee_id = p_employee_id;
  delete from employee_work_experience where employee_id = p_employee_id;
  delete from attendance_gps_requests where employee_id = p_employee_id;
  delete from attendance_correction_requests where employee_id = p_employee_id;
  delete from leave_requests where employee_id = p_employee_id;
  delete from payroll_summaries where employee_id = p_employee_id;
  delete from attendance_logs where employee_id = p_employee_id;
  -- Added: their roster, weekly shift pattern and notification phones.
  delete from employee_daily_shifts where employee_id = p_employee_id;
  delete from employee_weekly_pattern where employee_id = p_employee_id;
  delete from push_tokens where employee_id = p_employee_id;
  delete from shifts where employee_id = p_employee_id;
  update profiles set employee_id = null where employee_id = p_employee_id;
  delete from employees where id = p_employee_id;
end;
$$ language plpgsql security definer set search_path = public;
