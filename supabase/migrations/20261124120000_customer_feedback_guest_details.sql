-- Guest details on the customer feedback form: the date of the visit, and who the guest is (name, phone, email).
--
-- Why two places: the date of the visit is just a date, so it sits on the form itself (customer_feedback.visit_date).
-- A name, phone number and email are personal. An employee may read the forms about themselves (see
-- 20261123140000_colleague_feedback.sql), and a policy gives them the whole row, so the guest's contact details are
-- kept in their own table that only admin / HR of the same company can read or write, and there is deliberately NO
-- policy for anyone else. Deleting a form deletes the guest's details with it.
--
-- The visit cannot be after the date written on the form. Every detail is optional; a guest row exists only when at
-- least one of the three was filled in.
--
-- Run once, in the Supabase SQL editor, after 20261122140000_customer_feedback.sql (and the later feedback migrations).
-- Re-runnable.

alter table customer_feedback add column if not exists visit_date date;

alter table customer_feedback drop constraint if exists customer_feedback_visit_date_check;
alter table customer_feedback add constraint customer_feedback_visit_date_check
  check (visit_date is null or visit_date <= given_on);

create table if not exists customer_feedback_guests (
  -- One row per form, and it goes with the form.
  feedback_id uuid primary key references customer_feedback(id) on delete cascade,
  company_id uuid references companies(id),
  guest_name text,
  guest_phone text,
  guest_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint customer_feedback_guests_name_check check (guest_name is null or char_length(guest_name) <= 100),
  constraint customer_feedback_guests_phone_check check (
    guest_phone is null or (char_length(guest_phone) <= 30 and guest_phone ~ '^[0-9+()./ -]+$' and guest_phone ~ '[0-9].*[0-9].*[0-9].*[0-9].*[0-9]')
  ),
  constraint customer_feedback_guests_email_check check (
    guest_email is null or (char_length(guest_email) <= 120 and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  constraint customer_feedback_guests_not_empty_check check (
    nullif(btrim(coalesce(guest_name, '')), '') is not null
    or nullif(btrim(coalesce(guest_phone, '')), '') is not null
    or nullif(btrim(coalesce(guest_email, '')), '') is not null
  )
);

-- company_id comes from the form it belongs to, never from the caller.
create or replace function stamp_company_id_from_feedback()
returns trigger as $$
begin
  new.company_id := (select company_id from customer_feedback where id = new.feedback_id);
  if new.company_id is null then
    raise exception 'No such form, or the form has no company_id';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

alter table customer_feedback_guests enable row level security;

drop trigger if exists trg_stamp_company_id on customer_feedback_guests;
create trigger trg_stamp_company_id before insert on customer_feedback_guests
  for each row execute function stamp_company_id_from_feedback();

drop trigger if exists trg_touch_record_updated on customer_feedback_guests;
create trigger trg_touch_record_updated before update on customer_feedback_guests
  for each row execute function touch_record_updated();

drop policy if exists "customer_feedback_guests: admin or hr full access" on customer_feedback_guests;
create policy "customer_feedback_guests: admin or hr full access" on customer_feedback_guests
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());
