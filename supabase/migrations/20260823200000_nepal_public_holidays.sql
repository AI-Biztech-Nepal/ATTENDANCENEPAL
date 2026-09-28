-- Live, self-refreshing mirror of Nepal's government public holiday
-- calendar, scraped daily from hamropatro.com by the sync-nepal-holidays
-- Edge Function (supabase/functions/sync-nepal-holidays) instead of being
-- hand-typed into the codebase — Nepali festival dates are lunar/panchang-
-- based and shift every BS year, so there is no way to compute or predict
-- them; they have to come from a real published calendar, refreshed on a
-- schedule so this never silently goes stale or gets stuck on one year.
--
-- Global reference data, not per-company — no company_id, no tenant-scoping
-- trigger. Only the Edge Function (via SUPABASE_SERVICE_ROLE_KEY, which
-- bypasses RLS entirely) ever writes to it; every authenticated user can
-- read it, same as any other shared lookup table.
create table if not exists nepal_public_holidays (
  id uuid primary key default gen_random_uuid(),
  bs_year integer not null,
  name text not null,
  -- AD dates, 'YYYY-MM-DD'. end_date = start_date for a single-day holiday;
  -- a genuinely multi-day closure (Dashain, Tihar) spans both.
  start_date date not null,
  end_date date not null,
  scraped_at timestamptz not null default now(),
  unique (bs_year, start_date)
);

create index if not exists idx_nepal_public_holidays_start_date on nepal_public_holidays(start_date);

alter table nepal_public_holidays enable row level security;

drop policy if exists "nepal_public_holidays: authenticated read" on nepal_public_holidays;
create policy "nepal_public_holidays: authenticated read" on nepal_public_holidays
  for select using (auth.role() = 'authenticated');

-- Seed for BS 2083 so the New Holiday form's suggestions aren't empty before
-- the first scheduled scrape runs (or if the Edge Function isn't deployed
-- yet — see supabase/functions/sync-nepal-holidays/README.md). Sourced from
-- hamropatro.com on 2026-08-23; every later scrape overwrites this with
-- whatever the live site says, so it only matters as a one-time bootstrap.
insert into nepal_public_holidays (bs_year, name, start_date, end_date) values
  (2083, 'Nepali New Year / Biska Jatra', '2026-04-14', '2026-04-14'),
  (2083, 'International Labour Day / Buddha Jayanti', '2026-05-01', '2026-05-01'),
  (2083, 'Bakar Eid (Eid al-Adha)', '2026-05-28', '2026-05-28'),
  (2083, 'Republic Day / International Everest Day', '2026-05-29', '2026-05-29'),
  (2083, 'Bhoto Jatra / Kumar Sasthi', '2026-06-20', '2026-06-20'),
  (2083, 'Janai Poornima / Raksha Bandhan', '2026-08-28', '2026-08-28'),
  (2083, 'Gaijatra', '2026-08-29', '2026-08-29'),
  (2083, 'Shree Krishna Janmashtami', '2026-09-04', '2026-09-04'),
  (2083, 'Haritalika Teej / Ganesh Chaturthi', '2026-09-14', '2026-09-14'),
  (2083, 'Constitution Day', '2026-09-19', '2026-09-19'),
  (2083, 'Indra Jatra', '2026-09-25', '2026-09-25'),
  (2083, 'Jitiya Parva', '2026-10-04', '2026-10-04'),
  (2083, 'Ghatasthapana', '2026-10-11', '2026-10-11'),
  (2083, 'Dashain Holiday', '2026-10-17', '2026-10-23'),
  (2083, 'Tihar Holiday', '2026-11-08', '2026-11-12'),
  (2083, 'Chhath Parva', '2026-11-15', '2026-11-15'),
  (2083, 'Guru Nanak Jayanti', '2026-11-24', '2026-11-24'),
  (2083, 'International Day of Disabled Persons', '2026-12-03', '2026-12-03'),
  (2083, 'Udhauli Parva / Yomari Punhi', '2026-12-24', '2026-12-24'),
  (2083, 'Christmas Day', '2026-12-25', '2026-12-25'),
  (2083, 'Tamu Lhosar', '2026-12-30', '2026-12-30'),
  (2083, 'Prithvi Jayanti', '2027-01-11', '2027-01-11'),
  (2083, 'Maghe Sankranti', '2027-01-15', '2027-01-15'),
  (2083, 'Martyrs'' Day (Shahid Diwas)', '2027-01-30', '2027-01-30'),
  (2083, 'Sonam Lhosar', '2027-02-07', '2027-02-07'),
  (2083, 'Saraswati Pooja / Basanta Panchami', '2027-02-11', '2027-02-11'),
  (2083, 'National Democracy Day', '2027-02-19', '2027-02-19'),
  (2083, 'Maha Shivaratri', '2027-03-06', '2027-03-06'),
  (2083, 'International Women''s Day', '2027-03-08', '2027-03-08'),
  (2083, 'Gyalpo Lhosar', '2027-03-09', '2027-03-09'),
  (2083, 'Fagu Poornima / Holi (Hills)', '2027-03-21', '2027-03-21'),
  (2083, 'Fagu Poornima / Holi (Terai)', '2027-03-22', '2027-03-22'),
  (2083, 'Ghode Jatra', '2027-04-06', '2027-04-06')
on conflict (bs_year, start_date) do nothing;

-- The pg_cron schedule that actually invokes the daily scrape lives in its
-- own migration (20260823210000_nepal_public_holidays_cron.sql), not here —
-- deliberately kept separate so that if pg_cron/pg_net aren't available on
-- this project (both need enabling per-project and aren't guaranteed), that
-- failure can't roll back this file's table/seed and leave the New Holiday
-- form's suggestions broken along with it.
