-- Employment history: a log of every transfer, promotion and pay change.
--
-- It is written by the database itself, not by the pages. A trigger on
-- `employees` records a row whenever someone's branch, designation,
-- department, reporting-to, basic salary or allowance changes, so every way of
-- editing is covered — the profile page, the directory's dropdowns, the
-- Payroll and Salary Structure pages, the phone app, the employee's own
-- profile edit — without any of them having to remember to log.
--
-- Run once, in the Supabase SQL editor, after 20261101120000_employee_hr_profile.sql
-- (it needs `employees.reporting_to`).

-- ---------------------------------------------------------------------------
-- One row per edit. `changes` holds only what changed, as old/new pairs:
--   { "branch":      { "from": "Thamel",    "to": "Lakeside" },
--     "designation": { "from": "Therapist", "to": "Senior Therapist" },
--     "department", "reports_to", "salary", "allowance" … }
-- Branch and manager are stored by NAME as they were at the time, so the
-- history still reads correctly after a branch is renamed or a person leaves.
-- ---------------------------------------------------------------------------

create table if not exists employee_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid references companies(id),
  -- The day the change takes effect. Filled with the day of the edit (Nepal
  -- time) and corrected afterwards when, say, a promotion is backdated.
  effective_date date not null default ((now() at time zone 'Asia/Kathmandu')::date),
  changes jsonb not null,
  reason text,
  remark text,
  -- 'auto' = recorded by the trigger below; 'manual' = typed in by HR to
  -- record something that happened before this system was used.
  source text not null default 'auto',
  changed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint employee_history_source_check check (source in ('auto', 'manual')),
  constraint employee_history_changes_check check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb)
);
create index if not exists idx_employee_history_employee
  on employee_history(employee_id, effective_date desc, created_at desc);

alter table employee_history enable row level security;

-- company_id is stamped from the employee, never trusted from the caller.
drop trigger if exists trg_stamp_company_id on employee_history;
create trigger trg_stamp_company_id before insert on employee_history
  for each row execute function stamp_company_id_from_employee();

drop policy if exists "employee_history: admin or hr full access" on employee_history;
create policy "employee_history: admin or hr full access" on employee_history
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

-- What the trigger recorded stays as recorded: an admin can add a note, move the
-- effective date, or delete an entry made by a typo fix — but cannot rewrite
-- what changed.
revoke update on employee_history from authenticated, anon;
grant update (effective_date, reason, remark) on employee_history to authenticated;

-- ---------------------------------------------------------------------------
-- The trigger.
--
-- A first assignment is not a transfer or a promotion: a field is logged only
-- when it HAD a value before (and a basic salary of 0 or none counts as "not
-- set yet"). SECURITY DEFINER because an ordinary employee can change their
-- own department / designation through update_my_profile(), and must not be
-- blocked just because they are not allowed to write to this table.
-- ---------------------------------------------------------------------------

create or replace function log_employee_history()
returns trigger as $$
declare
  changes jsonb := '{}'::jsonb;
  old_text text;
  new_text text;
  old_name text;
  new_name text;
begin
  old_text := nullif(btrim(old.designation), '');
  new_text := nullif(btrim(new.designation), '');
  if old_text is not null and new_text is distinct from old_text then
    changes := changes || jsonb_build_object('designation', jsonb_build_object('from', old_text, 'to', new_text));
  end if;

  old_text := nullif(btrim(old.department), '');
  new_text := nullif(btrim(new.department), '');
  if old_text is not null and new_text is distinct from old_text then
    changes := changes || jsonb_build_object('department', jsonb_build_object('from', old_text, 'to', new_text));
  end if;

  if old.branch_id is not null and new.branch_id is distinct from old.branch_id then
    select name into old_name from branches where id = old.branch_id;
    select name into new_name from branches where id = new.branch_id;
    changes := changes || jsonb_build_object(
      'branch', jsonb_build_object('from', coalesce(old_name, 'Unknown branch'), 'to', new_name)
    );
  end if;

  if old.reporting_to is not null and new.reporting_to is distinct from old.reporting_to then
    select name into old_name from employees where id = old.reporting_to;
    select name into new_name from employees where id = new.reporting_to;
    changes := changes || jsonb_build_object(
      'reports_to', jsonb_build_object('from', coalesce(old_name, 'Unknown'), 'to', new_name)
    );
  end if;

  if coalesce(old.salary, 0) > 0 and new.salary is distinct from old.salary then
    changes := changes || jsonb_build_object('salary', jsonb_build_object('from', old.salary, 'to', new.salary));
  end if;

  if old.allowance is not null and new.allowance is distinct from old.allowance then
    changes := changes || jsonb_build_object('allowance', jsonb_build_object('from', old.allowance, 'to', new.allowance));
  end if;

  if changes <> '{}'::jsonb then
    insert into employee_history (employee_id, company_id, changes)
    values (new.id, new.company_id, changes);
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_log_employee_history on employees;
create trigger trg_log_employee_history
  after update of branch_id, designation, department, reporting_to, salary, allowance on employees
  for each row
  when (
    old.branch_id is distinct from new.branch_id
    or old.designation is distinct from new.designation
    or old.department is distinct from new.department
    or old.reporting_to is distinct from new.reporting_to
    or old.salary is distinct from new.salary
    or old.allowance is distinct from new.allowance
  )
  execute function log_employee_history();
