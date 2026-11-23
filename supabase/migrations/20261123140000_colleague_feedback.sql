-- Colleague feedback: everyone who works in the company can give feedback to anyone else, at any time.
--
-- This REPLACES the monthly rounds of 20261122160000_colleague_reviews.sql (an admin starting a round, assigned reviews,
-- "who still owes"). Those tables are left alone, unused, so nothing is lost if that migration was already run; the app no
-- longer reads them.
--
-- Feedback is a rating from 1 to 5 and an optional comment. The four colleague KPIs on the owner's sheet (from peers, from
-- the immediate manager, from the C-level executive, from training and compliance) are worked out when the feedback is
-- GIVEN, from who the giver is to the person it is about:
--   * manager   the giver is the person's "Reports to" (employees.reporting_to)
--   * c_level   the giver is someone an admin chose as C-level (feedback_roles), or an admin / HR account that is not
--               linked to an employee record (management)
--   * training  the giver is someone an admin chose for training and compliance (feedback_roles)
--   * peer      everyone else
-- (in that order, so a manager who is also chosen as C-level counts as the manager).
--
-- A month is read by the DAY the feedback was given (Nepal time), so it counts in whichever month, Nepali or English, the
-- page is looking at. A person can give one feedback per colleague per (English) month; giving again the same month
-- replaces it, which stops one person flooding someone's average.
--
-- Who may see what (the point of the design: the person never learns who said what):
--   * the table colleague_feedback is readable by admin / HR of the company and by nobody else, and nobody can write it
--     directly. The giver's account is stored (so the one-a-month rule and "your feedback this month" work) but is never
--     returned by any function.
--   * everyone gives through give_colleague_feedback(), reads their own feedback through my_feedback_received() and the
--     feedback they gave this month through feedback_i_gave(), and picks a colleague from feedback_colleagues(). An
--     employee cannot read other employees' rows, hence security definer; each function checks who is asking.
--
-- Customer feedback (20261122140000_customer_feedback.sql) stays typed in and edited by admin / HR only. This file adds
-- ONE thing there: an employee may now READ the forms that are about them, and nothing more (no insert, update or delete).
--
-- Run once, in the Supabase SQL editor, after 20261122140000_customer_feedback.sql. Re-runnable.

-- ---------------------------------------------------------------------------
-- Who counts as C-level and as training and compliance
-- ---------------------------------------------------------------------------

create table if not exists feedback_roles (
  employee_id uuid not null references employees(id) on delete cascade,
  role text not null check (role in ('c_level', 'training')),
  company_id uuid references companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, role)
);

drop trigger if exists trg_stamp_company_id on feedback_roles;
create trigger trg_stamp_company_id before insert on feedback_roles
  for each row execute function stamp_company_id_from_employee();

-- The people already chosen for the old rounds keep their role.
do $$
begin
  if to_regclass('public.review_givers') is not null then
    insert into feedback_roles (employee_id, role, company_id)
    select employee_id, relation, company_id from review_givers
    on conflict do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The feedback
-- ---------------------------------------------------------------------------

create table if not exists colleague_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- Who the feedback is about. It goes with the employee when they are removed for good.
  subject_id uuid not null references employees(id) on delete cascade,
  -- Who gave it: their sign-in, and their employee record when they have one. Never returned by any function.
  reviewer_user uuid references profiles(id) on delete set null,
  reviewer_employee uuid references employees(id) on delete set null,
  relation text not null check (relation in ('peer', 'manager', 'c_level', 'training')),
  rating smallint not null check (rating >= 1 and rating <= 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  -- The day it was given in Nepal, and the first day of that (English) month for the one-a-month rule.
  given_on date not null,
  given_month date not null,
  given_at timestamptz not null default now(),
  constraint colleague_feedback_not_self check (reviewer_employee is null or reviewer_employee <> subject_id),
  constraint colleague_feedback_one_a_month unique (reviewer_user, subject_id, given_month)
);

