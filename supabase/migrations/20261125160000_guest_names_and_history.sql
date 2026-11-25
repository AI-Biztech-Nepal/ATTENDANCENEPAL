-- Guests by name: the bookings file keeps each guest's name and phone number, and a guest's whole history can be opened.
--
-- Until now a booking row kept only a scrambled code for the customer (20261122180000_service_import.sql), so a booking and a
-- feedback form could never be matched to the same person. From now on the import saves the guest's NAME and PHONE (when the
-- file has them) on each row, and customer_key, the key that tells two visits are the same guest, is made from them in plain
-- words: 'p:' + the last 10 digits of the phone, otherwise 'n:' + the name in small letters, otherwise 'c:' + the customer ID.
-- Rows imported before this keep their old scrambled code (and no name); remove those imports and import the files again to
-- give them names.
--
-- guest_history() hands over one guest's visits and feedback forms. Who the guest is comes from a form or a booking row the
-- caller can see, and the two are matched by phone when both have one, otherwise by name:
--   * admin / HR of the company see every visit and form of that guest, with the guest's phone and email;
--   * an employee sees only their own visits and forms with that guest, and the guest's name (never the phone or email).
--
-- Run once, in the Supabase SQL editor, after 20261122180000_service_import.sql and
-- 20261124120000_customer_feedback_guest_details.sql. Re-runnable.

alter table service_records add column if not exists customer_name text;
alter table service_records add column if not exists customer_phone text;

alter table service_records drop constraint if exists service_records_customer_name_check;
alter table service_records add constraint service_records_customer_name_check check (customer_name is null or char_length(customer_name) <= 100);
alter table service_records drop constraint if exists service_records_customer_phone_check;
alter table service_records add constraint service_records_customer_phone_check check (customer_phone is null or char_length(customer_phone) <= 30);
-- The key can now hold a name ('n:' + up to 100 letters), so it is allowed to be longer than the old 32-letter code.
alter table service_records drop constraint if exists service_records_customer_key_check;
alter table service_records add constraint service_records_customer_key_check check (customer_key is null or char_length(customer_key) <= 140);

-- ---------------------------------------------------------------------------
-- How two records are told to be the same guest (the import does the same in admin-web/lib/serviceImport.ts)
-- ---------------------------------------------------------------------------

-- A phone number as digits only, the last 10 of them (so +977 98..., 977-98... and 98... are the same). Null with fewer than 5.
create or replace function guest_phone_key(p text)
returns text
language sql
immutable
as $$
  select case when char_length(d) >= 5 then right(d, 10) end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- A name in small letters with single spaces. Null when empty.
create or replace function guest_name_key(p text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;

create index if not exists idx_service_records_guest_phone on service_records (company_id, guest_phone_key(customer_phone)) where customer_phone is not null;
create index if not exists idx_service_records_guest_name on service_records (company_id, guest_name_key(customer_name)) where customer_name is not null;
create index if not exists idx_customer_feedback_guests_phone on customer_feedback_guests (company_id, guest_phone_key(guest_phone));
create index if not exists idx_customer_feedback_guests_name on customer_feedback_guests (company_id, guest_name_key(guest_name));

-- ---------------------------------------------------------------------------
-- One guest's history
-- ---------------------------------------------------------------------------

-- Give the form (p_feedback_id) or the booking row (p_service_id) the guest was opened from. Returns
--   { name, phone, email, visits: [{ id, day, employee_id, employee_name, service, minutes }],
--     forms: [{ id, day, employee_id, employee_name, rating, recommend, comment, reference }] }
-- newest first. phone and email are null for anyone but admin / HR.
create or replace function guest_history(p_feedback_id uuid default null, p_service_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me uuid;
  co uuid;
  manager boolean := is_admin_or_hr();
  g_name text;
  g_phone text;
  g_email text;
  g_key text;
  np text;
  nn text;
  visits jsonb;
  forms jsonb;
begin
  select employee_id, company_id into me, co from profiles where id = uid;
  if uid is null or co is null then
    raise exception 'Sign in to see a guest''s history';
  end if;

  if p_feedback_id is not null then
    select g.guest_name, g.guest_phone, g.guest_email into g_name, g_phone, g_email
    from customer_feedback f
    join customer_feedback_guests g on g.feedback_id = f.id
    where f.id = p_feedback_id and f.company_id = co and (manager or f.employee_id = me);
  elsif p_service_id is not null then
    select s.customer_name, s.customer_phone, s.customer_key into g_name, g_phone, g_key
    from service_records s
    where s.id = p_service_id and s.company_id = co and (manager or s.employee_id = me);
  end if;
  if not found or (g_name is null and g_phone is null and g_key is null) then
    raise exception 'That guest was not found';
  end if;

  np := guest_phone_key(g_phone);
  nn := guest_name_key(g_name);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'day', s.performed_on, 'employee_id', s.employee_id, 'employee_name', e.name,
           'service', s.service, 'minutes', s.minutes)
         order by s.performed_on desc, s.created_at desc), '[]'::jsonb)
  into visits
  from service_records s
  left join employees e on e.id = s.employee_id
  where s.company_id = co
    and (manager or s.employee_id = me)
    and (
      (np is not null and guest_phone_key(s.customer_phone) = np)
      or (nn is not null and guest_name_key(s.customer_name) = nn and (np is null or guest_phone_key(s.customer_phone) is null))
      or (g_key is not null and s.customer_key = g_key)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'day', f.given_on, 'employee_id', f.employee_id, 'employee_name', e.name,
           'rating', f.rating, 'recommend', f.recommend, 'comment', f.comment, 'reference', f.reference)
         order by f.given_on desc, f.created_at desc), '[]'::jsonb)
  into forms
  from customer_feedback f
  join customer_feedback_guests g on g.feedback_id = f.id
  left join employees e on e.id = f.employee_id
  where f.company_id = co
    and (manager or f.employee_id = me)
    and (
      (np is not null and guest_phone_key(g.guest_phone) = np)
      or (nn is not null and guest_name_key(g.guest_name) = nn and (np is null or guest_phone_key(g.guest_phone) is null))
    );

  return jsonb_build_object(
    'name', g_name,
    'phone', case when manager then g_phone end,
    'email', case when manager then g_email end,
    'visits', visits,
    'forms', forms
  );
end;
$$;

revoke all on function guest_history(uuid, uuid) from public, anon;
grant execute on function guest_history(uuid, uuid) to authenticated;
