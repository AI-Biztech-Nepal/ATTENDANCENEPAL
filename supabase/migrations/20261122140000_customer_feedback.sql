-- Customer feedback forms.
--
-- Customers do not use the app: they fill in a paper form the company hands out, and staff type each one in
-- (KPIs > Customer feedback). One row per form. The same form feeds two KPIs: "customer feedback" (the 1-5
-- service rating) and "NPS" (the 0-10 would-recommend number).
--
-- A customer may skip a question, so rating, recommend and comment can each be empty, but a form with none
-- of the three is not a form. The comment is copied as written and should carry no customer name or phone
-- number; it is read by management only, so, like the other HR-style records, only admin / HR of the same
-- company can touch these rows and there is deliberately NO policy letting an employee read them.
--
-- Run once, in the Supabase SQL editor, after 20261101200000_employee_performance_conduct.sql (it uses
-- touch_record_updated() from there). Re-runnable.

create table if not exists customer_feedback (
  id uuid primary key default gen_random_uuid(),
  -- Who served the customer. The rows go with the employee when they are removed for good.
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid references companies(id),
  -- The date written on the paper form (not the day it was typed in).
  given_on date not null,
  -- What the visit was for ("Consultation"), when the form says.
  reference text,
  -- Service rating, 1 to 5.
  rating smallint,
  -- "How likely are you to recommend us?", 0 to 10. 9-10 recommend, 7-8 neutral, 0-6 not likely.
  recommend smallint,
  comment text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint customer_feedback_rating_check check (rating is null or (rating >= 1 and rating <= 5)),
  constraint customer_feedback_recommend_check check (recommend is null or (recommend >= 0 and recommend <= 10)),
  constraint customer_feedback_reference_check check (reference is null or char_length(reference) <= 80),
  constraint customer_feedback_comment_check check (comment is null or char_length(comment) <= 1000),
  constraint customer_feedback_not_empty_check check (
    rating is not null or recommend is not null or nullif(btrim(coalesce(comment, '')), '') is not null
  )
);

-- A person's forms for a month, and the company's forms for a month, are the two ways they are read.
create index if not exists idx_customer_feedback_employee_day on customer_feedback (employee_id, given_on desc);
create index if not exists idx_customer_feedback_company_day on customer_feedback (company_id, given_on desc);

-- company_id is stamped from the employee (never trusted from the caller), who last edited the row is set
-- by the database: both functions already exist from earlier migrations.
alter table customer_feedback enable row level security;

drop trigger if exists trg_stamp_company_id on customer_feedback;
create trigger trg_stamp_company_id before insert on customer_feedback
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_touch_record_updated on customer_feedback;
create trigger trg_touch_record_updated before update on customer_feedback
  for each row execute function touch_record_updated();

drop policy if exists "customer_feedback: admin or hr full access" on customer_feedback;
create policy "customer_feedback: admin or hr full access" on customer_feedback
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());
