-- KPI settings (KPIs > Settings): what a company calls the people it serves, which KPIs it uses and what it calls
-- them, and the few numbers the KPIs are worked out with.
--
-- These are more columns on kpi_settings, which 20261122180000_service_import.sql created (it holds the rebooking
-- window). One row per company; a company with no row uses the defaults below, so nothing has to be set up.
--
--   people_word       what the company calls the people it serves: customer, client, guest, patient, member or
--                     student. The KPI pages use it in their names ("Guest feedback").
--   hours_per_day     hours in a working day, for hour utilisation (time with customers out of the working day).
--   min_responses     responses needed in a month before customer feedback and NPS are shown, so one or two forms do
--                     not stand for a whole month.
--   kpi_off           the KPIs this company does not use. They are left off every KPI page.
--   kpi_names         the names this company gave KPIs, by KPI. A KPI that is not here keeps its own name.
--
-- Only admin / HR of the company can read or change it (the policies from the service import migration).
-- Run once, in the Supabase SQL editor, after 20261122180000_service_import.sql. Re-runnable.

alter table kpi_settings add column if not exists people_word text not null default 'customer';
alter table kpi_settings add column if not exists hours_per_day numeric(3,1) not null default 9;
alter table kpi_settings add column if not exists min_responses smallint not null default 5;
alter table kpi_settings add column if not exists kpi_off text[] not null default '{}';
alter table kpi_settings add column if not exists kpi_names jsonb not null default '{}'::jsonb;

-- The KPIs there are, in one place. A name map is valid when every key is one of them and every name is 1-60
-- characters of text.
create or replace function kpi_names_valid(names jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(names) = 'object'
    and not exists (
      select 1
      from jsonb_each(names) e
      where e.key <> all (array['attendance','services','rebooking','utilisation','feedback','nps','peers','manager','clevel','training'])
         or jsonb_typeof(e.value) <> 'string'
         or char_length(btrim(e.value #>> '{}')) not between 1 and 60
    )
$$;

alter table kpi_settings drop constraint if exists kpi_settings_people_word_check;
alter table kpi_settings add constraint kpi_settings_people_word_check
  check (people_word in ('customer', 'client', 'guest', 'patient', 'member', 'student'));

alter table kpi_settings drop constraint if exists kpi_settings_hours_per_day_check;
alter table kpi_settings add constraint kpi_settings_hours_per_day_check
  check (hours_per_day >= 1 and hours_per_day <= 24);

alter table kpi_settings drop constraint if exists kpi_settings_min_responses_check;
alter table kpi_settings add constraint kpi_settings_min_responses_check
  check (min_responses between 1 and 100);

alter table kpi_settings drop constraint if exists kpi_settings_kpi_off_check;
alter table kpi_settings add constraint kpi_settings_kpi_off_check
  check (kpi_off <@ array['attendance','services','rebooking','utilisation','feedback','nps','peers','manager','clevel','training']::text[]);

alter table kpi_settings drop constraint if exists kpi_settings_kpi_names_check;
alter table kpi_settings add constraint kpi_settings_kpi_names_check
  check (kpi_names_valid(kpi_names));
