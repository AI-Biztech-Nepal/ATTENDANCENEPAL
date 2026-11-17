-- Employee performance and conduct records: appraisals, awards, and warnings /
-- disciplinary actions / grievances.
--
-- (Training — name, provider, start and end — already lives in employee_training,
-- from 20261101120000_employee_hr_profile.sql.)
--
-- These are among the most sensitive things HR keeps, so every table is admin /
-- HR of the same company only, and there is deliberately NO policy letting an
-- employee read their own rows. Run once, in the Supabase SQL editor, after
-- 20261101120000_employee_hr_profile.sql.

-- Who last edited a row, and when — set by the database, not by the page.
create or replace function touch_record_updated()
returns trigger as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Appraisals. One row per review; "skills assessment" is the job-related
-- evaluation written at the same time.
-- ---------------------------------------------------------------------------

create table if not exists employee_appraisals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid references companies(id),
  appraisal_date date not null,
  period_type text not null,
  -- The stretch of time being reviewed, when it is worth stating.
  period_start date,
  period_end date,
  -- 1 to 5, in half steps (4.5).
  rating numeric not null,
  remarks text,
  evaluated_by text,
  skills_assessment text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint employee_appraisals_period_type_check check (period_type in ('monthly', 'quarterly', 'annual')),
  constraint employee_appraisals_rating_check check (rating >= 1 and rating <= 5 and rating * 2 = floor(rating * 2)),
  constraint employee_appraisals_period_check check (period_start is null or period_end is null or period_end >= period_start)
);
create index if not exists idx_employee_appraisals_employee on employee_appraisals(employee_id, appraisal_date desc);

-- ---------------------------------------------------------------------------
-- Awards and recognition.
-- ---------------------------------------------------------------------------

create table if not exists employee_awards (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid references companies(id),
  title text not null,
  awarded_on date not null,
  description text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint employee_awards_title_check check (btrim(title) <> '')
);
create index if not exists idx_employee_awards_employee on employee_awards(employee_id, awarded_on desc);

-- ---------------------------------------------------------------------------
-- Conduct: warnings, disciplinary actions and grievances share one table —
-- they are all "something was raised, here is what was decided".
-- ---------------------------------------------------------------------------

create table if not exists employee_conduct_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid references companies(id),
  kind text not null,
  -- The date of the warning / incident / complaint.
  record_date date not null,
  title text not null,
  details text,
  -- Only for a warning: how serious a step it is.
  warning_level text,
  status text not null default 'open',
  -- How it ended.
  final_decision text,
  decided_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint employee_conduct_kind_check check (kind in ('warning', 'disciplinary', 'grievance')),
  constraint employee_conduct_status_check check (status in ('open', 'under_review', 'closed')),
  constraint employee_conduct_level_check check (warning_level is null or warning_level in ('verbal', 'written', 'show_cause', 'final_warning')),
  constraint employee_conduct_level_only_warnings check (warning_level is null or kind = 'warning'),
  constraint employee_conduct_title_check check (btrim(title) <> '')
);
create index if not exists idx_employee_conduct_employee on employee_conduct_records(employee_id, record_date desc);

-- ---------------------------------------------------------------------------
-- Tenant scoping, the same on all three: company_id is stamped from the
-- employee, only admin / HR of that company can touch the rows.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['employee_appraisals', 'employee_awards', 'employee_conduct_records']
  loop
    execute format('alter table %I enable row level security', t);

    execute format('drop trigger if exists trg_stamp_company_id on %I', t);
    execute format(
      'create trigger trg_stamp_company_id before insert on %I for each row execute function stamp_company_id_from_employee()', t);

    execute format('drop trigger if exists trg_touch_record_updated on %I', t);
    execute format(
      'create trigger trg_touch_record_updated before update on %I for each row execute function touch_record_updated()', t);

    execute format('drop policy if exists %I on %I', t || ': admin or hr full access', t);
    execute format(
      'create policy %I on %I for all using (is_admin_or_hr() and company_id = my_company_id()) with check (is_admin_or_hr() and company_id = my_company_id())',
      t || ': admin or hr full access', t);
  end loop;
end $$;
