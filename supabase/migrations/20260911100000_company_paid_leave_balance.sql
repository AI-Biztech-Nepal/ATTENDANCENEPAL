-- A yearly paid-leave balance, per company.
--
--   paid_leave_days_per_year  Days every employee gets at the start of each
--                             Nepal fiscal year (1 Shrawan) -- the default;
--                             an employee's own annual_leave_days
--                             (20260911110000) overrides it. A working day
--                             missed without punching -- or taken as approved
--                             leave -- is paid out of this balance, and pay is
--                             only cut once it reaches 0. Unused days lapse at
--                             the next 1 Shrawan. 0, with no employee set
--                             otherwise, turns the balance off -- how every
--                             company behaved before.
--
--   week_off_work_earns_leave When on, attendance on an employee's Week Off
--                             adds one whole day to that balance for every
--                             full standard day worked (ot_hours_per_day, 8h
--                             by default) -- no part days -- instead of being
--                             counted as overtime.
--
-- Nothing is stored per employee: the balance is worked out on the Leave page
-- and the payroll reports from the attendance already on record (see
-- admin-web/lib/leaveBalance.ts), so a correction to a past day moves it
-- automatically.
--
-- Set on the Leave page's "Leave Balance" tab by an admin; the existing
-- "companies: admin update own" policy already covers the update.

alter table companies
  add column if not exists paid_leave_days_per_year numeric not null default 0
    check (paid_leave_days_per_year >= 0 and paid_leave_days_per_year <= 366);

alter table companies
  add column if not exists week_off_work_earns_leave boolean not null default false;

-- ASHADEEP FOUNDATION: Week Off work earns leave. No default allowance --
-- the admin enters each employee's yearly leave on the Leave page.
update companies
set week_off_work_earns_leave = true
where id = '3211d649-4ecb-476a-b059-aa06e90899f6';
