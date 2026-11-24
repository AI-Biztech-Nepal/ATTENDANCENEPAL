-- Guest details on the customer feedback form: who the guest is (name, phone, email).
--
-- The form's one date is the date of the visit (customer_feedback.given_on, which the KPIs group the forms by). Nothing is added to
-- customer_feedback itself: a name, phone number and email are personal, and an employee may read the forms about themselves (see
-- 20261123140000_colleague_feedback.sql) with a policy that gives them the whole row. So the guest's details are kept in their own
-- table that only admin / HR of the same company can read or write, and there is deliberately NO policy for anyone else. Deleting a
-- form deletes the guest's details with it.
--
-- The name and the phone number are required for every guest row; the email is optional. A form with no guest row is an older form
-- typed in before this existed: it stays as it is. The rules apply to rows saved from now on (the constraints are NOT VALID, so a row
-- that exists already is never checked again until it is changed).
--
-- If an earlier version of this file was already run (it added customer_feedback.visit_date), running this one is still fine: it
-- replaces the guest rules, and drops the visit-date rule that no longer applies. The visit_date column, if it exists, is left alone
-- and unused.
--
-- Run once, in the Supabase SQL editor, after 20261122140000_customer_feedback.sql (and the later feedback migrations).
-- Re-runnable.

alter table customer_feedback drop constraint if exists customer_feedback_visit_date_check;

create table if not exists customer_feedback_guests (
  -- One row per form, and it goes with the form.
  feedback_id uuid primary key references customer_feedback(id) on delete cascade,
  company_id uuid references companies(id),
  guest_name text,
  guest_phone text,
  guest_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- The rules, written so they can be run again (and replace the looser ones of an earlier version).
alter table customer_feedback_guests drop constraint if exists customer_feedback_guests_not_empty_check;
alter table customer_feedback_guests drop constraint if exists customer_feedback_guests_name_check;
alter table customer_feedback_guests drop constraint if exists customer_feedback_guests_phone_check;
alter table customer_feedback_guests drop constraint if exists customer_feedback_guests_email_check;

alter table customer_feedback_guests add constraint customer_feedback_guests_name_check
  check (nullif(btrim(coalesce(guest_name, '')), '') is not null and char_length(guest_name) <= 100) not valid;
alter table customer_feedback_guests add constraint customer_feedback_guests_phone_check
  check (
    nullif(btrim(coalesce(guest_phone, '')), '') is not null
    and char_length(guest_phone) <= 30
    and guest_phone ~ '^[0-9+()./ -]+$'
    and guest_phone ~ '[0-9].*[0-9].*[0-9].*[0-9].*[0-9]'
  ) not valid;
alter table customer_feedback_guests add constraint customer_feedback_guests_email_check
  check (guest_email is null or (char_length(guest_email) <= 120 and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) not valid;

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
