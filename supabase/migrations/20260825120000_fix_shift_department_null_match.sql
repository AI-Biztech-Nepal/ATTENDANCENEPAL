-- find_employee_shift() matched a department-level shift template via raw
-- SQL equality (`s.department = emp_dept`), and SQL's `null = null` is
-- `null` (never true) — so any employee or shift with no department set
-- silently fell through to the hardcoded 09:00-18:00 "Default" shift here,
-- while the client's resolveShift() (admin-web/lib/shift.ts) uses JS `===`
-- (`null === null` is `true`) and correctly matches the real shift. Payroll
-- (server-computed via this function) and the Dashboard/Attendance Report
-- (client-computed) could therefore disagree on the same employee/day's
-- late/early status whenever department is null — a common case, since
-- department is optional. `is not distinct from` is Postgres's null-safe
-- equality: true for null/null and non-null/non-null matches alike, mirroring
-- the client's `===` exactly. Also adds a stable `order by ... limit 1` (both
-- branches previously had none), so two department-level shift templates for
-- the same department resolve to the same one deterministically instead of
-- depending on undefined row order — still an admin data-entry mistake worth
-- preventing at the UI level, but this at least keeps client and server
-- consistent with each other if it happens.

create or replace function find_employee_shift(emp_id uuid)
returns table(shift_name text, start_time time, end_time time, grace_minutes integer) as $$
declare
  emp_dept text;
begin
  return query
    select s.name, s.start_time, s.end_time, s.grace_minutes
    from shifts s where s.employee_id = emp_id
    order by s.id
    limit 1;
  if found then
    return;
  end if;

  select department into emp_dept from employees where id = emp_id;

  return query
    select s.name, s.start_time, s.end_time, s.grace_minutes
    from shifts s where s.department is not distinct from emp_dept and s.employee_id is null
    order by s.id
    limit 1;
  if found then
    return;
  end if;

  return query select 'Default'::text, '09:00'::time, '18:00'::time, 10;
end;
$$ language plpgsql stable;
