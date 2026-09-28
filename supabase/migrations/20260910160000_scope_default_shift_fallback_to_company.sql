-- find_employee_shift(): the department fallback now only considers the
-- employee's OWN company's shifts.
--
-- It picked "the first shift (by id) matching this department with no
-- employee_id" across every tenant. 20260825120000 made a NULL department
-- match a NULL department, which put every company's unassigned shifts in
-- one pool; the first of them by id is Ashadeep's "DN 24 Hours Duty".
--
-- That was masked by RLS as long as compute_payroll_summaries() (invoker
-- rights) was only run by a signed-in admin: RLS hid other tenants' shifts.
-- Run from the SQL editor, or by any future pg_cron nightly job, it runs as
-- a superuser that bypasses RLS -- so an employee in Chiyapur, Mansa or
-- Soulful with no own shift and no department would have been computed
-- against Ashadeep's 24-hour duty. 20260805120000 already anticipated this
-- for the company_id WRITTEN on each row; the shift lookup was missed.
--
-- The per-employee shift (s.employee_id = emp_id) was already inherently
-- scoped and is unchanged. Only the fallback gains a company_id match.
-- Nothing is recomputed by this migration.

create or replace function find_employee_shift(emp_id uuid)
returns table(shift_name text, start_time time, end_time time, grace_minutes integer) as $$
declare
  emp_dept text;
  emp_company uuid;
begin
  return query
    select s.name, s.start_time, s.end_time, s.grace_minutes
    from shifts s where s.employee_id = emp_id
    order by s.id
    limit 1;
  if found then
    return;
  end if;

  select department, company_id into emp_dept, emp_company from employees where id = emp_id;

  return query
    select s.name, s.start_time, s.end_time, s.grace_minutes
    from shifts s
    where s.department is not distinct from emp_dept
      and s.employee_id is null
      and s.company_id = emp_company
    order by s.id
    limit 1;
  if found then
    return;
  end if;

  return query select 'Default'::text, '09:00'::time, '18:00'::time, 10;
end;
$$ language plpgsql stable;