-- A person's feedback for a month, and the company's feedback for a month, are the two ways it is read.
create index if not exists idx_colleague_feedback_subject_day on colleague_feedback (subject_id, given_on desc);
create index if not exists idx_colleague_feedback_company_day on colleague_feedback (company_id, given_on desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table feedback_roles enable row level security;
alter table colleague_feedback enable row level security;

drop policy if exists "feedback_roles: admin or hr full access" on feedback_roles;
create policy "feedback_roles: admin or hr full access" on feedback_roles
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

-- Admin / HR read the feedback (the KPIs and a person's report are worked out from it). Nobody writes it directly.
drop policy if exists "colleague_feedback: admin or hr read" on colleague_feedback;
create policy "colleague_feedback: admin or hr read" on colleague_feedback
  for select using (is_admin_or_hr() and company_id = my_company_id());

-- An employee reads the customer forms that are about them, and only those. Everything else on customer_feedback is
-- still admin / HR only.
drop policy if exists "customer_feedback: employee reads their own" on customer_feedback;
create policy "customer_feedback: employee reads their own" on customer_feedback
  for select using (employee_id = (select employee_id from profiles where id = auth.uid()));

-- ---------------------------------------------------------------------------
-- What anyone signed in can do
-- ---------------------------------------------------------------------------

-- The colleagues feedback can be given to: everyone active in the signed-in person's company except themselves.
create or replace function feedback_colleagues()
returns table (id uuid, name text, department text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.name, e.department
  from employees e
  where e.company_id = (select company_id from profiles where id = auth.uid())
    and e.status = 'active'
    and e.id is distinct from (select employee_id from profiles where id = auth.uid())
  order by e.name;
$$;

-- Give feedback to a colleague, or, when it was already given to them this month, replace it.
create or replace function give_colleague_feedback(p_subject_id uuid, p_rating integer, p_comment text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me uuid;
  co uuid;
  subj record;
  rel text;
  note text := nullif(btrim(coalesce(p_comment, '')), '');
  today date := (now() at time zone 'Asia/Kathmandu')::date;
  new_id uuid;
begin
  select employee_id, company_id into me, co from profiles where id = uid;
  if uid is null or co is null then
    raise exception 'Sign in to give feedback';
  end if;
  select id, company_id, status, reporting_to into subj from employees where id = p_subject_id;
  if not found or subj.company_id is distinct from co then
    raise exception 'That colleague was not found';
  end if;
  if me is not null and me = p_subject_id then
    raise exception 'You cannot give feedback to yourself';
  end if;
  if subj.status <> 'active' then
    raise exception 'That colleague is no longer active';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'The rating must be from 1 to 5';
  end if;
  if note is not null and char_length(note) > 1000 then
    raise exception 'The comment is too long (1000 characters at most)';
  end if;

  rel := case
    when me is not null and subj.reporting_to = me then 'manager'
    when me is not null and exists (select 1 from feedback_roles r where r.employee_id = me and r.role = 'c_level') then 'c_level'
    when me is not null and exists (select 1 from feedback_roles r where r.employee_id = me and r.role = 'training') then 'training'
    when me is null then 'c_level'
    else 'peer'
  end;

  insert into colleague_feedback (company_id, subject_id, reviewer_user, reviewer_employee, relation, rating, comment, given_on, given_month)
  values (co, p_subject_id, uid, me, rel, p_rating, note, today, date_trunc('month', today)::date)
  on conflict (reviewer_user, subject_id, given_month)
  do update set relation = excluded.relation, rating = excluded.rating, comment = excluded.comment, given_on = excluded.given_on, given_at = now()
  returning id into new_id;
  return new_id;
end;
$$;

-- The feedback the signed-in person gave this month, so the form can show it and say sending again replaces it.
create or replace function feedback_i_gave()
returns table (id uuid, subject_id uuid, subject_name text, rating smallint, comment text, given_on date)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.subject_id, e.name, f.rating, f.comment, f.given_on
  from colleague_feedback f
  join employees e on e.id = f.subject_id
  where f.reviewer_user = auth.uid()
    and f.given_month = date_trunc('month', (now() at time zone 'Asia/Kathmandu')::date)::date
  order by e.name;
$$;

-- The feedback colleagues gave the signed-in person between two days, newest first. It says what KIND of colleague gave it
-- ('peer', 'manager', 'c_level', 'training') and never who.
create or replace function my_feedback_received(p_from date, p_to date)
returns table (id uuid, relation text, rating smallint, comment text, given_on date)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.relation, f.rating, f.comment, f.given_on
  from colleague_feedback f
  where f.subject_id = (select employee_id from profiles where id = auth.uid())
    and f.given_on between p_from and p_to
  order by f.given_on desc, f.given_at desc;
$$;

revoke all on function feedback_colleagues() from public, anon;
revoke all on function give_colleague_feedback(uuid, integer, text) from public, anon;
revoke all on function feedback_i_gave() from public, anon;
revoke all on function my_feedback_received(date, date) from public, anon;
grant execute on function feedback_colleagues() to authenticated;
grant execute on function give_colleague_feedback(uuid, integer, text) to authenticated;
grant execute on function feedback_i_gave() to authenticated;
grant execute on function my_feedback_received(date, date) to authenticated;
