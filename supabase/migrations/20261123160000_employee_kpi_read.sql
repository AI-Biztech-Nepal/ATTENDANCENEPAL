-- An employee's own KPI page (/my-kpis): what an employee may READ to see their own KPIs. Nothing here lets them write anything.
--
-- The KPI numbers come from tables that were admin / HR only until now:
--   * kpi_settings        which KPIs the company uses, what it calls them, the rules (hours in a day, forms needed, days to come back)
--   * custom_kpis         the KPIs the company added itself (names only)
--   * custom_kpi_values   the numbers typed in for them: an employee reads only THEIR OWN
--   * service_records     the imported services: an employee reads only THEIR OWN
-- and the rebooking rate needs one more thing. A customer "booked again" when they had a service with ANYONE on a later
-- day, so counting an employee's rebooking needs the visits other employees performed for the customers this employee
-- served, which an employee must not read. my_customer_visits() hands over just those visits, and only as a scrambled
-- customer code, a day and whether the visit was the employee's own (never who performed the others).
--
-- Colleague feedback and customer forms already have their own employee-safe access (20261123140000_colleague_feedback.sql);
-- attendance is read from tables an employee can already read for themselves (the Payroll page does the same).
--
-- Run once, in the Supabase SQL editor, after 20261123140000_colleague_feedback.sql, 20261123120000_own_kpis.sql,
-- 20261122200000_kpi_settings_options.sql and 20261122180000_service_import.sql. Re-runnable.

drop policy if exists "kpi_settings: employee reads their company's" on kpi_settings;
create policy "kpi_settings: employee reads their company's" on kpi_settings
  for select using (company_id = my_company_id());

drop policy if exists "custom_kpis: employee reads their company's" on custom_kpis;
create policy "custom_kpis: employee reads their company's" on custom_kpis
  for select using (company_id = my_company_id());

drop policy if exists "custom_kpi_values: employee reads their own" on custom_kpi_values;
create policy "custom_kpi_values: employee reads their own" on custom_kpi_values
  for select using (employee_id = (select employee_id from profiles where id = auth.uid()));

drop policy if exists "service_records: employee reads their own" on service_records;
create policy "service_records: employee reads their own" on service_records
  for select using (employee_id = (select employee_id from profiles where id = auth.uid()));

-- The visits needed to count the signed-in employee's rebooking: every service, by anyone in their company, between p_from
-- and p_to, for the customers THEY served between p_from and p_served_to. `mine` says whether the visit was theirs.
create or replace function my_customer_visits(p_from date, p_served_to date, p_to date)
returns table (customer_key text, performed_on date, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select employee_id, company_id from profiles where id = auth.uid()),
  served as (
    select distinct r.customer_key
    from service_records r, me
    where r.employee_id = me.employee_id
      and r.customer_key is not null
      and r.performed_on between p_from and p_served_to
  )
  select r.customer_key, r.performed_on, coalesce(r.employee_id = me.employee_id, false)
  from service_records r, me
  where r.company_id = me.company_id
    and r.customer_key in (select s.customer_key from served s)
    and r.performed_on between p_from and p_to;
$$;

revoke all on function my_customer_visits(date, date, date) from public, anon;
grant execute on function my_customer_visits(date, date, date) to authenticated;
