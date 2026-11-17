-- Employee HR profile: employment terms, personal details, structured
-- addresses, family names, and qualification / training records.
--
-- Every new column is nullable (or defaulted), so existing rows and the
-- mobile app -- which never names these columns -- keep working untouched.
-- `employees.status` (active / inactive) stays the one flag attendance,
-- payroll and the mobile app run on; `employment_status` below is the HR
-- label layered on top of it (Probation, Suspended, Terminated, ...).
--
-- Run once, in the Supabase SQL editor, after 20261030120000_*.

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------

alter table employees
  -- Employment
  add column if not exists employment_type text,
  add column if not exists employment_status text not null default 'active',
  add column if not exists contract_start date,
  add column if not exists contract_end date,
  add column if not exists reporting_to uuid references employees(id) on delete set null,
  -- Contact (the existing `phone` / `email` are the personal phone and the
  -- official / login email)
  add column if not exists official_phone text,
  add column if not exists personal_email text,
  -- Personal
  add column if not exists date_of_birth date,
  add column if not exists nationality text,
  add column if not exists marital_status text,
  add column if not exists blood_group text,
  add column if not exists citizenship_no text,
  add column if not exists citizenship_issued_district text,
  add column if not exists citizenship_issue_date date,
  -- Permanent address
  add column if not exists permanent_province text,
  add column if not exists permanent_district text,
  add column if not exists permanent_municipality text,
  add column if not exists permanent_ward text,
  add column if not exists permanent_tole text,
  -- Temporary address
  add column if not exists temporary_province text,
  add column if not exists temporary_district text,
  add column if not exists temporary_municipality text,
  add column if not exists temporary_ward text,
  add column if not exists temporary_tole text,
  -- Family
  add column if not exists father_name text,
  add column if not exists mother_name text,
  add column if not exists grandfather_name text,
  add column if not exists spouse_name text,
  add column if not exists emergency_contact_address text;

alter table employees drop constraint if exists employees_employment_type_check;
alter table employees add constraint employees_employment_type_check
  check (employment_type is null or employment_type in ('permanent', 'contract', 'part_time'));

alter table employees drop constraint if exists employees_employment_status_check;
alter table employees add constraint employees_employment_status_check
  check (employment_status in ('active', 'probation', 'suspended', 'terminated', 'resigned'));

alter table employees drop constraint if exists employees_marital_status_check;
alter table employees add constraint employees_marital_status_check
  check (marital_status is null or marital_status in ('single', 'married', 'other'));

alter table employees drop constraint if exists employees_blood_group_check;
alter table employees add constraint employees_blood_group_check
  check (blood_group is null or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

alter table employees drop constraint if exists employees_contract_dates_check;
alter table employees add constraint employees_contract_dates_check
  check (contract_start is null or contract_end is null or contract_end >= contract_start);

alter table employees drop constraint if exists employees_reporting_to_not_self;
alter table employees add constraint employees_reporting_to_not_self
  check (reporting_to is null or reporting_to <> id);

-- People already marked resigned before this column existed.
update employees set employment_status = 'resigned'
where status = 'inactive' and employment_status = 'active';

create index if not exists idx_employees_reporting_to on employees(reporting_to);

-- ---------------------------------------------------------------------------
-- employee_education: awarding board / university, and whether the passing
-- year is Bikram Sambat or AD.
-- ---------------------------------------------------------------------------

alter table employee_education add column if not exists board_university text;
alter table employee_education add column if not exists year_calendar text not null default 'AD';

alter table employee_education drop constraint if exists employee_education_year_calendar_check;
alter table employee_education add constraint employee_education_year_calendar_check
  check (year_calendar in ('AD', 'BS'));

-- ---------------------------------------------------------------------------
-- employee_training: courses and certifications an employee has completed.
-- Same tenant pattern as employee_education / employee_work_experience:
-- company_id is stamped from the employee, admin/HR manage rows in their own
-- company, and an employee can read their own.
-- ---------------------------------------------------------------------------

create table if not exists employee_training (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid references companies(id),
  title text not null,
  provider text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  check (start_date is null or end_date is null or end_date >= start_date)
);
create index if not exists idx_employee_training_employee on employee_training(employee_id);

alter table employee_training enable row level security;

drop trigger if exists trg_stamp_company_id on employee_training;
create trigger trg_stamp_company_id before insert on employee_training
  for each row execute function stamp_company_id_from_employee();

drop policy if exists "employee_training: admin or hr full access" on employee_training;
create policy "employee_training: admin or hr full access" on employee_training
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "employee_training: employee read own" on employee_training;
create policy "employee_training: employee read own" on employee_training
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );
