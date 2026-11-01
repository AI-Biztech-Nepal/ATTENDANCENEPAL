-- Employee separation: the exit checklist and final settlement for someone
-- leaving (resignation, termination, retirement, other). One row per employee,
-- created when the process starts — while the person is still working out their
-- notice, or when they are marked as having left.
--
-- Money lives here, so it is admin / HR of the same company only, and there is
-- deliberately no policy letting an employee read their own row.
--
-- Run once, in the Supabase SQL editor, after 20261101120000_employee_hr_profile.sql.

create table if not exists employee_separations (
  id uuid primary key default gen_random_uuid(),
  -- One separation per employee. Deleting the employee deletes the row.
  employee_id uuid not null unique references employees(id) on delete cascade,
  company_id uuid references companies(id),

  separation_type text not null default 'resignation',
  resignation_submitted_on date,
  resignation_effective_on date,
  -- The last day worked. Kept here (rather than only in employees.resigned_at)
  -- because someone serving notice is still active, and employees.resigned_at
  -- makes their own profile say "Resigned". When the person is marked as having
  -- left, the admin site copies it across.
  last_working_on date,
  notice_required_days integer,
  notice_served_days integer,
  separation_reason text,

  -- Checklist
  exit_interview_status text not null default 'pending',
  exit_interview_on date,
  clearance_status text not null default 'pending',
  clearance_note text,
  uniform_id_status text not null default 'pending',
  asset_keys_status text not null default 'pending',
  asset_equipment_status text not null default 'pending',
  asset_device_status text not null default 'pending',
  asset_other_status text not null default 'pending',
  asset_other_note text,
  experience_letter_status text not null default 'pending',
  experience_letter_on date,

  -- Settlement. Payments the company owes the person, then what comes off.
  final_salary numeric not null default 0,
  leave_encashment numeric not null default 0,
  incentive_settlement numeric not null default 0,
  other_payments numeric not null default 0,
  outstanding_advances numeric not null default 0,
  other_deductions numeric not null default 0,
  other_dues_note text,
  settlement_status text not null default 'pending',
  settlement_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),

  constraint employee_separations_type_check check (separation_type in ('resignation', 'termination', 'retirement', 'other')),
  constraint employee_separations_exit_interview_check check (exit_interview_status in ('pending', 'completed')),
  constraint employee_separations_clearance_check check (clearance_status in ('pending', 'in_progress', 'cleared')),
  constraint employee_separations_uniform_check check (uniform_id_status in ('pending', 'returned', 'not_applicable')),
  constraint employee_separations_keys_check check (asset_keys_status in ('pending', 'returned', 'not_applicable')),
  constraint employee_separations_equipment_check check (asset_equipment_status in ('pending', 'returned', 'not_applicable')),
  constraint employee_separations_device_check check (asset_device_status in ('pending', 'returned', 'not_applicable')),
  constraint employee_separations_other_assets_check check (asset_other_status in ('pending', 'returned', 'not_applicable')),
  constraint employee_separations_letter_check check (experience_letter_status in ('pending', 'issued')),
  constraint employee_separations_settlement_check check (settlement_status in ('pending', 'processed', 'completed')),
  constraint employee_separations_notice_check check (
    (notice_required_days is null or notice_required_days >= 0) and (notice_served_days is null or notice_served_days >= 0)
  ),
  constraint employee_separations_amounts_check check (
    final_salary >= 0 and leave_encashment >= 0 and incentive_settlement >= 0
    and other_payments >= 0 and outstanding_advances >= 0 and other_deductions >= 0
  ),
  constraint employee_separations_dates_check check (
    resignation_submitted_on is null or resignation_effective_on is null or resignation_effective_on >= resignation_submitted_on
  )
);

alter table employee_separations enable row level security;

-- company_id is stamped from the employee, never trusted from the caller.
drop trigger if exists trg_stamp_company_id on employee_separations;
create trigger trg_stamp_company_id before insert on employee_separations
  for each row execute function stamp_company_id_from_employee();

-- Who last touched it, and when — set by the database, not by the page.
create or replace function touch_employee_separation()
returns trigger as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_employee_separation on employee_separations;
create trigger trg_touch_employee_separation before update on employee_separations
  for each row execute function touch_employee_separation();

drop policy if exists "employee_separations: admin or hr full access" on employee_separations;
create policy "employee_separations: admin or hr full access" on employee_separations
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());
