-- Service import: the booking system's file, brought in so the services KPIs can be worked out.
--
-- An admin uploads a CSV from the company's booking system (KPIs > Import). Each row is one service an employee
-- performed. They feed three KPIs: services performed, rebooking rate (did the customer come back) and hour
-- utilisation per day (time spent with customers).
--
--   service_imports  one row per file brought in: its name, how many rows it held, how many were new.
--                    Removing an import removes every row it brought, so a wrong file can be taken back.
--   service_records  one row per service. A customer is never stored by name, phone number or ID: only
--                    `customer_key`, a one-way scrambled form of the customer's ID made by the browser, which is
--                    enough to tell that two services were for the same customer.
--   kpi_settings     company-wide KPI rules; for now only how many days a customer has to come back within for
--                    it to count as "booked again".
--
-- `row_key` is what stops the same service being counted twice when an overlapping export is imported again: a
-- row whose key already exists is skipped.
--
-- Only admin / HR of the company can read or change any of it; employees have no access. Run once, in the
-- Supabase SQL editor, after 20261101200000_employee_performance_conduct.sql (it uses touch_record_updated()).
-- Re-runnable.

create table if not exists service_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default my_company_id() references companies(id) on delete cascade,
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 200),
  rows_read integer not null check (rows_read >= 0),
  -- How many of them were new (the rest were already there from an earlier import).
  rows_imported integer not null default 0 check (rows_imported >= 0),
  first_date date,
  last_date date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint service_imports_dates_check check (first_date is null or last_date is null or last_date >= first_date)
);

create table if not exists service_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  import_id uuid not null references service_imports(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  performed_on date not null,
  service text check (service is null or char_length(service) <= 120),
  -- Time spent with the customer. Empty when the file did not say.
  minutes integer check (minutes is null or (minutes > 0 and minutes <= 1440)),
  customer_key text check (customer_key is null or char_length(customer_key) <= 64),
  row_key text not null check (char_length(row_key) <= 400),
  created_at timestamptz not null default now(),
  constraint service_records_row_key_unique unique (row_key)
);
create index if not exists idx_service_records_employee_day on service_records(employee_id, performed_on);
create index if not exists idx_service_records_company_day on service_records(company_id, performed_on);
create index if not exists idx_service_records_import on service_records(import_id);
create index if not exists idx_service_records_customer on service_records(company_id, customer_key) where customer_key is not null;

create table if not exists kpi_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  -- A customer who returns within this many days counts as "booked again".
  repeat_window_days smallint not null default 45 check (repeat_window_days between 1 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- A record's company comes from its employee, and its import must be the same company's: nobody can file
-- services under another company's import or employee.
create or replace function service_records_set_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid;
begin
  select company_id into c from employees where id = new.employee_id;
  if c is null then
    raise exception 'No such employee, or employee has no company_id';
  end if;
  if (select company_id from service_imports where id = new.import_id) is distinct from c then
    raise exception 'The import and the employee must be in the same company';
  end if;
  new.company_id := c;
  return new;
end;
$$;

drop trigger if exists trg_set_company on service_records;
create trigger trg_set_company before insert on service_records
  for each row execute function service_records_set_company();

drop trigger if exists trg_touch_record_updated on kpi_settings;
create trigger trg_touch_record_updated before update on kpi_settings
  for each row execute function touch_record_updated();

-- ---------------------------------------------------------------------------
-- Row-level security: admin / HR of the same company, nobody else.
-- ---------------------------------------------------------------------------

alter table service_imports enable row level security;
alter table service_records enable row level security;
alter table kpi_settings enable row level security;

drop policy if exists "service_imports: admin or hr full access" on service_imports;
create policy "service_imports: admin or hr full access" on service_imports
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "service_records: admin or hr full access" on service_records;
create policy "service_records: admin or hr full access" on service_records
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "kpi_settings: admin or hr full access" on kpi_settings;
create policy "kpi_settings: admin or hr full access" on kpi_settings
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());
