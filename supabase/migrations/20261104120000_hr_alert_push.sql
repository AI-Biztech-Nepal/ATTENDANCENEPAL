-- Push and email alerts for HR dates (a contract ending), sent by the notify-hr-alerts function
-- (supabase/functions/notify-hr-alerts) once a day — so an admin hears about it without opening the app.
--
-- 1. push_tokens could only belong to an employee, but the people who need these alerts (the owner and
--    HR logins) usually have no employee row. A token can now belong to a login (user_id) instead, and
--    the phone registers through register_push_token() so the right ids are filled in by the database.
-- 2. hr_alert_log remembers which alert has already been announced, so a contract is not announced
--    again every morning.
-- 3. pg_cron calls the function every morning at 08:00 Nepal time.
--
-- Re-runnable. Run once in the Supabase SQL editor, after 20261103140000_*. The cron step needs the Vault
-- secrets 'project_url', 'service_role_key' and 'cron_secret' that the holiday sync already uses.

-- ---------------------------------------------------------------------------
-- 1. Push tokens for any login
-- ---------------------------------------------------------------------------

alter table push_tokens add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table push_tokens alter column employee_id drop not null;

-- Existing employee tokens belong to that employee's login.
update push_tokens pt
set user_id = p.id
from profiles p
where p.employee_id = pt.employee_id and pt.user_id is null;

alter table push_tokens drop constraint if exists push_tokens_user_id_key;
alter table push_tokens add constraint push_tokens_user_id_key unique (user_id);

alter table push_tokens drop constraint if exists push_tokens_has_owner;
alter table push_tokens add constraint push_tokens_has_owner check (employee_id is not null or user_id is not null);

-- The company comes from the employee when there is one, otherwise from the login's own profile.
create or replace function stamp_push_token_company()
returns trigger as $$
begin
  new.company_id := coalesce(
    (select company_id from employees where id = new.employee_id),
    (select company_id from profiles where id = new.user_id)
  );
  if new.company_id is null then
    raise exception 'No company for this push token';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on push_tokens;
create trigger trg_stamp_company_id before insert on push_tokens
  for each row execute function stamp_push_token_company();

-- Called by the app after sign-in. One row per login, and a phone belongs to whoever registered it last —
-- so a phone handed to someone else stops sending the previous person's alerts. Who the caller is always
-- comes from the session, never from an argument.
create or replace function register_push_token(p_token text)
returns void as $$
declare
  me profiles%rowtype;
begin
  select * into me from profiles where id = auth.uid();
  if not found then
    raise exception 'Not signed in';
  end if;
  if coalesce(btrim(p_token), '') = '' then
    raise exception 'Empty push token';
  end if;

  delete from push_tokens
  where expo_push_token = p_token
     or user_id = me.id
     or (me.employee_id is not null and employee_id = me.employee_id);

  insert into push_tokens (user_id, employee_id, expo_push_token)
  values (me.id, me.employee_id, p_token);
end;
$$ language plpgsql security definer set search_path = public;

-- Called by the app just before signing out, so a signed-out phone stops getting alerts.
create or replace function unregister_push_token(p_token text)
returns void as $$
begin
  delete from push_tokens
  where expo_push_token = p_token
    and (
      user_id = auth.uid()
      or employee_id = (select employee_id from profiles where id = auth.uid())
    );
end;
$$ language plpgsql security definer set search_path = public;

-- `anon` is named too: Supabase grants new functions to it directly, so revoking from `public` alone leaves it.
revoke all on function register_push_token(text) from public, anon;
revoke all on function unregister_push_token(text) from public, anon;
grant execute on function register_push_token(text) to authenticated;
grant execute on function unregister_push_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. What has already been announced
-- ---------------------------------------------------------------------------

create table if not exists hr_alert_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  -- What kind of alert; only 'contract_end' for now.
  kind text not null,
  -- The date the alert is about (the contract's end date): renewing a contract changes it, which starts a
  -- fresh run of reminders.
  ref_date date not null,
  milestone text not null check (milestone in ('month', 'week', 'today', 'ended')),
  sent_at timestamptz not null default now(),
  unique (employee_id, kind, ref_date, milestone)
);
create index if not exists idx_hr_alert_log_company on hr_alert_log(company_id);

-- No policies on purpose: only the function (service role, which bypasses RLS) reads or writes this.
alter table hr_alert_log enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Run it every morning
-- ---------------------------------------------------------------------------

-- 08:00 Nepal time (UTC+05:45) is 02:15 UTC. Wrapped so a project without pg_cron / pg_net / Vault set up
-- still gets the rest of this migration; the notice says what to do.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'notify-hr-alerts-daily';

  perform cron.schedule(
    'notify-hr-alerts-daily',
    '15 2 * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/notify-hr-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    $cron$
  );
exception
  when others then
    raise notice 'notify-hr-alerts-daily was not scheduled (% — %); re-run this DO block by hand once pg_cron, pg_net and the Vault secrets are set up.', sqlstate, sqlerrm;
end $$;
