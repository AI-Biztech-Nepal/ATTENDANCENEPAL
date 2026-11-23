-- Your own KPIs.
--
-- Besides the ten KPIs from the owner's sheet, a company can add KPIs of its own (KPIs > Settings > "Add your own
-- KPI"): a name and a number that staff type in for each person, each month ("Quality checks passed"). Nothing is
-- worked out from them: the number typed in is the number shown, next to last month's. There is no total, no ranking
-- and no weight, like the other KPIs.
--
--   custom_kpis        one row per KPI the company added: its name and whether it is on.
--   custom_kpi_values  one row per KPI, person and month: the number. A month is the exact period the admin was looking
--                      at (a Nepali month or an English one), the same rule as colleague review rounds, so a number typed
--                      in for Mangsir is read back for Mangsir. A box left empty is simply no row.
--
-- Who may touch them: only admin / HR of the company, like the customer forms and the reviews. There is deliberately NO
-- policy for an employee, who has no KPI pages yet.
--
-- Run once, in the Supabase SQL editor, after 20261101200000_employee_performance_conduct.sql (it uses
-- touch_record_updated() from there). Re-runnable.

create table if not exists custom_kpis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default my_company_id() references companies(id) on delete cascade,
  -- What the company calls it. The page keeps it trimmed with single spaces; the database only insists on 1 to 60 characters.
  name text not null,
  -- Off hides it from every page without deleting what was typed in.
  is_on boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint custom_kpis_name_check check (btrim(name) <> '' and char_length(name) <= 60)
);

-- Two KPIs of one company cannot share a name (capitals and stray spaces do not make a new name).
create unique index if not exists custom_kpis_name_unique on custom_kpis (company_id, lower(btrim(name)));

create table if not exists custom_kpi_values (
  id uuid primary key default gen_random_uuid(),
  -- The values go with the KPI, and with the employee when they are removed for good.
  kpi_id uuid not null references custom_kpis(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  -- Taken from the KPI by a trigger, never from the caller.
  company_id uuid references companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  -- Up to 999,999,999.99.
  value numeric(11, 2) not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint custom_kpi_values_value_check check (value >= 0),
  constraint custom_kpi_values_period_check check (period_end >= period_start),
  constraint custom_kpi_values_one_each unique (kpi_id, employee_id, period_start, period_end)
);

-- A month's numbers for one KPI (the typing page, the list) and one person's numbers (their page) are the two ways they are read.
create index if not exists idx_custom_kpi_values_kpi_period on custom_kpi_values (kpi_id, period_start);
create index if not exists idx_custom_kpi_values_employee_period on custom_kpi_values (employee_id, period_start);

-- A company has up to ten KPIs of its own: a table of KPIs that wide stops being readable.
create or replace function custom_kpis_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from custom_kpis where company_id = new.company_id) >= 10 then
    raise exception 'A company can have up to 10 KPIs of its own';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_custom_kpis_limit on custom_kpis;
create trigger trg_custom_kpis_limit before insert on custom_kpis
  for each row execute function custom_kpis_limit();

-- A value's company comes from its KPI, and the person it is about must belong to that company, so nobody can type a
-- number against another company's staff (or another company's KPI).
create or replace function custom_kpi_values_set_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid;
begin
  select company_id into c from custom_kpis where id = new.kpi_id;
  if c is null then
    raise exception 'No such KPI';
  end if;
  if (select company_id from employees where id = new.employee_id) is distinct from c then
    raise exception 'The employee must be in the KPI''s company';
  end if;
  new.company_id := c;
  return new;
end;
$$;

drop trigger if exists trg_set_company on custom_kpi_values;
create trigger trg_set_company before insert or update of kpi_id, employee_id on custom_kpi_values
  for each row execute function custom_kpi_values_set_company();

drop trigger if exists trg_touch_record_updated on custom_kpis;
create trigger trg_touch_record_updated before update on custom_kpis
  for each row execute function touch_record_updated();

drop trigger if exists trg_touch_record_updated on custom_kpi_values;
create trigger trg_touch_record_updated before update on custom_kpi_values
  for each row execute function touch_record_updated();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table custom_kpis enable row level security;
alter table custom_kpi_values enable row level security;

drop policy if exists "custom_kpis: admin or hr full access" on custom_kpis;
create policy "custom_kpis: admin or hr full access" on custom_kpis
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "custom_kpi_values: admin or hr full access" on custom_kpi_values;
create policy "custom_kpi_values: admin or hr full access" on custom_kpi_values
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());
