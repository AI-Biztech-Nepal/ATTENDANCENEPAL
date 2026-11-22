-- Colleague reviews: once a month the company asks colleagues for feedback on each other.
--
-- Four kinds of feedback feed four KPIs: from peers, from the immediate manager, from the C-level executive
-- and from training and compliance. Each is a rating from 1 to 5 and an optional comment.
--
--   review_settings  one row per company: how many peers review each person.
--   review_givers    the chosen people who give the C-level and the training-and-compliance feedback.
--   review_rounds    one round per month. Starting a round creates every review that is to be given.
--   colleague_reviews  one row per review. It exists, empty, from the day the round starts; giving the feedback
--                      fills in the rating, the comment and the time. Empty rating = still to give.
--
-- Who may see what (the point of the design: the person reviewed never learns who said what):
--   * admin / HR of the company manage settings, rounds and the list of reviews, and read every review.
--     They cannot write a rating for someone else: a rating only ever arrives through give_colleague_review().
--   * everyone else, including the person being reviewed, has NO access to the tables at all. A giver reaches
--     their own reviews through my_reviews_to_give() and answers through give_colleague_review(); both check
--     who is asking.
--
-- Run once, in the Supabase SQL editor, after 20261101120000_employee_hr_profile.sql (employees.reporting_to).
-- Re-runnable.

create table if not exists review_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  -- How many colleagues in the same department review each person (the peers).
  peer_limit smallint not null default 5 check (peer_limit between 1 and 20),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists review_givers (
  employee_id uuid not null references employees(id) on delete cascade,
  relation text not null check (relation in ('c_level', 'training')),
  company_id uuid references companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, relation)
);

create table if not exists review_rounds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default my_company_id() references companies(id) on delete cascade,
  -- What the round is called ("November 2026", "Mangsir 2083"): the calendar the admin was looking at.
  title text not null check (btrim(title) <> ''),
  period_start date not null,
  period_end date not null,
  -- Feedback is asked for by this day.
  due_on date,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint review_rounds_period_check check (period_end >= period_start),
  constraint review_rounds_one_per_start unique (company_id, period_start)
);

create table if not exists colleague_reviews (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references review_rounds(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  -- Who the feedback is about, and who gives it.
  subject_id uuid not null references employees(id) on delete cascade,
  reviewer_id uuid not null references employees(id) on delete cascade,
  relation text not null check (relation in ('peer', 'manager', 'c_level', 'training')),
  rating smallint check (rating is null or (rating >= 1 and rating <= 5)),
  comment text check (comment is null or char_length(comment) <= 1000),
  given_at timestamptz,
  created_at timestamptz not null default now(),
  constraint colleague_reviews_not_self check (reviewer_id <> subject_id),
  -- Given means both a rating and a time; not given means neither.
  constraint colleague_reviews_given_check check ((rating is null) = (given_at is null)),
  constraint colleague_reviews_one_each unique (round_id, subject_id, reviewer_id, relation)
);
create index if not exists idx_colleague_reviews_round on colleague_reviews(round_id);
create index if not exists idx_colleague_reviews_reviewer on colleague_reviews(reviewer_id, round_id);
create index if not exists idx_colleague_reviews_subject on colleague_reviews(subject_id, round_id);

-- A review's company comes from its round, and the reviewer and the person reviewed must both belong to it, so
-- nobody can be asked to review (or be reviewed by) another company's staff.
create or replace function colleague_reviews_set_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid;
begin
  select company_id into c from review_rounds where id = new.round_id;
  if c is null then
    raise exception 'No such round';
  end if;
  if (select company_id from employees where id = new.subject_id) is distinct from c
     or (select company_id from employees where id = new.reviewer_id) is distinct from c then
    raise exception 'The reviewer and the person reviewed must both be in the round''s company';
  end if;
  new.company_id := c;
  return new;
end;
$$;

drop trigger if exists trg_set_company on colleague_reviews;
create trigger trg_set_company before insert on colleague_reviews
  for each row execute function colleague_reviews_set_company();

drop trigger if exists trg_stamp_company_id on review_givers;
create trigger trg_stamp_company_id before insert on review_givers
  for each row execute function stamp_company_id_from_employee();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table review_settings enable row level security;
alter table review_givers enable row level security;
alter table review_rounds enable row level security;
alter table colleague_reviews enable row level security;

drop policy if exists "review_settings: admin or hr full access" on review_settings;
create policy "review_settings: admin or hr full access" on review_settings
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "review_givers: admin or hr full access" on review_givers;
create policy "review_givers: admin or hr full access" on review_givers
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "review_rounds: admin or hr full access" on review_rounds;
create policy "review_rounds: admin or hr full access" on review_rounds
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());

-- Reviews: admin / HR can read them, create them (starting a round) and remove them (taking one back), but
-- there is deliberately no update policy: only the giver, through give_colleague_review(), can put a rating
-- on a review.
drop policy if exists "colleague_reviews: admin or hr read" on colleague_reviews;
create policy "colleague_reviews: admin or hr read" on colleague_reviews
  for select using (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "colleague_reviews: admin or hr create" on colleague_reviews;
create policy "colleague_reviews: admin or hr create" on colleague_reviews
  for insert with check (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "colleague_reviews: admin or hr remove" on colleague_reviews;
create policy "colleague_reviews: admin or hr remove" on colleague_reviews
  for delete using (is_admin_or_hr() and company_id = my_company_id());

-- ---------------------------------------------------------------------------
-- What a giver can do
-- ---------------------------------------------------------------------------

-- The reviews the signed-in person is asked to give in rounds that are still open, with the name of the person
-- each is about (an employee cannot read other employees' rows, hence security definer). Ones not yet given
-- come first.
create or replace function my_reviews_to_give()
returns table (
  review_id uuid,
  round_id uuid,
  round_title text,
  due_on date,
  relation text,
  subject_name text,
  subject_department text,
  rating smallint,
  comment text,
  given_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select cr.id, rr.id, rr.title, rr.due_on, cr.relation, e.name, e.department, cr.rating, cr.comment, cr.given_at
  from colleague_reviews cr
  join review_rounds rr on rr.id = cr.round_id
  join employees e on e.id = cr.subject_id
  where rr.status = 'open'
    and cr.reviewer_id = (select employee_id from profiles where id = auth.uid())
  order by (cr.given_at is not null), rr.period_start desc, e.name;
$$;

-- Give (or, while the round is open, change) the feedback on one review. Only the person asked to give it can.
create or replace function give_colleague_review(p_review_id uuid, p_rating integer, p_comment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
  r record;
  note text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select employee_id into me from profiles where id = auth.uid();
  select cr.reviewer_id, rr.status into r
  from colleague_reviews cr
  join review_rounds rr on rr.id = cr.round_id
  where cr.id = p_review_id;
  if not found or me is null or r.reviewer_id <> me then
    raise exception 'This feedback is not yours to give';
  end if;
  if r.status <> 'open' then
    raise exception 'This round is closed';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'The rating must be from 1 to 5';
  end if;
  if note is not null and char_length(note) > 1000 then
    raise exception 'The comment is too long (1000 characters at most)';
  end if;
  update colleague_reviews
  set rating = p_rating, comment = note, given_at = now()
  where id = p_review_id;
end;
$$;

revoke all on function my_reviews_to_give() from public, anon;
revoke all on function give_colleague_review(uuid, integer, text) from public, anon;
grant execute on function my_reviews_to_give() to authenticated;
grant execute on function give_colleague_review(uuid, integer, text) to authenticated;
